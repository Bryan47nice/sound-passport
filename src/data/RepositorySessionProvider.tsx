import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthContext';
import { openPrivateRepositorySession, type RepositorySession } from '../bootstrap';
import { emptyJourneyRepository } from './emptyJourneyRepository';
import { fixtureJourneyRepository } from './fixtureJourneyRepository';
import { openUserSoundPassportDb } from './indexedDb';
import type { JourneyRepository } from './ports';
import { RepositoryProvider, type RepositoryServices } from './RepositoryContext';

type SessionOpener = (uid: string, fixtures: JourneyRepository) => Promise<RepositorySession>;
type SessionView =
  | { kind: 'loading' }
  | { kind: 'ready'; services: RepositoryServices };

interface RepositorySessionProviderProps extends PropsWithChildren {
  fixtures?: JourneyRepository;
  openSession?: SessionOpener;
}

export function RepositorySessionProvider({
  children,
  fixtures = fixtureJourneyRepository,
  openSession,
}: RepositorySessionProviderProps) {
  const { state } = useAuth();
  const uid = state.kind === 'signed-in' ? state.user.uid : undefined;
  const activeSession = useRef<RepositorySession | undefined>(undefined);
  const defaultOpenSession = useCallback<SessionOpener>(
    (nextUid, nextFixtures) => openPrivateRepositorySession({
      uid: nextUid,
      fixtures: nextFixtures,
      openDatabase: openUserSoundPassportDb,
    }),
    [],
  );
  const sessionOpener = openSession ?? defaultOpenSession;
  const signedOutServices = useMemo<RepositoryServices>(() => ({
    query: fixtures,
    fixtures,
  }), [fixtures]);
  const [view, setView] = useState<SessionView>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    activeSession.current?.close();
    activeSession.current = undefined;

    if (state.kind === 'loading') {
      setView({ kind: 'loading' });
      return () => { cancelled = true; };
    }
    if (state.kind === 'signed-out') {
      setView({ kind: 'ready', services: signedOutServices });
      return () => { cancelled = true; };
    }

    setView({ kind: 'loading' });
    const nextUid = state.user.uid;
    void sessionOpener(nextUid, fixtures).then(
      (session) => {
        if (cancelled) {
          session.close();
          return;
        }
        activeSession.current = session;
        setView({ kind: 'ready', services: session.services });
      },
      () => {
        if (!cancelled) {
          setView({
            kind: 'ready',
            services: {
              query: emptyJourneyRepository,
              fixtures,
              privateStorageError: '本機儲存空間暫時無法使用',
            },
          });
        }
      },
    );

    return () => {
      cancelled = true;
      activeSession.current?.close();
      activeSession.current = undefined;
    };
  }, [fixtures, sessionOpener, signedOutServices, state.kind, uid]);

  if (view.kind === 'loading') {
    return <section className="page" aria-label="確認私人資料" />;
  }
  return <RepositoryProvider services={view.services}>{children}</RepositoryProvider>;
}
