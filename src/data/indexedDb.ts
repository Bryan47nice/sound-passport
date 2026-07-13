import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { Journey, JourneyStatus, Moment, PhotoAsset, SongReference } from '../domain/model';
import type { JourneyAutosaveOutboxRecord } from './ports';

export const DB_NAME = 'sound-passport';
export const DB_VERSION = 4;
export const LEGACY_OUTBOX_OWNER_ID = 'legacy-v3';

export interface SoundPassportDb extends DBSchema {
  journeys: {
    key: string;
    value: Journey;
    indexes: {
      countryCode: string;
      status: JourneyStatus;
    };
  };
  moments: {
    key: string;
    value: Moment;
    indexes: {
      journeyId: string;
      journeyIdSortOrder: [string, number];
    };
  };
  songs: {
    key: string;
    value: SongReference;
  };
  photos: {
    key: string;
    value: PhotoAsset;
  };
  journeyAutosaveOutbox: {
    key: [string, string];
    value: JourneyAutosaveOutboxRecord;
    indexes: {
      journeyId: string;
    };
  };
}

type SoundPassportStore = 'journeys' | 'moments' | 'songs' | 'photos' | 'journeyAutosaveOutbox';

function createVersion1Stores(db: IDBPDatabase<SoundPassportDb>) {
  db.createObjectStore('journeys', { keyPath: 'id' });
  db.createObjectStore('moments', { keyPath: 'id' });
  db.createObjectStore('songs', { keyPath: 'id' });
  db.createObjectStore('photos', { keyPath: 'id' });
}

function migrateToVersion2(
  tx: IDBPTransaction<SoundPassportDb, SoundPassportStore[], 'versionchange'>,
) {
  const journeys = tx.objectStore('journeys');
  const moments = tx.objectStore('moments');
  journeys.createIndex('countryCode', 'countryCode');
  journeys.createIndex('status', 'status');
  moments.createIndex('journeyId', 'journeyId');
  moments.createIndex('journeyIdSortOrder', ['journeyId', 'sortOrder']);

  const migratedAt = new Date().toISOString();
  const backfill = async () => {
    let cursor = await journeys.openCursor();
    while (cursor) {
      const legacy = cursor.value as Partial<Journey> & Pick<Journey, 'id'>;
      await cursor.update({
        ...legacy,
        source: legacy.source ?? 'private',
        summary: legacy.summary ?? '',
        createdAt: legacy.createdAt ?? migratedAt,
        updatedAt: legacy.updatedAt ?? legacy.createdAt ?? migratedAt,
      } as Journey);
      cursor = await cursor.continue();
    }
  };

  void backfill().catch(() => {
    try {
      tx.abort();
    } catch {
      // The upgrade transaction may already have aborted because of the failed request.
    }
  });
}

function migrateToVersion3(db: IDBPDatabase<SoundPassportDb>) {
  db.createObjectStore('journeyAutosaveOutbox', { keyPath: 'journeyId' });
}

function migrateToVersion4(
  db: IDBPDatabase<SoundPassportDb>,
  tx: IDBPTransaction<SoundPassportDb, SoundPassportStore[], 'versionchange'>,
) {
  const legacyStore = tx.objectStore('journeyAutosaveOutbox');
  const migrate = async () => {
    const legacyRecords = await legacyStore.getAll();
    db.deleteObjectStore('journeyAutosaveOutbox');
    const ownerStore = db.createObjectStore('journeyAutosaveOutbox', {
      keyPath: ['journeyId', 'ownerId'],
    });
    ownerStore.createIndex('journeyId', 'journeyId');
    for (const record of legacyRecords) {
      await ownerStore.put({ ...record, ownerId: LEGACY_OUTBOX_OWNER_ID });
    }
  };

  void migrate().catch(() => {
    try {
      tx.abort();
    } catch {
      // The upgrade transaction may already have aborted because of the failed request.
    }
  });
}

export function openSoundPassportDb(name = DB_NAME) {
  return openDB<SoundPassportDb>(name, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) createVersion1Stores(db);
      if (oldVersion < 2) migrateToVersion2(tx);
      if (oldVersion < 3) migrateToVersion3(db);
      if (oldVersion < 4) migrateToVersion4(db, tx);
    },
  });
}

export async function deleteSoundPassportDb(name = DB_NAME) {
  await deleteDB(name);
}
