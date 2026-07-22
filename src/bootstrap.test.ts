import { describe, expect, it, vi } from 'vitest';
import type { IDBPDatabase } from 'idb';
import { fixtureJourneyRepository } from './data/fixtureJourneyRepository';
import type { SoundPassportDb } from './data/indexedDb';
import { openPrivateRepositorySession } from './bootstrap';

describe('openPrivateRepositorySession', () => {
  it('assembles private services and closes its database connection', async () => {
    const database = { close: vi.fn() } as unknown as IDBPDatabase<SoundPassportDb>;
    const openDatabase = vi.fn(async (_uid: string) => database);

    const session = await openPrivateRepositorySession({
      uid: 'user-a',
      fixtures: fixtureJourneyRepository,
      openDatabase,
    });

    expect(openDatabase).toHaveBeenCalledWith('user-a');
    expect(session.services.query).toBe(session.services.editor);
    expect(session.services.fixtures).toBe(fixtureJourneyRepository);
    session.close();
    expect(database.close).toHaveBeenCalledTimes(1);
  });
});
