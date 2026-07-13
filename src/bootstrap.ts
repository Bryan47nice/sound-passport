import { createCombinedJourneyRepository } from './data/combinedJourneyRepository';
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
}

export function bootstrapRepositoryServices<Database>({
  fixtureRepository,
  renderServices,
  openDatabase,
  createPrivateRepository,
}: BootstrapRepositoryServicesOptions<Database>): Promise<void> {
  renderServices({ query: fixtureRepository });

  return openDatabase().then(
    (database) => {
      const privateRepository = createPrivateRepository(database);
      renderServices({
        query: createCombinedJourneyRepository(fixtureRepository, privateRepository),
        editor: privateRepository,
        outbox: privateRepository,
        photos: privateRepository,
        privateData: privateRepository,
      });
    },
    () => undefined,
  );
}
