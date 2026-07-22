import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { Journey, JourneyStatus, Moment, PhotoAsset, SongReference } from '../domain/model';
import type { JourneyAutosaveOutboxRecord, MomentAutosaveOutboxRecord } from './ports';

export const DB_NAME = 'sound-passport';
export const DB_VERSION = 6;
export const LEGACY_OUTBOX_OWNER_ID = 'legacy-v3';
export const DATABASE_BLOCKED_MESSAGE = '請關閉其他分頁後重新嘗試';

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
  momentAutosaveOutbox: {
    key: [string, string];
    value: MomentAutosaveOutboxRecord;
    indexes: {
      journeyId: string;
      momentId: string;
    };
  };
}

type SoundPassportStore =
  | 'journeys'
  | 'moments'
  | 'songs'
  | 'photos'
  | 'journeyAutosaveOutbox'
  | 'momentAutosaveOutbox';

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
  return (async () => {
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
  })();
}

function migrateToVersion3(db: IDBPDatabase<SoundPassportDb>) {
  db.createObjectStore('journeyAutosaveOutbox', { keyPath: 'journeyId' });
}

async function migrateToVersion4(
  db: IDBPDatabase<SoundPassportDb>,
  tx: IDBPTransaction<SoundPassportDb, SoundPassportStore[], 'versionchange'>,
) {
  const legacyStore = tx.objectStore('journeyAutosaveOutbox');
  const legacyRecords = await legacyStore.getAll();
  db.deleteObjectStore('journeyAutosaveOutbox');
  const ownerStore = db.createObjectStore('journeyAutosaveOutbox', {
    keyPath: ['journeyId', 'ownerId'],
  });
  ownerStore.createIndex('journeyId', 'journeyId');
  const journeys = tx.objectStore('journeys');
  for (const record of legacyRecords) {
    if (await journeys.get(record.journeyId)) {
      await ownerStore.put({ ...record, ownerId: LEGACY_OUTBOX_OWNER_ID });
    }
  }
}

async function migrateToVersion5(
  tx: IDBPTransaction<SoundPassportDb, SoundPassportStore[], 'versionchange'>,
) {
  const journeys = tx.objectStore('journeys');
  const outbox = tx.objectStore('journeyAutosaveOutbox');
  let cursor = await outbox.openCursor();
  while (cursor) {
    if (!(await journeys.get(cursor.value.journeyId))) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
}

function migrateToVersion6(db: IDBPDatabase<SoundPassportDb>) {
  const store = db.createObjectStore('momentAutosaveOutbox', {
    keyPath: ['momentId', 'ownerId'],
  });
  store.createIndex('journeyId', 'journeyId');
  store.createIndex('momentId', 'momentId');
}

export function openSoundPassportDb(name = DB_NAME) {
  let blocked = false;
  let closeWhenOpened = false;
  let openedConnection: IDBPDatabase<SoundPassportDb> | undefined;
  let rejectBlocked!: (error: Error) => void;
  const blockedResult = new Promise<never>((_resolve, reject) => { rejectBlocked = reject; });
  const opening = openDB<SoundPassportDb>(name, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) createVersion1Stores(db);
      const version2Migration = oldVersion < 2 ? migrateToVersion2(tx) : undefined;
      if (oldVersion < 3) migrateToVersion3(db);
      const migrate = async () => {
        if (version2Migration) await version2Migration;
        if (oldVersion < 4) await migrateToVersion4(db, tx);
        if (oldVersion < 5) await migrateToVersion5(tx);
        if (oldVersion < 6) migrateToVersion6(db);
      };
      void migrate().catch(() => {
        try {
          tx.abort();
        } catch {
          // The upgrade transaction may already have aborted because of the failed request.
        }
      });
    },
    blocked() {
      if (blocked) return;
      blocked = true;
      rejectBlocked(new Error(DATABASE_BLOCKED_MESSAGE));
    },
    blocking() {
      closeWhenOpened = true;
      openedConnection?.close();
    },
  });

  const trackedOpening = opening.then((db) => {
    openedConnection = db;
    if (blocked || closeWhenOpened) db.close();
    return db;
  });
  return Promise.race([trackedOpening, blockedResult]);
}

export function userDatabaseName(uid: string) {
  if (!uid) throw new Error('Firebase uid is required');
  return `${DB_NAME}-user-${encodeURIComponent(uid)}`;
}

export function openUserSoundPassportDb(uid: string) {
  return openSoundPassportDb(userDatabaseName(uid));
}

export async function deleteSoundPassportDb(name = DB_NAME) {
  await deleteDB(name);
}
