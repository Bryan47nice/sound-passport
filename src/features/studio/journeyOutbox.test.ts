import { describe, expect, it, vi } from 'vitest';
import type {
  JourneyAutosaveOutboxPort,
  JourneyAutosaveOutboxRecord,
} from '../../data/ports';
import type { JourneyPatchEnvelope } from './journeyPatch';
import {
  clearJourneyOutbox,
  readJourneyOutbox,
  writeJourneyOutbox,
} from './journeyOutbox';

const firstEnvelope: JourneyPatchEnvelope = {
  patch: { title: 'Pending title', cityLabels: ['Tokyo', 'Yokohama'] },
  base: { title: 'Original title', cityLabels: ['Tokyo'] },
};

function record(
  generation = 'generation-1',
  envelope: JourneyPatchEnvelope = firstEnvelope,
): JourneyAutosaveOutboxRecord {
  return {
    journeyId: 'private-tokyo',
    generation,
    envelope,
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

function outboxStub(initial?: JourneyAutosaveOutboxRecord): JourneyAutosaveOutboxPort {
  let stored = initial;
  return {
    get: vi.fn(async (journeyId) => stored && stored.journeyId === journeyId ? stored : undefined),
    put: vi.fn(async (next) => { stored = next; }),
    compareAndDelete: vi.fn(async (journeyId, generation) => {
      const current = stored;
      if (!current || current.journeyId !== journeyId || current.generation !== generation) return false;
      stored = undefined;
      return true;
    }),
  };
}

describe('journeyOutbox', () => {
  it('reads and validates one typed IndexedDB outbox record', async () => {
    const stored = record();
    const outbox = outboxStub(stored);

    await expect(readJourneyOutbox(outbox, 'private-tokyo')).resolves.toEqual(stored);
    expect(outbox.get).toHaveBeenCalledWith('private-tokyo');
  });

  it('writes only supported field patches and excludes unrelated private or fixture data', async () => {
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

  it('ignores malformed records and compare-deletes only the requested generation', async () => {
    const malformed = { ...record(), generation: '' } as JourneyAutosaveOutboxRecord;
    const outbox = outboxStub(malformed);

    await expect(readJourneyOutbox(outbox, 'private-tokyo')).resolves.toBeUndefined();

    const validOutbox = outboxStub(record('generation-2'));
    await expect(clearJourneyOutbox(validOutbox, 'private-tokyo', 'generation-1')).resolves.toBe(false);
    await expect(clearJourneyOutbox(validOutbox, 'private-tokyo', 'generation-2')).resolves.toBe(true);
  });

  it('propagates IndexedDB persistence failures instead of swallowing recovery loss', async () => {
    const failure = new Error('IndexedDB unavailable');
    const outbox = outboxStub();
    vi.mocked(outbox.put).mockRejectedValueOnce(failure);

    await expect(writeJourneyOutbox(outbox, record())).rejects.toBe(failure);
  });
});
