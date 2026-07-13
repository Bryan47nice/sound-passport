import type { Journey } from '../../domain/model';
import {
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
} from '../../data/ports';
import type { JourneyPatchEnvelope, JourneyUserPatch } from './journeyPatch';

export const JOURNEY_OUTBOX_OWNER_STORAGE_KEY = 'sound-passport.journey-autosave-owner-id';
const JOURNEY_OUTBOX_OWNER_HANDOFF_STORAGE_KEY = 'sound-passport.journey-autosave-owner-handoff';
const ownerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let volatileOwnerId: string | undefined;

type OwnerStorage = Pick<Storage, 'getItem' | 'setItem'> &
  Partial<Pick<Storage, 'removeItem'>>;

export interface JourneyOutboxLockManager {
  request<T>(
    name: string,
    options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ): Promise<T>;
}

export interface JourneyOutboxOwnerClaim {
  ownerId: string;
  release(): Promise<void>;
}

export type JourneyOutboxOwnerClaimer = (
  ownerId: string,
) => Promise<JourneyOutboxOwnerClaim | undefined>;

export interface JourneyOutboxPageOwnerClaim extends JourneyOutboxOwnerClaim {
  claimRecoveryOwner: JourneyOutboxOwnerClaimer;
}

interface JourneyOutboxOwnerClaimOptions {
  storage?: OwnerStorage;
  locks?: JourneyOutboxLockManager;
}

function createOwnerId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure journey autosave owner generation is unavailable.');
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultOwnerStorage() {
  try {
    return globalThis.sessionStorage as OwnerStorage;
  } catch {
    return undefined;
  }
}

function defaultLockManager() {
  try {
    return globalThis.navigator?.locks as unknown as JourneyOutboxLockManager | undefined;
  } catch {
    return undefined;
  }
}

function storeFreshOwnerId(storage?: OwnerStorage) {
  const ownerId = createOwnerId();
  volatileOwnerId = ownerId;
  if (storage) {
    try {
      storage.setItem(JOURNEY_OUTBOX_OWNER_STORAGE_KEY, ownerId);
    } catch {
      // The in-memory UUID remains safe when session storage is inaccessible.
    }
  }
  return ownerId;
}

function consumeOwnerHandoff(storage: OwnerStorage | undefined, ownerId: string) {
  if (!storage?.removeItem) return undefined;
  try {
    const previousOwnerId = storage.getItem(JOURNEY_OUTBOX_OWNER_HANDOFF_STORAGE_KEY);
    storage.removeItem(JOURNEY_OUTBOX_OWNER_HANDOFF_STORAGE_KEY);
    return previousOwnerId === ownerId ? previousOwnerId : undefined;
  } catch {
    return undefined;
  }
}

function storeOwnerHandoff(storage: OwnerStorage | undefined, ownerId: string) {
  if (!storage) return;
  try {
    if (storage.getItem(JOURNEY_OUTBOX_OWNER_STORAGE_KEY) !== ownerId) return;
    storage.setItem(JOURNEY_OUTBOX_OWNER_HANDOFF_STORAGE_KEY, ownerId);
  } catch {
    // Recovery remains opt-in when session handoff storage is inaccessible.
  }
}

export function getJourneyOutboxOwnerId(storage?: OwnerStorage) {
  const availableStorage = storage ?? defaultOwnerStorage();
  if (!availableStorage) {
    volatileOwnerId ??= createOwnerId();
    return volatileOwnerId;
  }

  try {
    const stored = availableStorage.getItem(JOURNEY_OUTBOX_OWNER_STORAGE_KEY);
    if (stored && ownerIdPattern.test(stored)) return stored;
    return storeFreshOwnerId(availableStorage);
  } catch {
    volatileOwnerId ??= createOwnerId();
    return volatileOwnerId;
  }
}

function tryClaimOwner(
  ownerId: string,
  locks: JourneyOutboxLockManager,
): Promise<JourneyOutboxOwnerClaim | undefined> {
  return new Promise((resolve, reject) => {
    let releaseLock!: () => void;
    let settled = false;
    const hold = new Promise<void>((release) => { releaseLock = release; });
    let request: Promise<unknown>;

    try {
      request = Promise.resolve(locks.request(
        `sound-passport-owner:${ownerId}`,
        { ifAvailable: true, mode: 'exclusive' },
        async (lock) => {
          if (!lock) {
            settled = true;
            resolve(undefined);
            return;
          }

          let released = false;
          settled = true;
          resolve({
            ownerId,
            release: async () => {
              if (!released) {
                released = true;
                releaseLock();
              }
              await request;
            },
          });
          await hold;
        },
      ));
      void request.catch((error: unknown) => {
        if (!settled) reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function tryClaimJourneyOutboxOwner(
  ownerId: string,
  locks: JourneyOutboxLockManager | undefined = defaultLockManager(),
) {
  if (!locks) {
    return Promise.resolve({ ownerId, release: async () => undefined });
  }
  return tryClaimOwner(ownerId, locks);
}

function createPreviousOwnerClaimer(previousOwnerId?: string): JourneyOutboxOwnerClaimer {
  return async (candidateOwnerId) => (
    previousOwnerId !== undefined && candidateOwnerId === previousOwnerId
      ? { ownerId: candidateOwnerId, release: async () => undefined }
      : undefined
  );
}

function createPageOwnerClaim(
  ownerId: string,
  claimRecoveryOwner: JourneyOutboxOwnerClaimer,
  releaseOwner: () => Promise<void>,
  storage?: OwnerStorage,
): JourneyOutboxPageOwnerClaim {
  let released = false;
  const releaseOnPageHide = () => { void release(); };

  async function release() {
    if (released) return;
    released = true;
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('pagehide', releaseOnPageHide);
    }
    const releasing = releaseOwner();
    storeOwnerHandoff(storage, ownerId);
    await releasing;
  }

  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('pagehide', releaseOnPageHide, { once: true });
  }
  return { ownerId, claimRecoveryOwner, release };
}

export async function claimJourneyOutboxOwner({
  storage,
  locks,
}: JourneyOutboxOwnerClaimOptions = {}): Promise<JourneyOutboxPageOwnerClaim> {
  const availableStorage = storage ?? defaultOwnerStorage();
  const availableLocks = locks ?? defaultLockManager();
  let ownerId = getJourneyOutboxOwnerId(availableStorage);
  let previousOwnerId = consumeOwnerHandoff(availableStorage, ownerId);

  if (!availableLocks) {
    ownerId = storeFreshOwnerId(availableStorage);
    return createPageOwnerClaim(
      ownerId,
      createPreviousOwnerClaimer(previousOwnerId),
      async () => undefined,
      availableStorage,
    );
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const claim = await tryClaimOwner(ownerId, availableLocks);
      if (claim) {
        return createPageOwnerClaim(
          claim.ownerId,
          (candidateOwnerId) => (
            tryClaimJourneyOutboxOwner(candidateOwnerId, availableLocks)
          ),
          () => claim.release(),
          availableStorage,
        );
      }
    } catch {
      ownerId = storeFreshOwnerId(availableStorage);
      return createPageOwnerClaim(
        ownerId,
        createPreviousOwnerClaimer(previousOwnerId),
        async () => undefined,
        availableStorage,
      );
    }
    if (ownerId === previousOwnerId) previousOwnerId = undefined;
    ownerId = storeFreshOwnerId(availableStorage);
  }

  throw new Error('Unable to claim a unique journey autosave owner.');
}

const patchKeys = [
  'title',
  'countryCode',
  'countryName',
  'countryCoordinates',
  'cityLabels',
  'startDate',
  'endDate',
  'summary',
  'coverPhotoAssetId',
] as const;

type PatchKey = typeof patchKeys[number];

export interface JourneyOutboxRecoveryCandidate {
  ownerId: string;
  generation: string;
  updatedAt: string;
}

export type JourneyOutboxRecoveryResult =
  | { kind: 'none' }
  | { kind: 'recovered'; record: JourneyAutosaveOutboxRecord }
  | { kind: 'candidates'; candidates: JourneyOutboxRecoveryCandidate[] };

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPatchValue(key: PatchKey, value: unknown) {
  if (key === 'countryCoordinates') {
    return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  }
  if (key === 'cityLabels') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
  if (key === 'coverPhotoAssetId') return value === undefined || value === null || typeof value === 'string';
  return typeof value === 'string';
}

function copyPatchValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

function normalizeEnvelope(value: unknown): JourneyPatchEnvelope | undefined {
  if (!isRecord(value) || !isRecord(value.patch) || !isRecord(value.base)) return undefined;
  const patch: JourneyUserPatch = {};
  const base: JourneyUserPatch = {};

  for (const key of patchKeys) {
    if (!hasOwn(value.patch, key)) continue;
    if (!hasOwn(value.base, key)) return undefined;
    const patchValue = value.patch[key];
    const baseValue = value.base[key];
    if (!isPatchValue(key, patchValue) || !isPatchValue(key, baseValue)) return undefined;
    Object.assign(patch, {
      [key]: copyPatchValue(patchValue === null ? undefined : patchValue) as Journey[PatchKey],
    });
    Object.assign(base, {
      [key]: copyPatchValue(baseValue === null ? undefined : baseValue) as Journey[PatchKey],
    });
  }

  return Object.keys(patch).length > 0 ? { patch, base } : undefined;
}

function normalizeRecord(
  value: unknown,
  expectedJourneyId?: string,
  expectedOwnerId?: string,
): JourneyAutosaveOutboxRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { journeyId, ownerId, generation, updatedAt } = value;
  const envelope = normalizeEnvelope(value.envelope);
  if (
    typeof journeyId !== 'string' || journeyId.length === 0 ||
    (expectedJourneyId !== undefined && journeyId !== expectedJourneyId) ||
    typeof ownerId !== 'string' || ownerId.length === 0 ||
    (expectedOwnerId !== undefined && ownerId !== expectedOwnerId) ||
    typeof generation !== 'string' || generation.length === 0 ||
    typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)) ||
    !envelope
  ) return undefined;

  return { journeyId, ownerId, generation, envelope, updatedAt };
}

export async function readJourneyOutbox(
  outbox: JourneyAutosaveOutboxPort,
  journeyId: string,
  ownerId: string,
  claimOwner: JourneyOutboxOwnerClaimer = tryClaimJourneyOutboxOwner,
): Promise<JourneyOutboxRecoveryResult> {
  const exact = normalizeRecord(await outbox.get(journeyId, ownerId), journeyId, ownerId);
  if (exact) return { kind: 'recovered', record: exact };

  const outstanding = (await outbox.listByJourney(journeyId))
    .map((record) => normalizeRecord(record, journeyId))
    .filter((record): record is JourneyAutosaveOutboxRecord => record !== undefined);
  if (outstanding.length === 0) return { kind: 'none' };

  const claimable: Array<{
    record: JourneyAutosaveOutboxRecord;
    claim: JourneyOutboxOwnerClaim;
  }> = [];
  try {
    for (const record of outstanding) {
      const claim = await claimOwner(record.ownerId);
      if (claim) claimable.push({ record, claim });
    }
  } catch (error) {
    await Promise.allSettled(claimable.map(({ claim }) => claim.release()));
    throw error;
  }
  if (claimable.length === 0) return { kind: 'none' };

  if (claimable.length > 1) {
    const candidates = claimable
      .map(({ record: { ownerId: candidateOwnerId, generation, updatedAt } }) => ({
        ownerId: candidateOwnerId,
        generation,
        updatedAt,
      }))
      .sort((left, right) => (
        right.updatedAt.localeCompare(left.updatedAt) || left.ownerId.localeCompare(right.ownerId)
      ));
    await Promise.all(claimable.map(({ claim }) => claim.release()));
    return { kind: 'candidates', candidates };
  }

  const [{ record, claim }] = claimable;
  try {
    const adopted = normalizeRecord(
      await outbox.adopt(
        journeyId,
        record.ownerId,
        ownerId,
        record.generation,
      ),
      journeyId,
      ownerId,
    );
    return adopted ? { kind: 'recovered', record: adopted } : { kind: 'none' };
  } finally {
    await claim.release();
  }
}

export async function adoptJourneyOutboxCandidate(
  outbox: JourneyAutosaveOutboxPort,
  journeyId: string,
  ownerId: string,
  candidate: JourneyOutboxRecoveryCandidate,
  claimOwner: JourneyOutboxOwnerClaimer = tryClaimJourneyOutboxOwner,
) {
  const claim = await claimOwner(candidate.ownerId);
  if (!claim) return undefined;
  try {
    return normalizeRecord(
      await outbox.adopt(
        journeyId,
        candidate.ownerId,
        ownerId,
        candidate.generation,
      ),
      journeyId,
      ownerId,
    );
  } finally {
    await claim.release();
  }
}

export async function writeJourneyOutbox(
  outbox: JourneyAutosaveOutboxPort,
  record: JourneyAutosaveOutboxRecord,
) {
  const normalized = normalizeRecord(record, record.journeyId);
  if (!normalized) throw new TypeError('Journey autosave outbox record is invalid.');
  await outbox.put(normalized);
}

export function clearJourneyOutbox(
  outbox: JourneyAutosaveOutboxPort,
  journeyId: string,
  ownerId: string,
  generation: string,
) {
  return outbox.compareAndDelete(journeyId, ownerId, generation);
}
