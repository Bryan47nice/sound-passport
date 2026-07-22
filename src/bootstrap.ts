import type { IDBPDatabase } from 'idb';
import { BackupService } from './backup/backupService';
import type { SoundPassportDb } from './data/indexedDb';
import { createIndexedDbJourneyRepository } from './data/indexedDbJourneyRepository';
import type { JourneyRepository } from './data/ports';
import type { RepositoryServices } from './data/RepositoryContext';

export interface RepositorySession {
  services: RepositoryServices;
  close(): void;
}

interface SessionOptions {
  uid: string;
  fixtures: JourneyRepository;
  openDatabase(uid: string): Promise<IDBPDatabase<SoundPassportDb>>;
}

export async function openPrivateRepositorySession({
  uid,
  fixtures,
  openDatabase,
}: SessionOptions): Promise<RepositorySession> {
  const database = await openDatabase(uid);
  const privateRepository = createIndexedDbJourneyRepository({ db: database });
  return {
    services: {
      query: privateRepository,
      fixtures,
      editor: privateRepository,
      outbox: privateRepository,
      momentOutbox: privateRepository,
      photos: privateRepository,
      privateData: privateRepository,
      backup: new BackupService(privateRepository),
    },
    close: () => database.close(),
  };
}
