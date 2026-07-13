import { openDB, type IDBPDatabase } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDb, uniqueDbName } from '../test/indexedDb';
import { openSoundPassportDb } from './indexedDb';

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
    const futureOpening = openDB(name, 6);

    const result = await settleWithin(futureOpening);
    if (result.kind === 'timeout') current.close();
    const future = result.kind === 'resolved' ? result.value : await futureOpening;
    track(future);

    expect(result.kind).toBe('resolved');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
