import { createCombinedJourneyRepository } from './data/combinedJourneyRepository';
import type { BackupService } from './backup/backupService';
import { DATABASE_BLOCKED_MESSAGE } from './data/indexedDb';
import type {
  JourneyAutosaveOutboxPort,
  JourneyEditorRepository,
  JourneyRepository,
  PhotoAssetRepository,
  PrivateDataPort,
} from './data/ports';
import type { RepositoryServices } from './data/RepositoryContext';

type PrivateRepository = JourneyRepository
  & JourneyEditorRepository
  & JourneyAutosaveOutboxPort
  & PhotoAssetRepository
  & PrivateDataPort;

interface BootstrapRepositoryServicesOptions<Database> {
  fixtureRepository: JourneyRepository;
  renderServices: (services: RepositoryServices) => void;
  openDatabase: () => Promise<Database>;
  createPrivateRepository: (database: Database) => PrivateRepository;
  createBackupService: (privateData: PrivateDataPort) => BackupService;
}

export function bootstrapRepositoryServices<Database>({
  fixtureRepository,
  renderServices,
  openDatabase,
  createPrivateRepository,
  createBackupService,
}: BootstrapRepositoryServicesOptions<Database>): Promise<void> {
  renderServices({ query: fixtureRepository });

  return openDatabase().then(
    (database) => {
      const privateRepository = createPrivateRepository(database);
      const backup = createBackupService(privateRepository);
      renderServices({
        query: createCombinedJourneyRepository(fixtureRepository, privateRepository),
        editor: privateRepository,
        outbox: privateRepository,
        photos: privateRepository,
        privateData: privateRepository,
        backup,
      });
    },
    (error: unknown) => {
      renderServices({
        query: fixtureRepository,
        privateStorageError: error instanceof Error && error.message === DATABASE_BLOCKED_MESSAGE
          ? DATABASE_BLOCKED_MESSAGE
          : '本機儲存空間暫時無法使用',
      });
    },
  );
}
