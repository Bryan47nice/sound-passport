import { openDB, type IDBPDatabase } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDb, uniqueDbName } from '../test/indexedDb';
import { DB_NAME, DB_VERSION, openSoundPassportDb, openUserSoundPassportDb, userDatabaseName } from './indexedDb';
import { createIndexedDbJourneyRepository } from './indexedDbJourneyRepository';

const databaseNames: string[] = [];
const openDatabases: Array<{ close(): void }> = [];

function databaseName(label: string) {
  const name = uniqueDbName(label);
  databaseNames.push(name);
  return name;
}

function track<T extends { close(): void }>(db: T) {
  openDatabases.push(db);
  return db;
}

function createVersion4Schema(db: IDBPDatabase<unknown>) {
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
}

function settleWithin<T>(promise: Promise<T>, milliseconds = 25) {
  return Promise.race([
    promise.then(
      (value) => ({ kind: 'resolved' as const, value }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    ),
    new Promise<{ kind: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'timeout' }), milliseconds);
    }),
  ]);
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(async () => {
  openDatabases.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
  await Promise.all(databaseNames.splice(0).map(cleanupDb));
});

describe('openSoundPassportDb', () => {
  it('rejects a blocked upgrade promptly and closes the connection that eventually opens', async () => {
    const name = databaseName('blocked-upgrade');
    const closeSpy = vi.spyOn(IDBDatabase.prototype, 'close');
    const blocker = track(await openDB(name, 4, { upgrade: createVersion4Schema }));
    const opening = openSoundPassportDb(name);

    const result = await settleWithin(opening);
    blocker.close();
    if (result.kind === 'timeout') {
      const leaked = track(await opening);
      leaked.close();
    } else {
      await waitFor(() => closeSpy.mock.calls.length >= 2);
    }

    expect(result).toMatchObject({
      kind: 'rejected',
      error: { message: '請關閉其他分頁後重新嘗試' },
    });
    expect(closeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('closes its current connection when a future database version is blocking', async () => {
    const name = databaseName('blocking-upgrade');
    const current = track(await openSoundPassportDb(name));
    const closeSpy = vi.spyOn(current, 'close');
    const futureOpening = openDB(name, DB_VERSION + 1);

    const result = await settleWithin(futureOpening);
    if (result.kind === 'timeout') current.close();
    const future = result.kind === 'resolved' ? result.value : await futureOpening;
    track(future);

    expect(result.kind).toBe('resolved');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('uid-isolated databases', () => {
  it('derives deterministic database names and requires a Firebase uid', () => {
    expect(userDatabaseName('user-a')).toBe('sound-passport-user-user-a');
    expect(userDatabaseName('user-b')).toBe('sound-passport-user-user-b');
    expect(() => userDatabaseName('')).toThrowError('Firebase uid is required');
  });

  it('keeps each uid database and the legacy database isolated', async () => {
    const uidA = `user-a-${crypto.randomUUID()}`;
    const uidB = `user-b-${crypto.randomUUID()}`;
    const legacy = track(await openSoundPassportDb(DB_NAME));
    const userA = track(await openUserSoundPassportDb(uidA));
    const userB = track(await openUserSoundPassportDb(uidB));
    databaseNames.push(DB_NAME, userDatabaseName(uidA), userDatabaseName(uidB));

    await legacy.put('journeys', {
      id: 'legacy-journey',
      title: 'Legacy',
      countryCode: 'ZZ',
      countryName: 'Legacy',
      countryCoordinates: [0, 0],
      cityLabels: [],
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      summary: '',
      status: 'draft',
      source: 'private',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const repositoryA = createIndexedDbJourneyRepository({ db: userA });
    await repositoryA.createJourney({
      title: 'A private draft',
      countryCode: 'ZZ',
      countryName: 'Testland',
      countryCoordinates: [12, 34],
      cityLabels: [],
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      summary: '',
    });

    expect(await createIndexedDbJourneyRepository({ db: userB }).listPrivateJourneys()).toEqual([]);
    expect(await repositoryA.listPrivateJourneys()).toHaveLength(1);
    userA.close();
    const reopenedA = track(await openUserSoundPassportDb(uidA));
    expect(await createIndexedDbJourneyRepository({ db: reopenedA }).listPrivateJourneys()).toHaveLength(1);
    expect(await createIndexedDbJourneyRepository({ db: reopenedA }).listPrivateJourneys()).not.toContainEqual(
      expect.objectContaining({ id: 'legacy-journey' }),
    );
    expect(await createIndexedDbJourneyRepository({ db: userB }).listPrivateJourneys()).not.toContainEqual(
      expect.objectContaining({ id: 'legacy-journey' }),
    );
  });
});
