import type { Journey } from '../../domain/model';
import {
  JourneyAutosaveRecoveryConflictError,
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
} from '../../data/ports';
import type { JourneyPatchEnvelope, JourneyUserPatch } from './journeyPatch';

export const JOURNEY_OUTBOX_OWNER_STORAGE_KEY = 'sound-passport.journey-autosave-owner-id';
const ownerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let volatileOwnerId: string | undefined;

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

export function getJourneyOutboxOwnerId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.sessionStorage,
) {
  if (!storage) {
    volatileOwnerId ??= createOwnerId();
    return volatileOwnerId;
  }

  try {
    const stored = storage.getItem(JOURNEY_OUTBOX_OWNER_STORAGE_KEY);
    if (stored && ownerIdPattern.test(stored)) return stored;
    const ownerId = createOwnerId();
    storage.setItem(JOURNEY_OUTBOX_OWNER_STORAGE_KEY, ownerId);
    return ownerId;
  } catch {
    volatileOwnerId ??= createOwnerId();
    return volatileOwnerId;
  }
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
) {
  const exact = normalizeRecord(await outbox.get(journeyId, ownerId), journeyId, ownerId);
  if (exact) return exact;

  const outstanding = (await outbox.listByJourney(journeyId))
    .map((record) => normalizeRecord(record, journeyId))
    .filter((record): record is JourneyAutosaveOutboxRecord => record !== undefined);
  if (outstanding.length === 0) return undefined;
  if (outstanding.length > 1) {
    throw new JourneyAutosaveRecoveryConflictError(
      journeyId,
      outstanding.map((record) => record.ownerId),
    );
  }

  return normalizeRecord(
    await outbox.adopt(journeyId, outstanding[0].ownerId, ownerId),
    journeyId,
    ownerId,
  );
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
