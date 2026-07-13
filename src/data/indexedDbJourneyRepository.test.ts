import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import type { NewJourney, NormalizedPhotoInput, PrivateJourneySnapshot } from '../domain/model';
import { cleanupDb, uniqueDbName } from '../test/indexedDb';
import { DB_VERSION, openSoundPassportDb } from './indexedDb';
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
  const blob = new Blob([contents], { type: 'image/jpeg' });
  return {
    blob,
    contentType: blob.type,
    originalFileName: fileName,
    width: 1200,
    height: 800,
    byteSize: blob.size,
  };
}

async function openRepository(testName: string) {
  const name = databaseName(testName);
  const db = trackDatabase(await openSoundPassportDb(name));
  return { db, name, repository: createIndexedDbJourneyRepository({ db }) };
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
    const { db, repository } = await openRepository('update');
    const created = await repository.createJourney(journeyInput());
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repository.updateJourney(created.id, { title: 'Renamed Journey' });

    const { updatedAt: _createdUpdatedAt, ...unchangedFields } = created;
    expect(updated).toMatchObject({ ...unchangedFields, title: 'Renamed Journey' });
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    db.close();
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

  it('atomically deletes a journey and all records that belong to it', async () => {
    const { db, repository } = await openRepository('delete-journey');
    const deletedJourney = await repository.createJourney(journeyInput({ title: 'Delete' }));
    const retainedJourney = await repository.createJourney(journeyInput({ title: 'Retain' }));
    await repository.addMoments(deletedJourney.id, [photoInput('delete.jpg')]);
    const [retainedMoment] = await repository.addMoments(retainedJourney.id, [photoInput('retain.jpg')]);

    await repository.deleteJourney(deletedJourney.id);
    const snapshot = await repository.exportSnapshot();

    expect(snapshot.journeys).toEqual([retainedJourney]);
    expect(snapshot.moments).toEqual([retainedMoment]);
    expect(snapshot.songs.map((song) => song.id)).toEqual([retainedMoment.songReferenceId]);
    expect(snapshot.photos.map((photo) => photo.id)).toEqual([retainedMoment.photoAssetId]);
    db.close();
  });

  it('exposes complete journeys to queries and every private status to editor reads', async () => {
    const { db, repository } = await openRepository('visibility');
    const draft = await repository.createJourney(journeyInput({ title: 'Draft' }));
    const complete = await repository.createJourney(journeyInput({ title: 'Complete' }));
    await repository.setJourneyStatus(complete.id, 'complete');

    expect(new Set((await repository.listPrivateJourneys()).map((journey) => journey.id))).toEqual(
      new Set([draft.id, complete.id]),
    );
    expect((await repository.listJourneysByCountry('ZZ')).map((journey) => journey.id)).toEqual([complete.id]);
    expect(await repository.listCountrySummaries()).toMatchObject([{ journeyCount: 1, latestJourneyTitle: 'Complete' }]);
    expect(await repository.getJourneyStory(draft.id)).toBeUndefined();
    expect((await repository.getJourneyStory(complete.id))?.journey.id).toBe(complete.id);
    expect((await repository.getPrivateJourneyStory(draft.id))?.journey.id).toBe(draft.id);
    db.close();
  });

  it('exports every private record and rolls back an import with a broken relationship', async () => {
    const { db, repository } = await openRepository('snapshot');
    const journey = await repository.createJourney(journeyInput());
    await repository.addMoments(journey.id, [photoInput('snapshot.jpg')]);
    const exported = await repository.exportSnapshot();
    const invalid: PrivateJourneySnapshot = {
      ...exported,
      moments: exported.moments.map((moment) => ({ ...moment, journeyId: 'missing-journey' })),
    };

    expect(exported.journeys).toHaveLength(1);
    expect(exported.moments).toHaveLength(1);
    expect(exported.songs).toHaveLength(1);
    expect(exported.photos).toHaveLength(1);
    await expect(repository.importSnapshot(invalid)).rejects.toThrow(/relationship/i);
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
