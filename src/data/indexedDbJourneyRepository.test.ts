// @ts-expect-error Node built-in declarations are intentionally excluded from the browser tsconfig.
import { Blob as NodeBlob } from 'node:buffer';
import { openDB, type IDBPDatabase } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewJourney, NormalizedPhotoInput, PrivateJourneySnapshot } from '../domain/model';
import { cleanupDb, uniqueDbName } from '../test/indexedDb';
import { DB_VERSION, openSoundPassportDb, type SoundPassportDb } from './indexedDb';
import { createIndexedDbJourneyRepository } from './indexedDbJourneyRepository';
import type { JourneyAutosaveOutboxRecord } from './ports';

const databaseNames: string[] = [];
const openDatabases: Array<{ close(): void }> = [];

function trackDatabase<T extends { close(): void }>(db: T) {
  openDatabases.push(db);
  return db;
}

function databaseName(testName: string) {
  const name = uniqueDbName(testName);
  databaseNames.push(name);
  return name;
}

function journeyInput(overrides: Partial<NewJourney> = {}): NewJourney {
  return {
    title: 'Test Journey',
    countryCode: 'ZZ',
    countryName: 'Testland',
    countryCoordinates: [12, 34],
    cityLabels: ['Sample City'],
    startDate: '2026-01-02',
    endDate: '2026-01-03',
    summary: 'A synthetic journey for repository tests.',
    ...overrides,
  };
}

function photoInput(fileName: string, contents = fileName): NormalizedPhotoInput {
  const blob = new NodeBlob([contents], { type: 'image/jpeg' }) as unknown as Blob;
  return {
    blob,
    contentType: blob.type,
    originalFileName: fileName,
    width: 1200,
    height: 800,
    byteSize: blob.size,
  };
}

function outboxRecord(
  journeyId: string,
  generation: string,
  title: string,
  ownerId = ownerA,
): JourneyAutosaveOutboxRecord {
  return {
    journeyId,
    ownerId,
    generation,
    envelope: {
      patch: { title },
      base: { title: 'Test Journey' },
    },
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const ownerC = '33333333-3333-4333-8333-333333333333';

function ownerOutboxRecord(
  journeyId: string,
  ownerId: string,
  generation: string,
  title: string,
): JourneyAutosaveOutboxRecord {
  return outboxRecord(journeyId, generation, title, ownerId);
}

function primaryKeys(snapshot: PrivateJourneySnapshot) {
  return {
    journeys: snapshot.journeys.map(({ id }) => id).sort(),
    moments: snapshot.moments.map(({ id }) => id).sort(),
    songs: snapshot.songs.map(({ id }) => id).sort(),
    photos: snapshot.photos.map(({ id }) => id).sort(),
  };
}

function prefixedSnapshot(snapshot: PrivateJourneySnapshot, prefix: string): PrivateJourneySnapshot {
  const journeyIds = new Map(snapshot.journeys.map(({ id }) => [id, `${prefix}${id}`]));
  const momentIds = new Map(snapshot.moments.map(({ id }) => [id, `${prefix}${id}`]));
  const songIds = new Map(snapshot.songs.map(({ id }) => [id, `${prefix}${id}`]));
  const photoIds = new Map(snapshot.photos.map(({ id }) => [id, `${prefix}${id}`]));

  return {
    journeys: snapshot.journeys.map((journey) => ({
      ...journey,
      id: journeyIds.get(journey.id)!,
      coverPhotoAssetId: journey.coverPhotoAssetId
        ? photoIds.get(journey.coverPhotoAssetId)!
        : undefined,
    })),
    moments: snapshot.moments.map((moment) => ({
      ...moment,
      id: momentIds.get(moment.id)!,
      journeyId: journeyIds.get(moment.journeyId)!,
      songReferenceId: songIds.get(moment.songReferenceId)!,
      photoAssetId: moment.photoAssetId ? photoIds.get(moment.photoAssetId)! : undefined,
    })),
    songs: snapshot.songs.map((song) => ({ ...song, id: songIds.get(song.id)! })),
    photos: snapshot.photos.map((photo) => ({ ...photo, id: photoIds.get(photo.id)! })),
  };
}

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return (blob as unknown as NodeBlob).arrayBuffer().then((bytes: ArrayBuffer) => new Uint8Array(bytes));
}

async function openRepository(testName: string) {
  const name = databaseName(testName);
  const db = trackDatabase(await openSoundPassportDb(name));
  return { db, name, repository: createIndexedDbJourneyRepository({ db }) };
}

async function createCompleteValidJourney(
  repository: ReturnType<typeof createIndexedDbJourneyRepository>,
  overrides: Partial<NewJourney> = {},
) {
  const created = await repository.createJourney(journeyInput(overrides));
  const [moment] = await repository.addMoments(created.id, [photoInput('valid.jpg')]);
  await repository.updateMoment(moment.id, {
    song: { title: 'Valid title', artist: 'Valid artist', sourceUrl: '' },
  });
  const readyStory = await repository.getPrivateJourneyStory(created.id);
  const review = await repository.setJourneyStatus(created.id, 'review', {
    expectedUpdatedAt: readyStory!.journey.updatedAt,
  });
  const journey = await repository.setJourneyStatus(created.id, 'complete', {
    expectedUpdatedAt: review.updatedAt,
  });
  return { journey, moment };
}

function withMutationAfterReorderPreflight(
  db: IDBPDatabase<SoundPassportDb>,
  afterPreflight: () => Promise<void>,
) {
  let intercepted = false;

  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'transaction') {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return (...args: Parameters<IDBPDatabase<SoundPassportDb>['transaction']>) => {
        const transaction = target.transaction(...args);
        if (intercepted || args[0] !== 'moments' || args[1] !== 'readonly') return transaction;
        intercepted = true;

        return new Proxy(transaction, {
          get(transactionTarget, transactionProperty, transactionReceiver) {
            if (transactionProperty === 'done') {
              return (async () => {
                await transactionTarget.done;
                await afterPreflight();
              })();
            }
            const value = Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
            return typeof value === 'function' ? value.bind(transactionTarget) : value;
          },
        });
      };
    },
  }) as IDBPDatabase<SoundPassportDb>;
}

afterEach(async () => {
  openDatabases.splice(0).forEach((db) => db.close());
  await Promise.all(databaseNames.splice(0).map(cleanupDb));
});

describe('indexedDbJourneyRepository', () => {
  it('atomically overwrites one journey outbox record with its latest generation', async () => {
    const { db, repository } = await openRepository('outbox-overwrite');
    const journey = await repository.createJourney(journeyInput());
    const first = outboxRecord(journey.id, 'generation-1', 'First pending title');
    const latest = outboxRecord(journey.id, 'generation-2', 'Latest pending title');
    const transactionSpy = vi.spyOn(db, 'transaction');

    await repository.put(first);
    await repository.put(latest);

    expect(await repository.get(journey.id, ownerA)).toEqual(latest);
    expect(transactionSpy.mock.calls.filter(([stores, mode]) => (
      Array.isArray(stores) &&
      stores.join(',') === 'journeys,journeyAutosaveOutbox' &&
      mode === 'readwrite'
    ))).toHaveLength(3);
  });

  it('deletes an outbox record only when its generation exactly matches', async () => {
    const { repository } = await openRepository('outbox-compare-delete');
    const journey = await repository.createJourney(journeyInput());
    const latest = outboxRecord(journey.id, 'generation-2', 'Latest pending title');
    await repository.put(latest);

    await expect(repository.compareAndDelete(journey.id, ownerA, 'generation-1')).resolves.toBe(false);
    await expect(repository.get(journey.id, ownerA)).resolves.toEqual(latest);
    await expect(repository.compareAndDelete(journey.id, ownerA, 'generation-2')).resolves.toBe(true);
    await expect(repository.get(journey.id, ownerA)).resolves.toBeUndefined();
  });

  it('maps an outbox quota failure and leaves the prior generation intact', async () => {
    const { repository } = await openRepository('outbox-quota');
    const journey = await repository.createJourney(journeyInput());
    const first = outboxRecord(journey.id, 'generation-1', 'Recoverable title');
    await repository.put(first);
    const quotaError = new DOMException('quota reached', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw quotaError; });

    await expect(repository.put(outboxRecord(journey.id, 'generation-2', 'Lost title')))
      .rejects.toMatchObject({ name: 'StorageCapacityError', cause: quotaError });
    await expect(repository.get(journey.id, ownerA)).resolves.toEqual(first);
  });

  it('clears the private outbox but never includes it in export snapshots', async () => {
    const { repository } = await openRepository('outbox-private-data');
    const journey = await repository.createJourney(journeyInput());
    await repository.put(outboxRecord(journey.id, 'generation-1', 'Private pending title'));

    const exported = await repository.exportSnapshot();
    expect(Object.keys(exported).sort()).toEqual(['journeys', 'moments', 'photos', 'songs']);
    expect(exported.journeys).toHaveLength(1);
    await expect(repository.get(journey.id, ownerA)).resolves.toBeDefined();

    await repository.clearPrivateData();

    await expect(repository.get(journey.id, ownerA)).resolves.toBeUndefined();
    await expect(repository.exportSnapshot()).resolves.toEqual({
      journeys: [], moments: [], songs: [], photos: [],
    });
  });

  it('keeps exact owner outboxes independent and compare-deletes only that owner generation', async () => {
    const { repository } = await openRepository('owner-scoped-outbox');
    const journey = await repository.createJourney(journeyInput());
    const outbox = repository;
    const firstOwner = ownerOutboxRecord(journey.id, ownerA, 'generation-a', 'Owner A title');
    const secondOwner = ownerOutboxRecord(journey.id, ownerB, 'generation-b', 'Owner B title');

    await outbox.put(firstOwner);
    await outbox.put(secondOwner);

    await expect(outbox.get(journey.id, ownerA)).resolves.toEqual(firstOwner);
    await expect(outbox.get(journey.id, ownerB)).resolves.toEqual(secondOwner);
    await expect(outbox.listByJourney(journey.id)).resolves.toEqual([firstOwner, secondOwner]);
    await expect(outbox.compareAndDelete(journey.id, ownerA, 'stale-generation')).resolves.toBe(false);
    await expect(outbox.compareAndDelete(journey.id, ownerA, firstOwner.generation)).resolves.toBe(true);
    await expect(outbox.get(journey.id, ownerA)).resolves.toBeUndefined();
    await expect(outbox.get(journey.id, ownerB)).resolves.toEqual(secondOwner);
  });

  it('atomically adopts the selected owner generation while retaining unselected records', async () => {
    const { repository } = await openRepository('owner-adoption');
    const journey = await repository.createJourney(journeyInput());
    const outbox = repository;
    const outstanding = ownerOutboxRecord(journey.id, ownerA, 'generation-a', 'Outstanding title');
    await outbox.put(outstanding);

    await expect(outbox.adopt(journey.id, ownerA, ownerB, outstanding.generation)).resolves.toEqual({
      ...outstanding,
      ownerId: ownerB,
    });
    await expect(outbox.get(journey.id, ownerA)).resolves.toBeUndefined();
    await expect(outbox.get(journey.id, ownerB)).resolves.toEqual({ ...outstanding, ownerId: ownerB });

    const independent = ownerOutboxRecord(journey.id, ownerC, 'generation-c', 'Independent title');
    await outbox.put(independent);
    await expect(outbox.adopt(journey.id, ownerB, ownerA, 'stale-generation')).resolves.toBeUndefined();
    await expect(outbox.adopt(journey.id, ownerB, ownerA, outstanding.generation)).resolves.toEqual({
      ...outstanding,
      ownerId: ownerA,
    });
    await expect(outbox.listByJourney(journey.id)).resolves.toEqual([
      { ...outstanding, ownerId: ownerA },
      independent,
    ]);
  });

  it('rejects an outbox write whose parent journey does not exist', async () => {
    const { repository } = await openRepository('outbox-missing-parent');
    const outbox = repository;
    const orphan = ownerOutboxRecord('missing-journey', ownerA, 'generation-a', 'Orphan title');

    await expect(outbox.put(orphan)).rejects.toThrow(/Journey missing-journey was not found/);
    await expect(outbox.listByJourney('missing-journey')).resolves.toEqual([]);
  });

  it.each(['get', 'list', 'adopt'] as const)(
    'verifies the parent and removes a runtime orphan during outbox %s',
    async (operation) => {
      const { db, repository } = await openRepository(`outbox-runtime-orphan-${operation}`);
      const orphan = ownerOutboxRecord('missing-journey', ownerA, 'generation-a', 'Orphan title');
      const seed = db.transaction('journeyAutosaveOutbox', 'readwrite');
      await seed.store.put(orphan);
      await seed.done;

      if (operation === 'get') {
        await expect(repository.get(orphan.journeyId, ownerA)).resolves.toBeUndefined();
      } else if (operation === 'list') {
        await expect(repository.listByJourney(orphan.journeyId)).resolves.toEqual([]);
      } else {
        await expect(repository.adopt(
          orphan.journeyId,
          ownerA,
          ownerB,
          orphan.generation,
        )).resolves.toBeUndefined();
      }

      const verify = db.transaction('journeyAutosaveOutbox', 'readonly');
      await expect(verify.store.get([orphan.journeyId, ownerA])).resolves.toBeUndefined();
      await verify.done;
    },
  );

  it('deletes every owner outbox in the same journey cascade transaction', async () => {
    const { db, repository } = await openRepository('outbox-delete-cascade');
    const journey = await repository.createJourney(journeyInput());
    const outbox = repository;
    await outbox.put(ownerOutboxRecord(journey.id, ownerA, 'generation-a', 'Owner A title'));
    await outbox.put(ownerOutboxRecord(journey.id, ownerB, 'generation-b', 'Owner B title'));
    const transactionSpy = vi.spyOn(db, 'transaction');

    await repository.deleteJourney(journey.id);

    await expect(outbox.listByJourney(journey.id)).resolves.toEqual([]);
    expect(transactionSpy.mock.calls.some(([stores, mode]) => (
      Array.isArray(stores) &&
      stores.includes('journeys') &&
      stores.includes('journeyAutosaveOutbox') &&
      mode === 'readwrite'
    ))).toBe(true);
  });

  it('rolls back every entity and owner outbox when a late cascade delete request fails', async () => {
    const { db, repository } = await openRepository('delete-cascade-request-failure');
    const journey = await repository.createJourney(journeyInput());
    const [moment] = await repository.addMoments(journey.id, [photoInput('rollback-delete.jpg')]);
    await repository.updateJourney(journey.id, { coverPhotoAssetId: moment.photoAssetId });
    const ownerARecord = ownerOutboxRecord(journey.id, ownerA, 'generation-a', 'Owner A title');
    const ownerBRecord = ownerOutboxRecord(journey.id, ownerB, 'generation-b', 'Owner B title');
    await repository.put(ownerARecord);
    await repository.put(ownerBRecord);
    const beforeDelete = await repository.exportSnapshot();
    const forcedFailure = new Error('forced photo delete failure');
    const originalDelete = IDBObjectStore.prototype.delete;
    let queuedDeleteRequests = 0;
    const deleteSpy = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
      this: IDBObjectStore,
      key: IDBValidKey | IDBKeyRange,
    ) {
      if (this.name === 'photos') throw forcedFailure;
      queuedDeleteRequests += 1;
      return originalDelete.call(this, key);
    });

    try {
      await expect(repository.deleteJourney(journey.id)).rejects.toBe(forcedFailure);
    } finally {
      deleteSpy.mockRestore();
    }

    expect(queuedDeleteRequests).toBeGreaterThanOrEqual(5);
    expect(await repository.exportSnapshot()).toEqual(beforeDelete);
    await expect(repository.listByJourney(journey.id)).resolves.toEqual([ownerARecord, ownerBRecord]);
    db.close();
  });

  it.each(['put-first', 'delete-first'] as const)(
    'leaves no orphan for a deterministic put-vs-delete race: %s',
    async (order) => {
      const { repository } = await openRepository(`put-delete-${order}`);
      const journey = await repository.createJourney(journeyInput());
      const outbox = repository;
      const pending = ownerOutboxRecord(journey.id, ownerA, 'generation-a', 'Pending title');

      let put!: Promise<void>;
      let deletion!: Promise<void>;
      if (order === 'put-first') {
        put = outbox.put(pending);
        deletion = repository.deleteJourney(journey.id);
      } else {
        deletion = repository.deleteJourney(journey.id);
        put = outbox.put(pending);
      }
      const [putResult, deletionResult] = await Promise.allSettled([put, deletion]);

      expect(deletionResult.status).toBe('fulfilled');
      expect(putResult.status).toBe(order === 'put-first' ? 'fulfilled' : 'rejected');
      await expect(repository.getPrivateJourneyStory(journey.id)).resolves.toBeUndefined();
      await expect(outbox.listByJourney(journey.id)).resolves.toEqual([]);
    },
  );

  it.each(['put-first', 'clear-first'] as const)(
    'leaves no orphan for a deterministic put-vs-clear race: %s',
    async (order) => {
      const { repository } = await openRepository(`put-clear-${order}`);
      const journey = await repository.createJourney(journeyInput());
      const outbox = repository;
      const pending = ownerOutboxRecord(journey.id, ownerA, 'generation-a', 'Pending title');

      let put!: Promise<void>;
      let clear!: Promise<void>;
      if (order === 'put-first') {
        put = outbox.put(pending);
        clear = repository.clearPrivateData();
      } else {
        clear = repository.clearPrivateData();
        put = outbox.put(pending);
      }
      const [putResult, clearResult] = await Promise.allSettled([put, clear]);

      expect(clearResult.status).toBe('fulfilled');
      expect(putResult.status).toBe(order === 'put-first' ? 'fulfilled' : 'rejected');
      await expect(repository.getPrivateJourneyStory(journey.id)).resolves.toBeUndefined();
      await expect(outbox.listByJourney(journey.id)).resolves.toEqual([]);
    },
  );

  it('persists a new private draft after the database is reopened', async () => {
    const name = databaseName('reopen');
    const db = trackDatabase(await openSoundPassportDb(name));
    const created = await createIndexedDbJourneyRepository({ db }).createJourney(journeyInput());

    expect(created).toMatchObject({ status: 'draft', source: 'private' });
    db.close();

    const reopenedDb = trackDatabase(await openSoundPassportDb(name));
    const journeys = await createIndexedDbJourneyRepository({ db: reopenedDb }).listPrivateJourneys();
    expect(journeys).toEqual([created]);
    reopenedDb.close();
  });

  it('updates selected journey fields while preserving the rest and refreshing updatedAt', async () => {
    const { db, name, repository } = await openRepository('update');
    const created = await repository.createJourney(journeyInput());
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repository.updateJourney(created.id, { title: 'Renamed Journey' });

    const { updatedAt: _createdUpdatedAt, ...unchangedFields } = created;
    expect(updated).toMatchObject({ ...unchangedFields, title: 'Renamed Journey' });
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    db.close();

    const reopenedDb = trackDatabase(await openSoundPassportDb(name));
    const persisted = await createIndexedDbJourneyRepository({ db: reopenedDb }).listPrivateJourneys();
    expect(persisted).toEqual([updated]);
    reopenedDb.close();
  });

  it('rejects a stale expected journey version and rolls back every field in the conflicting patch', async () => {
    const { db, repository } = await openRepository('update-version-conflict');
    const created = await repository.createJourney(journeyInput());
    const firstUpdate = await repository.updateJourney(
      created.id,
      { title: 'First writer' },
      { expectedUpdatedAt: created.updatedAt },
    );
    const beforeConflict = await repository.exportSnapshot();

    await expect(repository.updateJourney(
      created.id,
      { title: 'Stale writer', summary: 'This must not be persisted.' },
      { expectedUpdatedAt: created.updatedAt },
    )).rejects.toMatchObject({
      name: 'JourneyVersionConflictError',
      journeyId: created.id,
      expectedUpdatedAt: created.updatedAt,
      actualUpdatedAt: firstUpdate.updatedAt,
    });

    expect(await repository.exportSnapshot()).toEqual(beforeConflict);
    db.close();
  });

  it('advances updatedAt monotonically when multiple writes happen in the same millisecond', async () => {
    const fixedNow = new Date('2099-04-05T06:07:08.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(fixedNow.getTime());
    try {
      const { db, repository } = await openRepository('monotonic-update-version');
      const created = await repository.createJourney(journeyInput());
      const firstUpdate = await repository.updateJourney(created.id, { title: 'First' });
      const secondUpdate = await repository.updateJourney(created.id, { title: 'Second' });

      expect(firstUpdate.updatedAt).toBe(fixedNow.toISOString());
      expect(secondUpdate.updatedAt).toBe(new Date(fixedNow.getTime() + 1).toISOString());
      db.close();
    } finally {
      now.mockRestore();
    }
  });

  it('adds moments, songs, and photo assets in photo selection order', async () => {
    const { db, repository } = await openRepository('add-moments');
    const journey = await repository.createJourney(journeyInput());

    const moments = await repository.addMoments(journey.id, [
      photoInput('first.jpg', 'first'),
      photoInput('second.jpg', 'second'),
    ]);
    const snapshot = await repository.exportSnapshot();

    expect(moments.map((moment) => moment.sortOrder)).toEqual([0, 1]);
    expect(snapshot.moments.map((moment) => moment.id)).toEqual(moments.map((moment) => moment.id));
    expect(snapshot.photos.map((photo) => photo.originalFileName)).toEqual(['first.jpg', 'second.jpg']);
    expect(snapshot.songs).toHaveLength(2);
    expect(moments.map((moment) => moment.photoAssetId)).toEqual(snapshot.photos.map((photo) => photo.id));
    expect(moments.map((moment) => moment.songReferenceId)).toEqual(snapshot.songs.map((song) => song.id));
    db.close();
  });

  it('validates and version-checks each forward lifecycle transition in the status transaction', async () => {
    const { db, repository } = await openRepository('validated-status-transition');
    const journey = await repository.createJourney(journeyInput());

    await expect(repository.setJourneyStatus(journey.id, 'review', {
      expectedUpdatedAt: journey.updatedAt,
    })).rejects.toMatchObject({
      name: 'JourneyValidationError',
      issues: [{ field: 'moments', code: 'at_least_one' }],
    });
    expect((await repository.getPrivateJourneyStory(journey.id))?.journey.status).toBe('draft');

    const [moment] = await repository.addMoments(journey.id, [photoInput('review.jpg')]);
    await repository.updateMoment(moment.id, {
      song: { title: 'Review title', artist: 'Review artist', sourceUrl: '' },
    });
    const ready = await repository.getPrivateJourneyStory(journey.id);

    await expect(repository.setJourneyStatus(journey.id, 'complete', {
      expectedUpdatedAt: ready!.journey.updatedAt,
    })).rejects.toMatchObject({ name: 'JourneyStatusTransitionError' });

    const review = await repository.setJourneyStatus(journey.id, 'review', {
      expectedUpdatedAt: ready!.journey.updatedAt,
    });
    await expect(repository.setJourneyStatus(journey.id, 'complete', {
      expectedUpdatedAt: ready!.journey.updatedAt,
    })).rejects.toMatchObject({
      name: 'JourneyVersionConflictError',
      actualUpdatedAt: review.updatedAt,
    });

    const complete = await repository.setJourneyStatus(journey.id, 'complete', {
      expectedUpdatedAt: review.updatedAt,
    });
    expect(complete.status).toBe('complete');
    db.close();
  });

  it.each([
    ['missing options', undefined],
    ['missing token', {}],
    ['blank token', { expectedUpdatedAt: '   ' }],
  ])('rejects a runtime %s before lifecycle validation', async (_label, options) => {
    const { db, repository } = await openRepository(`status-token-${_label}`);
    const journey = await repository.createJourney(journeyInput());
    const runtimeSetJourneyStatus = repository.setJourneyStatus as unknown as (
      id: string,
      status: 'review',
      unsafeOptions?: { expectedUpdatedAt?: string },
    ) => Promise<unknown>;

    await expect(runtimeSetJourneyStatus(journey.id, 'review', options)).rejects.toMatchObject({
      name: 'JourneyVersionConflictError',
      journeyId: journey.id,
      actualUpdatedAt: journey.updatedAt,
    });
    expect((await repository.getPrivateJourneyStory(journey.id))?.journey.status).toBe('draft');
    db.close();
  });

  it('rejects a stale direct completion before checking the draft transition', async () => {
    const { db, repository } = await openRepository('stale-direct-completion');
    const created = await repository.createJourney(journeyInput());
    const [moment] = await repository.addMoments(created.id, [photoInput('stale-complete.jpg')]);
    await repository.updateMoment(moment.id, {
      song: { title: 'Valid title', artist: 'Valid artist', sourceUrl: '' },
    });
    const staleStory = await repository.getPrivateJourneyStory(created.id);
    const latest = await repository.updateJourney(
      created.id,
      { summary: 'A concurrent summary.' },
      { expectedUpdatedAt: staleStory!.journey.updatedAt },
    );

    await expect(repository.setJourneyStatus(created.id, 'complete', {
      expectedUpdatedAt: staleStory!.journey.updatedAt,
    })).rejects.toMatchObject({
      name: 'JourneyVersionConflictError',
      actualUpdatedAt: latest.updatedAt,
    });
    expect((await repository.getPrivateJourneyStory(created.id))?.journey.status).toBe('draft');
    db.close();
  });

  it('uses freshly loaded monotonic versions for both transitions in the same millisecond', async () => {
    const fixedNow = new Date('2099-06-07T08:09:10.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(fixedNow.getTime());
    try {
      const { db, repository } = await openRepository('same-millisecond-status-versions');
      const created = await repository.createJourney(journeyInput());
      const [moment] = await repository.addMoments(created.id, [photoInput('same-millisecond.jpg')]);
      await repository.updateMoment(moment.id, {
        song: { title: 'Valid title', artist: 'Valid artist', sourceUrl: '' },
      });
      const readyStory = await repository.getPrivateJourneyStory(created.id);

      const review = await repository.setJourneyStatus(created.id, 'review', {
        expectedUpdatedAt: readyStory!.journey.updatedAt,
      });
      const reviewStory = await repository.getPrivateJourneyStory(created.id);
      expect(reviewStory?.journey.updatedAt).toBe(review.updatedAt);

      const complete = await repository.setJourneyStatus(created.id, 'complete', {
        expectedUpdatedAt: reviewStory!.journey.updatedAt,
      });
      expect(Date.parse(review.updatedAt)).toBe(Date.parse(readyStory!.journey.updatedAt) + 1);
      expect(Date.parse(complete.updatedAt)).toBe(Date.parse(review.updatedAt) + 1);
      db.close();
    } finally {
      now.mockRestore();
    }
  });

  it('demotes a complete journey in the same journey-field save and removes it from live queries', async () => {
    const { db, repository } = await openRepository('journey-field-demotion');
    const { journey } = await createCompleteValidJourney(repository);

    const demoted = await repository.updateJourney(
      journey.id,
      { title: '' },
      { expectedUpdatedAt: journey.updatedAt },
    );

    expect(demoted.status).toBe('review');
    expect((await repository.getPrivateJourneyStory(journey.id))?.journey.title).toBe('');
    expect(await repository.getJourneyStory(journey.id)).toBeUndefined();
    expect(await repository.listJourneysByCountry(journey.countryCode)).toEqual([]);
    expect(await repository.listCountrySummaries()).toEqual([]);
    db.close();
  });

  it('batch-creates moments, advances the story version, and demotes an invalid complete journey atomically', async () => {
    const { db, repository } = await openRepository('add-moments-story-version');
    const { journey: plannedJourney } = await createCompleteValidJourney(repository);

    await repository.addMoments(plannedJourney.id, [photoInput('new-invalid.jpg')]);

    const story = await repository.getPrivateJourneyStory(plannedJourney.id);
    expect(story?.journey.status).toBe('review');
    expect(Date.parse(story!.journey.updatedAt)).toBeGreaterThan(Date.parse(plannedJourney.updatedAt));
    await expect(repository.updateJourney(
      plannedJourney.id,
      { summary: 'Stale editor save' },
      { expectedUpdatedAt: plannedJourney.updatedAt },
    )).rejects.toMatchObject({ name: 'JourneyVersionConflictError' });
    db.close();
  });

  it('advances the story version for moment and song updates so a planned editor save rejects', async () => {
    const { db, repository } = await openRepository('update-moment-story-version');
    const { journey: plannedJourney, moment } = await createCompleteValidJourney(repository);

    await repository.updateMoment(moment.id, {
      localDate: '2026-02-01',
      song: { title: 'Concurrent title', artist: 'Concurrent artist', sourceUrl: '' },
    });

    const story = await repository.getPrivateJourneyStory(plannedJourney.id);
    expect(story?.journey.status).toBe('review');
    expect(story?.moments[0].song.title).toBe('Concurrent title');
    expect(Date.parse(story!.journey.updatedAt)).toBeGreaterThan(Date.parse(plannedJourney.updatedAt));
    await expect(repository.updateJourney(
      plannedJourney.id,
      { title: 'Editor planned against the old story' },
      { expectedUpdatedAt: plannedJourney.updatedAt },
    )).rejects.toMatchObject({
      name: 'JourneyVersionConflictError',
      actualUpdatedAt: story?.journey.updatedAt,
    });
    expect((await repository.getPrivateJourneyStory(plannedJourney.id))?.journey.title).toBe(plannedJourney.title);
    db.close();
  });

  it('rejects a stale expected moment version before writing either the moment or its song', async () => {
    const { db, repository } = await openRepository('update-moment-version-conflict');
    const journey = await repository.createJourney(journeyInput());
    const [moment] = await repository.addMoments(journey.id, [photoInput('versioned.jpg')]);
    const firstUpdate = await repository.updateMoment(
      moment.id,
      {
        caption: 'First committed caption',
        song: { title: 'First title', artist: 'First artist', sourceUrl: '' },
      },
      { expectedUpdatedAt: moment.updatedAt },
    );
    const beforeConflict = await repository.exportSnapshot();

    await expect(repository.updateMoment(
      moment.id,
      {
        caption: 'Stale caption must not persist',
        song: { title: 'Stale title', artist: 'Stale artist', sourceUrl: '' },
      },
      { expectedUpdatedAt: moment.updatedAt },
    )).rejects.toMatchObject({
      name: 'MomentVersionConflictError',
      momentId: moment.id,
      expectedUpdatedAt: moment.updatedAt,
      actualUpdatedAt: firstUpdate.updatedAt,
    });

    expect(await repository.exportSnapshot()).toEqual(beforeConflict);
    db.close();
  });

  it('advances moment versions monotonically for same-millisecond updates and reorder writes', async () => {
    const fixedNow = new Date('2099-04-05T06:07:08.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(fixedNow.getTime());
    try {
      const { db, repository } = await openRepository('monotonic-moment-version');
      const journey = await repository.createJourney(journeyInput());
      const [moment] = await repository.addMoments(journey.id, [photoInput('monotonic.jpg')]);

      const firstUpdate = await repository.updateMoment(
        moment.id,
        { caption: 'First' },
        { expectedUpdatedAt: moment.updatedAt },
      );
      const secondUpdate = await repository.updateMoment(
        moment.id,
        { caption: 'Second' },
        { expectedUpdatedAt: firstUpdate.updatedAt },
      );
      await repository.reorderMoments(journey.id, [moment.id]);
      const reordered = (await repository.getPrivateJourneyStory(journey.id))!.moments[0];

      expect(firstUpdate.updatedAt).toBe(fixedNow.toISOString());
      expect(secondUpdate.updatedAt).toBe(new Date(fixedNow.getTime() + 1).toISOString());
      expect(reordered.updatedAt).toBe(new Date(fixedNow.getTime() + 2).toISOString());
      db.close();
    } finally {
      now.mockRestore();
    }
  });

  it('advances the story version and revalidates a complete journey while reordering', async () => {
    const { db, repository } = await openRepository('reorder-story-version');
    const created = await repository.createJourney(journeyInput());
    const moments = await repository.addMoments(created.id, [photoInput('one.jpg'), photoInput('two.jpg')]);
    for (const [index, moment] of moments.entries()) {
      await repository.updateMoment(moment.id, {
        song: { title: `Valid ${index + 1}`, artist: 'Valid artist', sourceUrl: '' },
      });
    }
    const ready = await repository.getPrivateJourneyStory(created.id);
    const review = await repository.setJourneyStatus(created.id, 'review', {
      expectedUpdatedAt: ready!.journey.updatedAt,
    });
    const plannedJourney = await repository.setJourneyStatus(created.id, 'complete', {
      expectedUpdatedAt: review.updatedAt,
    });
    const corruptTx = db.transaction('songs', 'readwrite');
    const corruptSong = await corruptTx.store.get(ready!.moments[0].song.id);
    await corruptTx.store.put({ ...corruptSong!, title: '' });
    await corruptTx.done;

    await repository.reorderMoments(created.id, [moments[1].id, moments[0].id]);

    const story = await repository.getPrivateJourneyStory(created.id);
    expect(story?.moments.map(({ id }) => id)).toEqual([moments[1].id, moments[0].id]);
    expect(story?.journey.status).toBe('review');
    expect(Date.parse(story!.journey.updatedAt)).toBeGreaterThan(Date.parse(plannedJourney.updatedAt));
    db.close();
  });

  it('advances the story version and demotes a complete journey when deleting its last moment', async () => {
    const { db, repository } = await openRepository('delete-moment-story-version');
    const { journey: plannedJourney, moment } = await createCompleteValidJourney(repository);

    await repository.deleteMoment(moment.id);

    const story = await repository.getPrivateJourneyStory(plannedJourney.id);
    expect(story?.moments).toEqual([]);
    expect(story?.journey.status).toBe('review');
    expect(Date.parse(story!.journey.updatedAt)).toBeGreaterThan(Date.parse(plannedJourney.updatedAt));
    db.close();
  });

  it('rolls back a moment write when post-mutation story validation cannot join its song', async () => {
    const { db, repository } = await openRepository('moment-validation-rollback');
    const journey = await repository.createJourney(journeyInput());
    const [moment] = await repository.addMoments(journey.id, [photoInput('rollback.jpg')]);
    const corruptTx = db.transaction('songs', 'readwrite');
    await corruptTx.store.delete(moment.songReferenceId);
    await corruptTx.done;
    const beforeAttempt = await repository.exportSnapshot();

    await expect(repository.updateMoment(moment.id, { caption: 'Must roll back' })).rejects.toThrow(
      /references missing song/i,
    );

    expect(await repository.exportSnapshot()).toEqual(beforeAttempt);
    db.close();
  });

  it('rolls back a failed moment batch without leaving orphan songs or photos', async () => {
    const { db, repository } = await openRepository('add-moments-mid-batch-rollback');
    const journey = await repository.createJourney(journeyInput());
    const beforeAttempt = await repository.exportSnapshot();
    const firstPhotoId = '00000000-0000-4000-8000-000000000001';
    const randomUuid = vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(firstPhotoId)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce(firstPhotoId);

    try {
      await expect(repository.addMoments(journey.id, [
        photoInput('first.jpg'),
        photoInput('second.jpg'),
      ])).rejects.toBeDefined();

      expect(await repository.exportSnapshot()).toEqual(beforeAttempt);
    } finally {
      randomUuid.mockRestore();
      db.close();
    }
  });

  it('rejects incomplete or foreign reorder sets and writes contiguous sort orders', async () => {
    const { db, repository } = await openRepository('reorder');
    const journey = await repository.createJourney(journeyInput({ title: 'First' }));
    const otherJourney = await repository.createJourney(journeyInput({ title: 'Second' }));
    const moments = await repository.addMoments(journey.id, [photoInput('one.jpg'), photoInput('two.jpg')]);
    const [foreignMoment] = await repository.addMoments(otherJourney.id, [photoInput('foreign.jpg')]);

    await expect(repository.reorderMoments(journey.id, [moments[0].id])).rejects.toThrow();
    await expect(repository.reorderMoments(journey.id, [moments[0].id, foreignMoment.id])).rejects.toThrow();

    await repository.reorderMoments(journey.id, [moments[1].id, moments[0].id]);
    const story = await repository.getPrivateJourneyStory(journey.id);
    expect(story?.moments.map((moment) => moment.id)).toEqual([moments[1].id, moments[0].id]);
    expect(story?.moments.map((moment) => moment.sortOrder)).toEqual([0, 1]);
    db.close();
  });

  it('rejects a reorder when a concurrent delete changes the current moment set', async () => {
    const { db, repository } = await openRepository('reorder-concurrent-delete');
    const journey = await repository.createJourney(journeyInput());
    const [deleted, retained] = await repository.addMoments(journey.id, [photoInput('one.jpg'), photoInput('two.jpg')]);
    const reorderingRepository = createIndexedDbJourneyRepository({
      db: withMutationAfterReorderPreflight(db, () => repository.deleteMoment(deleted.id)),
    });

    await expect(reorderingRepository.reorderMoments(journey.id, [retained.id, deleted.id])).rejects.toThrow(
      'Reorder IDs must exactly match the journey moments.',
    );

    expect((await repository.getPrivateJourneyStory(journey.id))?.moments).toEqual([
      expect.objectContaining({ id: retained.id, sortOrder: 1 }),
    ]);
    db.close();
  });

  it('deletes a moment with its unreferenced song and photo in one transaction', async () => {
    const { db, repository } = await openRepository('delete-moment');
    const journey = await repository.createJourney(journeyInput());
    const [deleted, retained] = await repository.addMoments(journey.id, [
      photoInput('delete.jpg'),
      photoInput('retain.jpg'),
    ]);

    await repository.deleteMoment(deleted.id);
    const snapshot = await repository.exportSnapshot();

    expect(snapshot.moments).toEqual([retained]);
    expect(snapshot.songs.map((song) => song.id)).toEqual([retained.songReferenceId]);
    expect(snapshot.photos.map((photo) => photo.id)).toEqual([retained.photoAssetId]);
    db.close();
  });

  it('retains a cover photo after moment deletion and removes it with the journey', async () => {
    const { db, repository } = await openRepository('cover-photo-lifecycle');
    const journey = await repository.createJourney(journeyInput());
    const [moment] = await repository.addMoments(journey.id, [photoInput('cover.jpg')]);
    await repository.updateJourney(journey.id, { coverPhotoAssetId: moment.photoAssetId });

    await repository.deleteMoment(moment.id);
    expect(await repository.getPhotoAsset(moment.photoAssetId!)).toBeDefined();

    await repository.deleteJourney(journey.id);
    expect(await repository.getPhotoAsset(moment.photoAssetId!)).toBeUndefined();
    db.close();
  });

  it('retains shared photo and song records when one moment owner is deleted', async () => {
    const { db, repository } = await openRepository('shared-moment-references');
    const journey = await repository.createJourney(journeyInput());
    const [firstMoment] = await repository.addMoments(journey.id, [photoInput('shared.jpg')]);
    const snapshot = await repository.exportSnapshot();
    const secondMoment = {
      ...firstMoment,
      id: 'second-shared-moment',
      sortOrder: 1,
    };
    const seedTx = db.transaction('moments', 'readwrite');
    await seedTx.store.add(secondMoment);
    await seedTx.done;

    await repository.deleteMoment(firstMoment.id);

    const afterDelete = await repository.exportSnapshot();
    expect(afterDelete.moments).toEqual([secondMoment]);
    expect(afterDelete.songs.map((song) => song.id)).toEqual([firstMoment.songReferenceId]);
    expect(afterDelete.photos.map((photo) => photo.id)).toEqual([firstMoment.photoAssetId]);
    expect(await repository.getPhotoAsset(firstMoment.photoAssetId!)).toBeDefined();
    db.close();
  });

  it('atomically deletes a journey and all records that belong to it', async () => {
    const { db, repository } = await openRepository('delete-journey');
    const deletedJourney = await repository.createJourney(journeyInput({ title: 'Delete' }));
    const retainedJourney = await repository.createJourney(journeyInput({ title: 'Retain' }));
    await repository.addMoments(deletedJourney.id, [photoInput('delete.jpg')]);
    const [retainedMoment] = await repository.addMoments(retainedJourney.id, [photoInput('retain.jpg')]);
    const retainedStory = await repository.getPrivateJourneyStory(retainedJourney.id);

    await repository.deleteJourney(deletedJourney.id);
    const snapshot = await repository.exportSnapshot();

    expect(snapshot.journeys).toEqual([retainedStory?.journey]);
    expect(snapshot.moments).toEqual([retainedMoment]);
    expect(snapshot.songs.map((song) => song.id)).toEqual([retainedMoment.songReferenceId]);
    expect(snapshot.photos.map((photo) => photo.id)).toEqual([retainedMoment.photoAssetId]);
    db.close();
  });

  it('exposes complete journeys to queries and every private status to editor reads', async () => {
    const { db, repository } = await openRepository('visibility');
    const draft = await repository.createJourney(journeyInput({ title: 'Draft' }));
    const review = await repository.createJourney(journeyInput({ title: 'Review' }));
    const [reviewMoment] = await repository.addMoments(review.id, [photoInput('review-visible.jpg')]);
    await repository.updateMoment(reviewMoment.id, {
      song: { title: 'Review song', artist: 'Review artist', sourceUrl: '' },
    });
    const readyReview = await repository.getPrivateJourneyStory(review.id);
    await repository.setJourneyStatus(review.id, 'review', {
      expectedUpdatedAt: readyReview!.journey.updatedAt,
    });
    const { journey: complete } = await createCompleteValidJourney(repository, { title: 'Complete' });

    expect(new Set((await repository.listPrivateJourneys()).map((journey) => journey.id))).toEqual(
      new Set([draft.id, review.id, complete.id]),
    );
    expect((await repository.listJourneysByCountry('ZZ')).map((journey) => journey.id)).toEqual([complete.id]);
    expect(await repository.listCountrySummaries()).toMatchObject([{ journeyCount: 1, latestJourneyTitle: 'Complete' }]);
    expect(await repository.getJourneyStory(draft.id)).toBeUndefined();
    expect((await repository.getJourneyStory(complete.id))?.journey.id).toBe(complete.id);
    expect((await repository.getPrivateJourneyStory(draft.id))?.journey.id).toBe(draft.id);
    db.close();
  });

  it('adds an imported snapshot in one transaction while preserving existing records byte-for-byte', async () => {
    const { db, repository } = await openRepository('additive-import');
    const existingJourney = await repository.createJourney(journeyInput({ title: 'Existing' }));
    await repository.addMoments(existingJourney.id, [photoInput('existing.jpg', 'existing-photo-bytes')]);
    const plannedState = await repository.exportSnapshot();
    const imported = prefixedSnapshot(plannedState, 'imported-');

    const editedJourney = await repository.updateJourney(existingJourney.id, { title: 'Edited after planning' });
    const existingBeforeImport = await repository.exportSnapshot();
    const existingPhotoBytes = await readBlobBytes(existingBeforeImport.photos[0].blob);
    const transactionSpy = vi.spyOn(db, 'transaction');

    await repository.importSnapshot(imported, primaryKeys(plannedState));

    const writeTransactions = transactionSpy.mock.calls.filter(([, mode]) => mode === 'readwrite');
    expect(writeTransactions).toHaveLength(1);
    const after = await repository.exportSnapshot();
    expect(after.journeys.find(({ id }) => id === existingJourney.id)).toEqual(editedJourney);
    expect(after.moments.find(({ id }) => id === existingBeforeImport.moments[0].id))
      .toEqual(existingBeforeImport.moments[0]);
    expect(after.songs.find(({ id }) => id === existingBeforeImport.songs[0].id))
      .toEqual(existingBeforeImport.songs[0]);
    expect(after.photos.find(({ id }) => id === existingBeforeImport.photos[0].id))
      .toEqual(existingBeforeImport.photos[0]);
    expect(await readBlobBytes(after.photos
      .find(({ id }) => id === existingBeforeImport.photos[0].id)!.blob))
      .toEqual(existingPhotoBytes);
    expect(after.journeys).toHaveLength(2);
    expect(after.moments).toHaveLength(2);
    expect(after.songs).toHaveLength(2);
    expect(after.photos).toHaveLength(2);
    db.close();
  });

  it.each(['addition', 'deletion'] as const)(
    'rejects a stale import after a target key %s without writing imported rows',
    async (mutation) => {
      const { db, repository } = await openRepository(`stale-import-${mutation}`);
      const journey = await repository.createJourney(journeyInput({ title: 'Existing' }));
      await repository.addMoments(journey.id, [photoInput('existing.jpg')]);
      const plannedState = await repository.exportSnapshot();
      const imported = prefixedSnapshot(plannedState, 'imported-');

      if (mutation === 'addition') {
        await repository.createJourney(journeyInput({ title: 'Concurrent addition' }));
      } else {
        await repository.deleteJourney(journey.id);
      }
      const beforeAttempt = await repository.exportSnapshot();

      await expect(repository.importSnapshot(imported, primaryKeys(plannedState))).rejects.toMatchObject({
        name: 'PrivateDataStateConflictError',
      });
      expect(await repository.exportSnapshot()).toEqual(beforeAttempt);
      db.close();
    },
  );

  it('rejects an imported-ID collision atomically instead of overwriting the existing row', async () => {
    const { db, repository } = await openRepository('import-id-collision');
    const existingJourney = await repository.createJourney(journeyInput({ title: 'Existing' }));
    await repository.addMoments(existingJourney.id, [photoInput('existing.jpg')]);
    const before = await repository.exportSnapshot();
    const imported = prefixedSnapshot(before, 'imported-');
    imported.journeys[0] = { ...imported.journeys[0], id: existingJourney.id };
    imported.moments[0] = { ...imported.moments[0], journeyId: existingJourney.id };

    await expect(repository.importSnapshot(imported, primaryKeys(before))).rejects.toBeDefined();
    expect(await repository.exportSnapshot()).toEqual(before);
    db.close();
  });

  it.each(['blob:private-photo', ''])(
    'rejects an imported private moment with photoUrl %j and leaves every store unchanged',
    async (photoUrl) => {
    const { db, repository } = await openRepository(`import-private-photo-url-${photoUrl.length}`);
    const existingJourney = await repository.createJourney(journeyInput({ title: 'Existing' }));
    await repository.addMoments(existingJourney.id, [photoInput('existing.jpg')]);
    const before = await repository.exportSnapshot();
    const imported = prefixedSnapshot(before, 'imported-');
    imported.moments[0] = { ...imported.moments[0], photoUrl };

    await expect(repository.importSnapshot(imported, primaryKeys(before))).rejects.toThrow(/relationship/i);
    expect(await repository.exportSnapshot()).toEqual(before);
    db.close();
    },
  );

  it('exports every private record and rolls back an import with a broken relationship', async () => {
    const { db, repository } = await openRepository('snapshot');
    const journey = await repository.createJourney(journeyInput());
    await repository.addMoments(journey.id, [photoInput('snapshot.jpg')]);
    const exported = await repository.exportSnapshot();
    const imported = prefixedSnapshot(exported, 'invalid-');
    const invalid: PrivateJourneySnapshot = {
      ...imported,
      moments: imported.moments.map((moment) => ({ ...moment, journeyId: 'missing-journey' })),
    };

    expect(exported.journeys).toHaveLength(1);
    expect(exported.moments).toHaveLength(1);
    expect(exported.songs).toHaveLength(1);
    expect(exported.photos).toHaveLength(1);
    await expect(repository.importSnapshot(invalid, primaryKeys(exported))).rejects.toThrow(/relationship/i);
    expect(await repository.exportSnapshot()).toEqual(exported);
    db.close();
  });

  it('upgrades a synthetic version 1 database to version 2 and backfills journey metadata', async () => {
    const name = databaseName('migration');
    const legacyJourney = {
      id: 'legacy-journey',
      title: 'Legacy Journey',
      countryCode: 'ZZ',
      countryName: 'Testland',
      countryCoordinates: [12, 34] as [number, number],
      cityLabels: ['Legacy City'],
      startDate: '2025-02-03',
      endDate: '2025-02-04',
      status: 'complete' as const,
    };
    const legacySong = {
      id: 'legacy-song',
      provider: 'manual' as const,
      title: '',
      artist: '',
      availability: 'needs_link' as const,
    };
    const legacyPhoto = {
      id: 'legacy-photo',
      blob: new Blob(['legacy'], { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
      originalFileName: 'legacy.jpg',
      width: 10,
      height: 10,
      byteSize: 6,
      createdAt: '2025-02-03T00:00:00.000Z',
    };
    const legacyMoment = {
      id: 'legacy-moment',
      journeyId: legacyJourney.id,
      photoAssetId: legacyPhoto.id,
      photoAlt: '',
      songReferenceId: legacySong.id,
      localDate: '2025-02-03',
      cityLabel: 'Legacy City',
      placeLabel: '',
      caption: '',
      reason: '',
      reasonStatus: 'needs_review' as const,
      sortOrder: 0,
      createdAt: '2025-02-03T00:00:00.000Z',
      updatedAt: '2025-02-03T00:00:00.000Z',
    };
    const legacyDb = trackDatabase(await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('journeys', { keyPath: 'id' }).put(legacyJourney);
        db.createObjectStore('moments', { keyPath: 'id' }).put(legacyMoment);
        db.createObjectStore('songs', { keyPath: 'id' }).put(legacySong);
        db.createObjectStore('photos', { keyPath: 'id' }).put(legacyPhoto);
      },
    }));
    legacyDb.close();

    const db = trackDatabase(await openSoundPassportDb(name));
    const snapshot = await createIndexedDbJourneyRepository({ db }).exportSnapshot();
    const migratedJourney = snapshot.journeys[0];

    expect(db.version).toBe(DB_VERSION);
    expect(snapshot).toMatchObject({ moments: [legacyMoment], songs: [legacySong], photos: [legacyPhoto] });
    expect(migratedJourney).toMatchObject({
      ...legacyJourney,
      source: 'private',
      summary: '',
    });
    expect(migratedJourney.createdAt).toEqual(expect.any(String));
    expect(migratedJourney.updatedAt).toBe(migratedJourney.createdAt);
    expect(Array.from(db.transaction('journeys').store.indexNames)).toEqual(expect.arrayContaining(['countryCode', 'status']));
    expect(Array.from(db.transaction('moments').store.indexNames)).toEqual(
      expect.arrayContaining(['journeyId', 'journeyIdSortOrder']),
    );
    db.close();
  });

  it('upgrades a version 2 database by adding the private outbox store without changing content', async () => {
    const name = databaseName('outbox-migration');
    const existingJourney = {
      ...journeyInput(),
      id: 'existing-v2-journey',
      status: 'draft' as const,
      source: 'private' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const version2Db = trackDatabase(await openDB(name, 2, {
      upgrade(db) {
        const journeys = db.createObjectStore('journeys', { keyPath: 'id' });
        journeys.createIndex('countryCode', 'countryCode');
        journeys.createIndex('status', 'status');
        const moments = db.createObjectStore('moments', { keyPath: 'id' });
        moments.createIndex('journeyId', 'journeyId');
        moments.createIndex('journeyIdSortOrder', ['journeyId', 'sortOrder']);
        db.createObjectStore('songs', { keyPath: 'id' });
        db.createObjectStore('photos', { keyPath: 'id' });
        journeys.put(existingJourney);
      },
    }));
    version2Db.close();

    const db = trackDatabase(await openSoundPassportDb(name));
    const repository = createIndexedDbJourneyRepository({ db });

    expect(DB_VERSION).toBe(5);
    expect(db.objectStoreNames.contains('journeyAutosaveOutbox')).toBe(true);
    await expect(repository.listPrivateJourneys()).resolves.toEqual([existingJourney]);
    await expect(repository.listByJourney(existingJourney.id)).resolves.toEqual([]);
  });

  it('migrates only parented version 3 outboxes into the owner-scoped store', async () => {
    const name = databaseName('owner-outbox-migration');
    const existingJourney = {
      ...journeyInput(),
      id: 'existing-v3-journey',
      status: 'draft' as const,
      source: 'private' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const { ownerId: _legacyOwnerId, ...legacyRecord } = outboxRecord(
      existingJourney.id,
      'legacy-generation',
      'Legacy private pending title',
    );
    const { ownerId: _orphanOwnerId, ...orphanRecord } = outboxRecord(
      'missing-v3-journey',
      'orphan-generation',
      'Orphan pending title',
    );
    const version3Db = trackDatabase(await openDB(name, 3, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        const journeys = db.createObjectStore('journeys', { keyPath: 'id' });
        journeys.createIndex('countryCode', 'countryCode');
        journeys.createIndex('status', 'status');
        const moments = db.createObjectStore('moments', { keyPath: 'id' });
        moments.createIndex('journeyId', 'journeyId');
        moments.createIndex('journeyIdSortOrder', ['journeyId', 'sortOrder']);
        db.createObjectStore('songs', { keyPath: 'id' });
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('journeyAutosaveOutbox', { keyPath: 'journeyId' });
        journeys.put(existingJourney);
        tx.objectStore('journeyAutosaveOutbox').put(legacyRecord);
        tx.objectStore('journeyAutosaveOutbox').put(orphanRecord);
      },
    }));
    version3Db.close();

    const db = trackDatabase(await openSoundPassportDb(name));
    const outboxStore = db.transaction('journeyAutosaveOutbox').store;
    const repository = createIndexedDbJourneyRepository({ db });
    const migrated = { ...legacyRecord, ownerId: 'legacy-v3' };

    expect(db.version).toBe(5);
    expect(outboxStore.keyPath).toEqual(['journeyId', 'ownerId']);
    expect(Array.from(outboxStore.indexNames)).toContain('journeyId');
    await expect(repository.get(existingJourney.id, 'legacy-v3')).resolves.toEqual(migrated);
    await expect(repository.listByJourney(existingJourney.id)).resolves.toEqual([migrated]);
    await expect(repository.get(orphanRecord.journeyId, 'legacy-v3')).resolves.toBeUndefined();
  });

  it('removes owner-scoped orphans while upgrading an existing version 4 database to v5', async () => {
    const name = databaseName('v5-orphan-cleanup');
    const existingJourney = {
      ...journeyInput(),
      id: 'existing-v4-journey',
      status: 'draft' as const,
      source: 'private' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const valid = ownerOutboxRecord(existingJourney.id, ownerA, 'valid-generation', 'Valid pending title');
    const orphan = ownerOutboxRecord('missing-v4-journey', ownerB, 'orphan-generation', 'Orphan title');
    const version4Db = trackDatabase(await openDB(name, 4, {
      upgrade(db) {
        const journeys = db.createObjectStore('journeys', { keyPath: 'id' });
        journeys.createIndex('countryCode', 'countryCode');
        journeys.createIndex('status', 'status');
        const moments = db.createObjectStore('moments', { keyPath: 'id' });
        moments.createIndex('journeyId', 'journeyId');
        moments.createIndex('journeyIdSortOrder', ['journeyId', 'sortOrder']);
        db.createObjectStore('songs', { keyPath: 'id' });
        db.createObjectStore('photos', { keyPath: 'id' });
        const outbox = db.createObjectStore('journeyAutosaveOutbox', {
          keyPath: ['journeyId', 'ownerId'],
        });
        outbox.createIndex('journeyId', 'journeyId');
        journeys.put(existingJourney);
        outbox.put(valid);
        outbox.put(orphan);
      },
    }));
    version4Db.close();

    const db = trackDatabase(await openSoundPassportDb(name));
    const repository = createIndexedDbJourneyRepository({ db });

    expect(db.version).toBe(5);
    await expect(repository.get(existingJourney.id, ownerA)).resolves.toEqual(valid);
    const verify = db.transaction('journeyAutosaveOutbox', 'readonly');
    await expect(verify.store.get([orphan.journeyId, ownerB])).resolves.toBeUndefined();
    await verify.done;
  });
});
