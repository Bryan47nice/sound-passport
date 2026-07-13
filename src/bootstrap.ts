import { createCombinedJourneyRepository } from './data/combinedJourneyRepository';
import type {
  JourneyEditorRepository,
  JourneyRepository,
  PhotoAssetRepository,
  PrivateDataPort,
} from './data/ports';
import type { RepositoryServices } from './data/RepositoryContext';

type PrivateRepository = JourneyRepository
  & JourneyEditorRepository
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
        photos: privateRepository,
        privateData: privateRepository,
      });
    },
    () => undefined,
  );
}
