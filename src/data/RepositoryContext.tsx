import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type {
  JourneyAutosaveOutboxPort,
  JourneyEditorRepository,
  JourneyRepository,
  PhotoAssetRepository,
  PrivateDataPort,
} from './ports';

export interface RepositoryServices {
  query: JourneyRepository;
  editor?: JourneyEditorRepository;
  outbox?: JourneyAutosaveOutboxPort;
  photos?: PhotoAssetRepository;
  privateData?: PrivateDataPort;
  privateStorageError?: string;
}

interface RepositoryContextValue extends RepositoryServices {
  invalidateQueries: () => void;
  revision: number;
}

const Context = createContext<RepositoryContextValue | null>(null);

type RepositoryProviderProps = PropsWithChildren<{ services: RepositoryServices }>;

export function RepositoryProvider({ services, children }: RepositoryProviderProps) {
  const [revision, setRevision] = useState(0);
  const invalidateQueries = useCallback(() => setRevision((current) => current + 1), []);
  const value = useMemo<RepositoryContextValue>(() => ({
    ...services,
    invalidateQueries,
    revision,
  }), [invalidateQueries, revision, services]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRepositoryRevision(): number {
  const context = useContext(Context);
  if (!context) throw new Error('Repository services are not available');
  return context.revision;
}

export function useInvalidateRepositoryQueries(): () => void {
  const context = useContext(Context);
  if (!context) throw new Error('Repository services are not available');
  return context.invalidateQueries;
}

export function useJourneyRepository(): JourneyRepository {
  const repository = useContext(Context)?.query;
  if (!repository) throw new Error('JourneyRepository is not available');
  return repository;
}

export function useJourneyEditorRepository(): JourneyEditorRepository {
  const editor = useContext(Context)?.editor;
  if (!editor) throw new Error('JourneyEditorRepository is not available');
  return editor;
}

export function useOptionalJourneyEditorRepository(): JourneyEditorRepository | undefined {
  return useContext(Context)?.editor;
}

export function useJourneyAutosaveOutbox(): JourneyAutosaveOutboxPort {
  const outbox = useContext(Context)?.outbox;
  if (!outbox) throw new Error('JourneyAutosaveOutboxPort is not available');
  return outbox;
}

export function useOptionalJourneyAutosaveOutbox(): JourneyAutosaveOutboxPort | undefined {
  return useContext(Context)?.outbox;
}

export function usePrivateStorageError(): string | undefined {
  return useContext(Context)?.privateStorageError;
}

export function usePhotoAssetRepository(): PhotoAssetRepository {
  const photos = useContext(Context)?.photos;
  if (!photos) throw new Error('PhotoAssetRepository is not available');
  return photos;
}

export function usePrivateDataPort(): PrivateDataPort {
  const privateData = useContext(Context)?.privateData;
  if (!privateData) throw new Error('PrivateDataPort is not available');
  return privateData;
}
