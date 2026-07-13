// @ts-expect-error Node built-in declarations are intentionally excluded from the browser tsconfig.
import { Blob as NodeBlob } from 'node:buffer';
import { openDB, type IDBPDatabase } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewJourney, NormalizedPhotoInput, PrivateJourneySnapshot } from '../domain/model';
import { cleanupDb, uniqueDbName } from '../test/indexedDb';
import { DB_VERSION, openSoundPassportDb, type SoundPassportDb } from './indexedDb';
import { createIndexedDbJourneyRepository } from './indexedDbJourneyRepository';

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
) {
  const created = await repository.createJourney(journeyInput());
  const [moment] = await repository.addMoments(created.id, [photoInput('valid.jpg')]);
  await repository.updateMoment(moment.id, {
    song: { title: 'Valid title', artist: 'Valid artist', sourceUrl: '' },
  });
  const journey = await repository.setJourneyStatus(created.id, 'complete');
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

  it('advances the story version and revalidates a complete journey while reordering', async () => {
    const { db, repository } = await openRepository('reorder-story-version');
    const created = await repository.createJourney(journeyInput());
    const moments = await repository.addMoments(created.id, [photoInput('one.jpg'), photoInput('two.jpg')]);
    const plannedJourney = await repository.setJourneyStatus(created.id, 'complete');

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
    const complete = await repository.createJourney(journeyInput({ title: 'Complete' }));
    await repository.setJourneyStatus(review.id, 'review');
    await repository.setJourneyStatus(complete.id, 'complete');

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
});
