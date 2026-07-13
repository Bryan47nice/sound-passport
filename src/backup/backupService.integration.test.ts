// @ts-expect-error Node built-in declarations are intentionally excluded from the browser tsconfig.
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSoundPassportDb } from '../data/indexedDb';
import { createIndexedDbJourneyRepository } from '../data/indexedDbJourneyRepository';
import type { PrivateDataPort, PrivateDataPrimaryKeys } from '../data/ports';
import type { NewJourney, NormalizedPhotoInput, PrivateJourneySnapshot } from '../domain/model';
import { cleanupDb, uniqueDbName } from '../test/indexedDb';
import { BackupService } from './backupService';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const databaseNames: string[] = [];
const openDatabases: Array<{ close(): void }> = [];

class SnapshotPort implements PrivateDataPort {
  constructor(private readonly snapshot: PrivateJourneySnapshot) {}

  async exportSnapshot() {
    return this.snapshot;
  }

  async importSnapshot(_snapshot: PrivateJourneySnapshot, _expectedKeys: PrivateDataPrimaryKeys) {
    throw new Error('Source-only test port cannot import.');
  }

  async clearPrivateData() {
    throw new Error('Source-only test port cannot clear.');
  }
}

function nodeBlob(bytes: Uint8Array, contentType: string) {
  return new NodeBlob([bytes], { type: contentType }) as unknown as Blob;
}

function journeyInput(title: string): NewJourney {
  return {
    title,
    countryCode: 'ZZ',
    countryName: 'Testland',
    countryCoordinates: [12, 34],
    cityLabels: ['Sample City'],
    startDate: '2026-01-02',
    endDate: '2026-01-03',
    summary: 'Synthetic integration data.',
  };
}

function photoInput(fileName: string): NormalizedPhotoInput {
  const blob = nodeBlob(JPEG_BYTES, 'image/jpeg');
  return {
    blob,
    contentType: blob.type,
    originalFileName: fileName,
    width: 1200,
    height: 800,
    byteSize: blob.size,
  };
}

function importedSnapshot(): PrivateJourneySnapshot {
  const timestamp = '2026-01-02T00:00:00.000Z';
  const blob = nodeBlob(JPEG_BYTES, 'image/jpeg');
  return {
    journeys: [{
      id: 'import-journey',
      ...journeyInput('Imported'),
      coverPhotoAssetId: 'import-photo',
      status: 'complete',
      createdAt: timestamp,
      updatedAt: timestamp,
      source: 'private',
    }],
    moments: [{
      id: 'import-moment',
      journeyId: 'import-journey',
      photoAssetId: 'import-photo',
      photoAlt: 'Synthetic photo',
      songReferenceId: 'import-song',
      localDate: '2026-01-02',
      cityLabel: 'Sample City',
      placeLabel: 'Test Place',
      caption: 'Synthetic caption.',
      reason: 'Synthetic reason.',
      reasonStatus: 'complete',
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    songs: [{
      id: 'import-song',
      provider: 'manual',
      title: 'Synthetic song',
      artist: 'Synthetic artist',
      availability: 'needs_link',
    }],
    photos: [{
      id: 'import-photo',
      blob,
      contentType: blob.type,
      originalFileName: 'synthetic.jpg',
      width: 1200,
      height: 800,
      byteSize: blob.size,
      createdAt: timestamp,
    }],
  };
}

function backupService(port: PrivateDataPort) {
  return new BackupService(port, {
    appVersion: '1.0.0-test',
    now: () => new Date('2026-07-13T08:00:00.000Z'),
    photoInspector: async () => ({ width: 1200, height: 800 }),
  });
}

async function openTarget(testName: string) {
  const name = uniqueDbName(testName);
  databaseNames.push(name);
  const db = await openSoundPassportDb(name);
  openDatabases.push(db);
  return { db, repository: createIndexedDbJourneyRepository({ db }) };
}

async function backupBlob() {
  return backupService(new SnapshotPort(importedSnapshot())).exportBackup();
}

async function blobBytes(blob: Blob) {
  return new Uint8Array(await (blob as unknown as NodeBlob).arrayBuffer());
}

afterEach(async () => {
  openDatabases.splice(0).forEach((db) => db.close());
  await Promise.all(databaseNames.splice(0).map(cleanupDb));
});

describe('BackupService with IndexedDB', () => {
  it('preserves existing records and same-key edits while committing an additive import', async () => {
    const { db, repository } = await openTarget('backup-additive');
    const existingJourney = await repository.createJourney(journeyInput('Existing'));
    await repository.addMoments(existingJourney.id, [photoInput('existing.jpg')]);
    const beforePlanning = await repository.exportSnapshot();
    const existingPhotoBytes = await blobBytes(beforePlanning.photos[0].blob);
    const service = backupService(repository);
    const plan = await service.planImport(await backupBlob());

    const edited = await repository.updateJourney(existingJourney.id, { title: 'Edited after planning' });
    const importSpy = vi.spyOn(repository, 'importSnapshot');
    await service.commitImport(plan);

    expect(importSpy).toHaveBeenCalledOnce();
    const after = await repository.exportSnapshot();
    expect(after.journeys.find(({ id }) => id === existingJourney.id)).toEqual(edited);
    expect(after.moments.find(({ id }) => id === beforePlanning.moments[0].id)).toEqual(beforePlanning.moments[0]);
    expect(after.songs.find(({ id }) => id === beforePlanning.songs[0].id)).toEqual(beforePlanning.songs[0]);
    const existingPhoto = after.photos.find(({ id }) => id === beforePlanning.photos[0].id)!;
    expect(existingPhoto).toEqual(beforePlanning.photos[0]);
    expect(await blobBytes(existingPhoto.blob)).toEqual(existingPhotoBytes);
    expect(after.journeys).toHaveLength(2);
    expect(after.moments).toHaveLength(2);
    expect(after.songs).toHaveLength(2);
    expect(after.photos).toHaveLength(2);
    db.close();
  });

  it('rejects an imported-ID collision created after planning and leaves all stores unchanged', async () => {
    const { db, repository } = await openTarget('backup-stale-collision');
    const service = backupService(repository);
    const plan = await service.planImport(await backupBlob());
    const collisionTx = db.transaction('journeys', 'readwrite');
    await collisionTx.store.add(plan.snapshot.journeys[0]);
    await collisionTx.done;
    const beforeAttempt = await repository.exportSnapshot();

    await expect(service.commitImport(plan)).rejects.toMatchObject({ code: 'stale_plan' });

    expect(await repository.exportSnapshot()).toEqual(beforeAttempt);
    db.close();
  });

  it('rejects a target deletion after planning and leaves the post-delete state unchanged', async () => {
    const { db, repository } = await openTarget('backup-stale-deletion');
    const existingJourney = await repository.createJourney(journeyInput('Existing'));
    await repository.addMoments(existingJourney.id, [photoInput('existing.jpg')]);
    const service = backupService(repository);
    const plan = await service.planImport(await backupBlob());

    await repository.deleteJourney(existingJourney.id);
    const beforeAttempt = await repository.exportSnapshot();
    await expect(service.commitImport(plan)).rejects.toMatchObject({ code: 'stale_plan' });

    expect(await repository.exportSnapshot()).toEqual(beforeAttempt);
    db.close();
  });
});
