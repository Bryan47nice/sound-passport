import { createContext, useContext, type PropsWithChildren } from 'react';
import type { JourneyRepository } from './ports';

const Context = createContext<JourneyRepository | null>(null);

export function RepositoryProvider({ repository, children }: PropsWithChildren<{ repository: JourneyRepository }>) {
  return <Context.Provider value={repository}>{children}</Context.Provider>;
}

export function useJourneyRepository(): JourneyRepository {
  const repository = useContext(Context);
  if (!repository) throw new Error('JourneyRepository is not available');
  return repository;
}
