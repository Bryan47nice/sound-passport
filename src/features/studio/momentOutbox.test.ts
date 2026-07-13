import { describe, expect, it, vi } from 'vitest';
import type {
  MomentAutosaveOutboxPort,
  MomentAutosaveOutboxRecord,
} from '../../data/ports';
import { adoptMomentOutboxCandidate, readMomentOutbox } from './momentOutbox';

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const currentOwner = '33333333-3333-4333-8333-333333333333';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function record({
  momentId = 'moment-1',
  journeyId = 'journey-1',
  ownerId = ownerA,
  generation = 'generation-a',
  updatedAt = '2026-07-13T00:00:00.000Z',
  caption = '本機未儲存內容',
}: Partial<MomentAutosaveOutboxRecord> & { caption?: string } = {}): MomentAutosaveOutboxRecord {
  return {
    momentId,
    journeyId,
    ownerId,
    generation,
    updatedAt,
    envelope: {
      patch: { caption },
      base: { caption: '原始內容' },
    },
  };
}

function outboxStub(records: MomentAutosaveOutboxRecord[]): MomentAutosaveOutboxPort {
  return {
    getMomentOutbox: vi.fn(async (momentId, ownerId) => records.find((candidate) => (
      candidate.momentId === momentId && candidate.ownerId === ownerId
    ))),
    listMomentOutboxesByJourney: vi.fn(async () => records),
    adoptMomentOutbox: vi.fn(async (
      momentId,
      journeyId,
      fromOwnerId,
      toOwnerId,
      expectedGeneration,
    ) => {
      const source = records.find((candidate) => (
        candidate.momentId === momentId &&
        candidate.journeyId === journeyId &&
        candidate.ownerId === fromOwnerId &&
        candidate.generation === expectedGeneration
      ));
      return source ? { ...source, ownerId: toOwnerId } : undefined;
    }),
    putMomentOutbox: vi.fn(async () => undefined),
    compareAndDeleteMomentOutbox: vi.fn(async () => false),
  };
}

describe('momentOutbox', () => {
  it('returns one foreign no-lock recovery as metadata without adopting it', async () => {
    const pending = record();
    const outbox = outboxStub([pending]);

    await expect(readMomentOutbox(
      outbox,
      'moment-1',
      'journey-1',
      currentOwner,
    )).resolves.toEqual({
      kind: 'candidates',
      candidates: [{
        ownerId: ownerA,
        generation: pending.generation,
        updatedAt: pending.updatedAt,
      }],
    });
    expect(outbox.adoptMomentOutbox).not.toHaveBeenCalled();
  });

  it('sorts exact candidates deterministically and excludes other journeys and moments', async () => {
    const older = record({ ownerId: ownerA, generation: 'older' });
    const newer = record({
      ownerId: ownerB,
      generation: 'newer',
      updatedAt: '2026-07-13T00:00:01.000Z',
      caption: '較新的未儲存內容',
    });
    const wrongJourney = record({
      journeyId: 'journey-elsewhere',
      ownerId: '44444444-4444-4444-8444-444444444444',
      caption: '其他旅程內容',
    });
    const wrongMoment = record({
      momentId: 'moment-elsewhere',
      ownerId: '55555555-5555-4555-8555-555555555555',
      caption: '其他時刻內容',
    });
    const outbox = outboxStub([older, wrongJourney, wrongMoment, newer]);

    const result = await readMomentOutbox(
      outbox,
      'moment-1',
      'journey-1',
      currentOwner,
      async () => undefined,
    );

    expect(result).toEqual({
      kind: 'candidates',
      candidates: [
        { ownerId: ownerB, generation: 'newer', updatedAt: newer.updatedAt },
        { ownerId: ownerA, generation: 'older', updatedAt: older.updatedAt },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/較新的未儲存內容|其他旅程內容|其他時刻內容|envelope/);
    expect(outbox.adoptMomentOutbox).not.toHaveBeenCalled();
  });

  it('falls back to explicit recovery when candidate lock probing rejects', async () => {
    const pending = record();
    const outbox = outboxStub([pending]);

    await expect(readMomentOutbox(
      outbox,
      'moment-1',
      'journey-1',
      currentOwner,
      async () => { throw new DOMException('locks unavailable', 'NotAllowedError'); },
    )).resolves.toEqual({
      kind: 'candidates',
      candidates: [{
        ownerId: ownerA,
        generation: pending.generation,
        updatedAt: pending.updatedAt,
      }],
    });
    expect(outbox.adoptMomentOutbox).not.toHaveBeenCalled();
  });

  it('atomically adopts a confirmed candidate even when lock probing rejects', async () => {
    const pending = record();
    const outbox = outboxStub([pending]);

    await expect(adoptMomentOutboxCandidate(
      outbox,
      'moment-1',
      'journey-1',
      currentOwner,
      { ownerId: ownerA, generation: pending.generation, updatedAt: pending.updatedAt },
      async () => { throw new DOMException('locks unavailable', 'NotAllowedError'); },
    )).resolves.toEqual({
      kind: 'recovered',
      record: { ...pending, ownerId: currentOwner },
    });
    expect(outbox.adoptMomentOutbox).toHaveBeenCalledOnce();
  });

  it('re-discovers and adopts a newer generation after an automatic CAS miss', async () => {
    const first = record({ generation: 'generation-1' });
    const newer = record({
      generation: 'generation-2',
      updatedAt: '2026-07-13T00:00:01.000Z',
    });
    let stored = first;
    const outbox = outboxStub([first]);
    vi.mocked(outbox.listMomentOutboxesByJourney).mockImplementation(async () => [stored]);
    vi.mocked(outbox.adoptMomentOutbox)
      .mockImplementationOnce(async () => {
        stored = newer;
        return undefined;
      })
      .mockImplementationOnce(async () => ({ ...newer, ownerId: currentOwner }));
    const release = vi.fn(async () => undefined);

    await expect(readMomentOutbox(
      outbox,
      'moment-1',
      'journey-1',
      currentOwner,
      async (ownerId) => ({ ownerId, release }),
    )).resolves.toEqual({
      kind: 'recovered',
      record: { ...newer, ownerId: currentOwner },
    });

    expect(outbox.adoptMomentOutbox).toHaveBeenNthCalledWith(
      2,
      'moment-1',
      'journey-1',
      ownerA,
      currentOwner,
      newer.generation,
    );
    expect(outbox.listMomentOutboxesByJourney).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns a refreshed exact-scope candidate after an explicit CAS miss', async () => {
    const first = record({ generation: 'generation-1' });
    const newer = record({
      generation: 'generation-2',
      updatedAt: '2026-07-13T00:00:01.000Z',
    });
    const wrongJourney = record({
      journeyId: 'journey-elsewhere',
      ownerId: ownerB,
      generation: 'wrong-journey',
    });
    const wrongMoment = record({
      momentId: 'moment-elsewhere',
      ownerId: ownerB,
      generation: 'wrong-moment',
    });
    let stored = first;
    const outbox = outboxStub([first]);
    vi.mocked(outbox.listMomentOutboxesByJourney).mockImplementation(async () => [
      wrongJourney,
      stored,
      wrongMoment,
    ]);
    vi.mocked(outbox.adoptMomentOutbox).mockImplementationOnce(async () => {
      stored = newer;
      return undefined;
    });

    await expect(adoptMomentOutboxCandidate(
      outbox,
      'moment-1',
      'journey-1',
      currentOwner,
      { ownerId: ownerA, generation: first.generation, updatedAt: first.updatedAt },
      async () => undefined,
    )).resolves.toEqual({
      kind: 'candidates',
      candidates: [{
        ownerId: ownerA,
        generation: newer.generation,
        updatedAt: newer.updatedAt,
      }],
    });

    expect(outbox.adoptMomentOutbox).toHaveBeenCalledOnce();
    expect(outbox.getMomentOutbox).toHaveBeenCalledOnce();
    expect(outbox.listMomentOutboxesByJourney).toHaveBeenCalledOnce();
  });

  it('holds the recovery owner claim through explicit CAS rediscovery', async () => {
    const pending = record();
    const freshList = deferred<MomentAutosaveOutboxRecord[]>();
    const outbox = outboxStub([pending]);
    vi.mocked(outbox.adoptMomentOutbox).mockResolvedValueOnce(undefined);
    vi.mocked(outbox.listMomentOutboxesByJourney).mockImplementationOnce(() => freshList.promise);
    const release = vi.fn(async () => undefined);

    const adoption = adoptMomentOutboxCandidate(
      outbox,
      'moment-1',
      'journey-1',
      currentOwner,
      { ownerId: ownerA, generation: pending.generation, updatedAt: pending.updatedAt },
      async (ownerId) => ({ ownerId, release }),
    );

    await vi.waitFor(() => expect(outbox.listMomentOutboxesByJourney).toHaveBeenCalledOnce());
    expect(release).not.toHaveBeenCalled();

    freshList.resolve([]);
    await expect(adoption).resolves.toEqual({ kind: 'none' });
    expect(release).toHaveBeenCalledOnce();
  });
});
