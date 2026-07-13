import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JourneyAutosaveRecoveryConflictError,
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
} from '../../data/ports';
import type { JourneyPatchEnvelope } from './journeyPatch';
import {
  clearJourneyOutbox,
  getJourneyOutboxOwnerId,
  JOURNEY_OUTBOX_OWNER_STORAGE_KEY,
  readJourneyOutbox,
  writeJourneyOutbox,
} from './journeyOutbox';

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const legacyOwner = 'legacy-v3';

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
    adopt: vi.fn(async (journeyId, fromOwnerId, toOwnerId) => {
      const exact = records.get(key(journeyId, toOwnerId));
      if (exact) return exact;
      const candidates = [...records.values()].filter((item) => item.journeyId === journeyId);
      if (candidates.length === 0) return undefined;
      if (candidates.length !== 1 || candidates[0].ownerId !== fromOwnerId) {
        throw new JourneyAutosaveRecoveryConflictError(
          journeyId,
          candidates.map((item) => item.ownerId),
        );
      }
      const adopted = { ...candidates[0], ownerId: toOwnerId };
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
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('reads only the exact current owner record while leaving another owner intact', async () => {
    const current = record(ownerA, 'generation-a');
    const independent = record(ownerB, 'generation-b', {
      patch: { summary: 'Independent pending summary' },
      base: { summary: 'Original summary' },
    });
    const outbox = outboxStub([current, independent]);

    await expect(readJourneyOutbox(outbox, 'private-tokyo', ownerA)).resolves.toEqual(current);
    expect(outbox.get).toHaveBeenCalledWith('private-tokyo', ownerA);
    expect(outbox.listByJourney).not.toHaveBeenCalled();
    expect(outbox.peek('private-tokyo', ownerB)).toEqual(independent);
  });

  it('atomically adopts one legacy or outstanding record for a new owner', async () => {
    const legacy = record(legacyOwner, 'legacy-generation');
    const outbox = outboxStub([legacy]);

    await expect(readJourneyOutbox(outbox, 'private-tokyo', ownerA)).resolves.toEqual({
      ...legacy,
      ownerId: ownerA,
    });
    expect(outbox.adopt).toHaveBeenCalledWith('private-tokyo', legacyOwner, ownerA);
    expect(outbox.peek('private-tokyo', legacyOwner)).toBeUndefined();
    expect(outbox.peek('private-tokyo', ownerA)).toEqual({ ...legacy, ownerId: ownerA });
  });

  it('surfaces multiple independent records as a recoverable conflict without mutation', async () => {
    const first = record(ownerA, 'generation-a');
    const second = record(ownerB, 'generation-b');
    const outbox = outboxStub([first, second]);

    await expect(readJourneyOutbox(
      outbox,
      'private-tokyo',
      '33333333-3333-4333-8333-333333333333',
    )).rejects.toMatchObject({
      name: 'JourneyAutosaveRecoveryConflictError',
      journeyId: 'private-tokyo',
      ownerIds: [ownerA, ownerB],
    });
    expect(outbox.adopt).not.toHaveBeenCalled();
    expect(outbox.peek('private-tokyo', ownerA)).toEqual(first);
    expect(outbox.peek('private-tokyo', ownerB)).toEqual(second);
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
    await expect(readJourneyOutbox(malformedOutbox, 'private-tokyo', ownerA)).resolves.toBeUndefined();

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
});
