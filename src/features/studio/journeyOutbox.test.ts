import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
} from '../../data/ports';
import type { JourneyPatchEnvelope } from './journeyPatch';
import {
  adoptJourneyOutboxCandidate,
  claimJourneyOutboxOwner,
  clearJourneyOutbox,
  getJourneyOutboxOwnerId,
  JOURNEY_OUTBOX_OWNER_STORAGE_KEY,
  readJourneyOutbox,
  tryClaimJourneyOutboxOwner,
  writeJourneyOutbox,
} from './journeyOutbox';

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const legacyOwner = 'legacy-v3';

function ownerStorage(initialValue?: string) {
  let value = initialValue ?? null;
  return {
    storage: {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => { value = next; }),
    },
    value: () => value,
  };
}

class DeterministicLockManager {
  private readonly held = new Set<string>();

  async request<T>(
    name: string,
    _options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ) {
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      this.held.delete(name);
    }
  }
}

let defaultOwnerLocks: DeterministicLockManager;

const firstEnvelope: JourneyPatchEnvelope = {
  patch: { title: 'Pending title', cityLabels: ['Tokyo', 'Yokohama'] },
  base: { title: 'Original title', cityLabels: ['Tokyo'] },
};

function record(
  ownerId = ownerA,
  generation = 'generation-1',
  envelope: JourneyPatchEnvelope = firstEnvelope,
): JourneyAutosaveOutboxRecord {
  return {
    journeyId: 'private-tokyo',
    ownerId,
    generation,
    envelope,
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

type InspectableOutbox = JourneyAutosaveOutboxPort & {
  peek(journeyId: string, ownerId: string): JourneyAutosaveOutboxRecord | undefined;
};

function outboxStub(initial: JourneyAutosaveOutboxRecord[] = []): InspectableOutbox {
  const records = new Map<string, JourneyAutosaveOutboxRecord>();
  const key = (journeyId: string, ownerId: string) => `${journeyId}\u0000${ownerId}`;
  initial.forEach((item) => records.set(key(item.journeyId, item.ownerId), item));
  return {
    get: vi.fn(async (journeyId, ownerId) => records.get(key(journeyId, ownerId))),
    listByJourney: vi.fn(async (journeyId) => (
      [...records.values()]
        .filter((item) => item.journeyId === journeyId)
        .sort((left, right) => left.ownerId.localeCompare(right.ownerId))
    )),
    adopt: vi.fn(async (journeyId, fromOwnerId, toOwnerId, expectedGeneration?: string) => {
      const exact = records.get(key(journeyId, toOwnerId));
      if (exact) return exact;
      const source = records.get(key(journeyId, fromOwnerId));
      if (!source || (expectedGeneration !== undefined && source.generation !== expectedGeneration)) {
        return undefined;
      }
      const adopted = { ...source, ownerId: toOwnerId };
      records.delete(key(journeyId, fromOwnerId));
      records.set(key(journeyId, toOwnerId), adopted);
      return adopted;
    }),
    put: vi.fn(async (next) => { records.set(key(next.journeyId, next.ownerId), next); }),
    compareAndDelete: vi.fn(async (journeyId, ownerId, generation) => {
      const recordKey = key(journeyId, ownerId);
      const current = records.get(recordKey);
      if (!current || current.generation !== generation) return false;
      records.delete(recordKey);
      return true;
    }),
    peek: (journeyId, ownerId) => records.get(key(journeyId, ownerId)),
  };
}

describe('journeyOutbox', () => {
  beforeEach(() => {
    defaultOwnerLocks = new DeterministicLockManager();
    vi.stubGlobal('navigator', { locks: defaultOwnerLocks });
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads only the exact current owner record while leaving another owner intact', async () => {
    const current = record(ownerA, 'generation-a');
    const independent = record(ownerB, 'generation-b', {
      patch: { summary: 'Independent pending summary' },
      base: { summary: 'Original summary' },
    });
    const outbox = outboxStub([current, independent]);

    await expect(readJourneyOutbox(outbox, 'private-tokyo', ownerA)).resolves.toEqual({
      kind: 'recovered',
      record: current,
    });
    expect(outbox.get).toHaveBeenCalledWith('private-tokyo', ownerA);
    expect(outbox.listByJourney).not.toHaveBeenCalled();
    expect(outbox.peek('private-tokyo', ownerB)).toEqual(independent);
  });

  it('atomically adopts one legacy or outstanding record for a new owner', async () => {
    const legacy = record(legacyOwner, 'legacy-generation');
    const outbox = outboxStub([legacy]);

    await expect(readJourneyOutbox(outbox, 'private-tokyo', ownerA)).resolves.toEqual({
      kind: 'recovered',
      record: { ...legacy, ownerId: ownerA },
    });
    expect(outbox.adopt).toHaveBeenCalledWith(
      'private-tokyo',
      legacyOwner,
      ownerA,
      legacy.generation,
    );
    expect(outbox.peek('private-tokyo', legacyOwner)).toBeUndefined();
    expect(outbox.peek('private-tokyo', ownerA)).toEqual({ ...legacy, ownerId: ownerA });
  });

  it('never adopts a recovery record while its source owner is still live', async () => {
    const locks = new DeterministicLockManager();
    const sourceContext = ownerStorage(ownerA);
    const sourceClaim = await claimJourneyOutboxOwner({ locks, storage: sourceContext.storage });
    const liveRecord = record(ownerA, 'live-generation');
    const outbox = outboxStub([liveRecord]);

    await expect(readJourneyOutbox(
      outbox,
      'private-tokyo',
      ownerB,
      (candidateOwnerId) => tryClaimJourneyOutboxOwner(candidateOwnerId, locks),
    )).resolves.toEqual({ kind: 'none' });

    expect(outbox.adopt).not.toHaveBeenCalled();
    expect(outbox.peek('private-tokyo', ownerA)).toEqual(liveRecord);
    await sourceClaim.release();
  });

  it('lists metadata-only candidates for multiple independent records without mutation', async () => {
    const first = record(ownerA, 'generation-a');
    const second = record(ownerB, 'generation-b');
    const outbox = outboxStub([first, second]);

    const result = await readJourneyOutbox(
      outbox,
      'private-tokyo',
      '33333333-3333-4333-8333-333333333333',
    );

    expect(result).toEqual({
      kind: 'candidates',
      candidates: [
        { ownerId: ownerA, generation: 'generation-a', updatedAt: first.updatedAt },
        { ownerId: ownerB, generation: 'generation-b', updatedAt: second.updatedAt },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/envelope|patch|base|Pending title/);
    expect(outbox.adopt).not.toHaveBeenCalled();
    expect(outbox.peek('private-tokyo', ownerA)).toEqual(first);
    expect(outbox.peek('private-tokyo', ownerB)).toEqual(second);
  });

  it('atomically adopts the selected generation while retaining every unselected owner', async () => {
    const first = record(ownerA, 'generation-a');
    const second = record(ownerB, 'generation-b', {
      patch: { summary: 'Selected pending summary' },
      base: { summary: 'Original summary' },
    });
    const outbox = outboxStub([first, second]);
    const currentOwner = '33333333-3333-4333-8333-333333333333';

    await expect(adoptJourneyOutboxCandidate(outbox, 'private-tokyo', currentOwner, {
      ownerId: ownerB,
      generation: second.generation,
      updatedAt: second.updatedAt,
    })).resolves.toEqual({ ...second, ownerId: currentOwner });

    expect(outbox.adopt).toHaveBeenCalledWith(
      'private-tokyo',
      ownerB,
      currentOwner,
      second.generation,
    );
    expect(outbox.peek('private-tokyo', ownerA)).toEqual(first);
    expect(outbox.peek('private-tokyo', ownerB)).toBeUndefined();
    expect(outbox.peek('private-tokyo', currentOwner)).toEqual({ ...second, ownerId: currentOwner });
  });

  it('writes only supported owner field patches and excludes unrelated private or fixture data', async () => {
    const outbox = outboxStub();
    const contaminated = {
      ...record(),
      photo: new Blob(['private photo']),
      fixtureJourney: { id: 'fixture-tokyo' },
      envelope: {
        ...firstEnvelope,
        patch: { ...firstEnvelope.patch, source: 'fixture' },
      },
    } as unknown as JourneyAutosaveOutboxRecord;

    await writeJourneyOutbox(outbox, contaminated);

    expect(outbox.put).toHaveBeenCalledWith(record());
    expect(JSON.stringify(vi.mocked(outbox.put).mock.calls[0][0])).not.toMatch(/photo|fixture|source/);
  });

  it('ignores malformed records and compare-deletes only one owner generation', async () => {
    const malformed = { ...record(), ownerId: '' } as JourneyAutosaveOutboxRecord;
    const malformedOutbox = outboxStub([malformed]);
    await expect(readJourneyOutbox(malformedOutbox, 'private-tokyo', ownerA)).resolves.toEqual({ kind: 'none' });

    const current = record(ownerA, 'generation-2');
    const independent = record(ownerB, 'generation-2');
    const outbox = outboxStub([current, independent]);
    await expect(clearJourneyOutbox(outbox, 'private-tokyo', ownerA, 'generation-1')).resolves.toBe(false);
    await expect(clearJourneyOutbox(outbox, 'private-tokyo', ownerA, 'generation-2')).resolves.toBe(true);
    expect(outbox.peek('private-tokyo', ownerB)).toEqual(independent);
  });

  it('propagates IndexedDB persistence failures instead of swallowing recovery loss', async () => {
    const failure = new Error('IndexedDB unavailable');
    const outbox = outboxStub();
    vi.mocked(outbox.put).mockRejectedValueOnce(failure);

    await expect(writeJourneyOutbox(outbox, record())).rejects.toBe(failure);
  });

  it('replaces invalid stored owner metadata with a stable UUID and stores no private content', () => {
    window.sessionStorage.setItem(
      'sound-passport.journey-autosave-owner-id',
      'Private title / Taipei / 2026-07-13 / summary',
    );

    const first = getJourneyOutboxOwnerId(window.sessionStorage);
    const second = getJourneyOutboxOwnerId(window.sessionStorage);

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(second).toBe(first);
    expect(JOURNEY_OUTBOX_OWNER_STORAGE_KEY).toBe('sound-passport.journey-autosave-owner-id');
    expect(window.sessionStorage.getItem(JOURNEY_OUTBOX_OWNER_STORAGE_KEY)).toBe(first);
    expect(Object.values(window.sessionStorage).join(' ')).not.toMatch(/Private|Taipei|2026|summary/);
  });

  it('rotates a copied owner ID while the original context holds its live claim', async () => {
    const locks = new DeterministicLockManager();
    const firstContext = ownerStorage(ownerA);
    const duplicatedContext = ownerStorage(ownerA);

    const first = await claimJourneyOutboxOwner({ locks, storage: firstContext.storage });
    const duplicate = await claimJourneyOutboxOwner({ locks, storage: duplicatedContext.storage });

    expect(first.ownerId).toBe(ownerA);
    expect(duplicate.ownerId).not.toBe(ownerA);
    expect(duplicate.ownerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(firstContext.value()).toBe(ownerA);
    expect(duplicatedContext.value()).toBe(duplicate.ownerId);

    await duplicate.release();
    await first.release();
  });

  it('reacquires the same stored owner ID after the previous page releases it', async () => {
    const locks = new DeterministicLockManager();
    const context = ownerStorage(ownerA);

    const firstPage = await claimJourneyOutboxOwner({ locks, storage: context.storage });
    await firstPage.release();
    const reloadedPage = await claimJourneyOutboxOwner({ locks, storage: context.storage });

    expect(reloadedPage.ownerId).toBe(ownerA);
    expect(context.value()).toBe(ownerA);
    await reloadedPage.release();
  });

  it('uses fresh owners and still recovers one abandoned record when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const firstContext = ownerStorage(ownerA);
    const duplicatedContext = ownerStorage(ownerA);

    const firstPage = await claimJourneyOutboxOwner({ storage: firstContext.storage });
    const duplicatePage = await claimJourneyOutboxOwner({ storage: duplicatedContext.storage });

    expect(firstPage.ownerId).not.toBe(ownerA);
    expect(duplicatePage.ownerId).not.toBe(ownerA);
    expect(duplicatePage.ownerId).not.toBe(firstPage.ownerId);

    const abandoned = record(ownerA, 'abandoned-generation');
    const outbox = outboxStub([abandoned]);
    await expect(readJourneyOutbox(outbox, 'private-tokyo', duplicatePage.ownerId)).resolves.toEqual({
      kind: 'recovered',
      record: { ...abandoned, ownerId: duplicatePage.ownerId },
    });

    await duplicatePage.release();
    await firstPage.release();
  });

  it('keeps the sessionStorage getter itself inside the owner fallback boundary', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('blocked', 'SecurityError'); },
    });

    try {
      expect(() => getJourneyOutboxOwnerId()).not.toThrow();
      expect(getJourneyOutboxOwnerId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    } finally {
      if (descriptor) Object.defineProperty(window, 'sessionStorage', descriptor);
    }
  });
});
