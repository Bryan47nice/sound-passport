import { createContext, useContext, type PropsWithChildren } from 'react';
import type {
  JourneyEditorRepository,
  JourneyRepository,
  PhotoAssetRepository,
  PrivateDataPort,
} from './ports';

export interface RepositoryServices {
  query: JourneyRepository;
  editor?: JourneyEditorRepository;
  photos?: PhotoAssetRepository;
  privateData?: PrivateDataPort;
}

const Context = createContext<RepositoryServices | null>(null);

type RepositoryProviderProps = PropsWithChildren<{
  services?: RepositoryServices;
  repository?: JourneyRepository;
}>;

export function RepositoryProvider({ services, repository, children }: RepositoryProviderProps) {
  const value = services ?? (repository ? { query: repository } : undefined);
  return <Context.Provider value={value ?? null}>{children}</Context.Provider>;
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
