import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { Outlet } from 'react-router';
import { useFixtureJourneyRepository, useJourneyRepository } from '../data/RepositoryContext';
import type { JourneyRepository } from '../data/ports';

export type JourneyExperienceKind = 'private' | 'demo';

export interface JourneyExperienceValue {
  kind: JourneyExperienceKind;
  repository: JourneyRepository;
  routePrefix: '' | '/demo';
}

const Context = createContext<JourneyExperienceValue | null>(null);

export function experiencePath(prefix: '' | '/demo', path: string) {
  return `${prefix}${path}` || '/';
}

export function JourneyExperienceProvider({
  children,
  kind,
  routePrefix,
}: PropsWithChildren<{
  kind: JourneyExperienceKind;
  routePrefix: '' | '/demo';
}>) {
  const privateRepository = useJourneyRepository();
  const fixtureRepository = useFixtureJourneyRepository();
  const value = useMemo(() => ({
    kind,
    routePrefix,
    repository: kind === 'demo' ? fixtureRepository : privateRepository,
  }), [fixtureRepository, kind, privateRepository, routePrefix]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function JourneyExperienceBoundary({
  kind,
  routePrefix,
}: {
  kind: JourneyExperienceKind;
  routePrefix: '' | '/demo';
}) {
  return (
    <JourneyExperienceProvider kind={kind} routePrefix={routePrefix}>
      <Outlet />
    </JourneyExperienceProvider>
  );
}

export function useJourneyExperience() {
  const value = useContext(Context);
  if (!value) throw new Error('JourneyExperienceContext is not available');
  return value;
}
