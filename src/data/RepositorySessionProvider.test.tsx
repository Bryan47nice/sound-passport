import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthPort, AuthUser } from '../auth/ports';
import type { RepositorySession } from '../bootstrap';
import { fixtureJourneyRepository } from './fixtureJourneyRepository';
import type { JourneyRepository } from './ports';
import { useJourneyRepository, useOptionalJourneyEditorRepository, usePrivateStorageError } from './RepositoryContext';
import { RepositorySessionProvider } from './RepositorySessionProvider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAuthPort() {
  let listener: ((user: AuthUser | null) => void) | undefined;
  const port: AuthPort = {
    observe(next) { listener = next; return () => { listener = undefined; }; },
    signInWithGoogle: async () => undefined,
    signOut: async () => undefined,
  };
  return { port, emit: (user: AuthUser | null) => act(() => listener?.(user)) };
}

function signedIn(uid: string): AuthUser {
  return { uid, displayName: uid, email: null, photoURL: null };
}

function session(label: string): RepositorySession {
  const query = {
    listCountrySummaries: vi.fn(async () => []),
    listJourneysByCountry: vi.fn(async () => []),
    getJourneyStory: vi.fn(async () => undefined),
  };
  return { services: { query, fixtures: fixtureJourneyRepository, editor: query as never }, close: vi.fn() };
}

function Probe() {
  const query = useJourneyRepository();
  const editor = useOptionalJourneyEditorRepository();
  const error = usePrivateStorageError();
  return <output data-testid="services">{`${query === fixtureJourneyRepository ? 'fixtures' : 'private'}:${editor ? 'editor' : 'no-editor'}:${error ?? ''}`}</output>;
}

function renderProvider(
  port: AuthPort,
  openSession: (uid: string, fixtures: JourneyRepository) => Promise<RepositorySession>,
) {
  return render(
    <AuthProvider port={port}>
      <RepositorySessionProvider openSession={openSession}><Probe /></RepositorySessionProvider>
    </AuthProvider>,
  );
}

afterEach(cleanup);

describe('RepositorySessionProvider', () => {
  it('renders loading without opening a database', () => {
    const { port } = createAuthPort();
    const openSession = vi.fn();
    renderProvider(port, openSession);
    expect(screen.getByLabelText('蝣箄?蝘犖鞈?')).toBeInTheDocument();
    expect(openSession).not.toHaveBeenCalled();
  });

  it('supplies fixture queries without an editor while signed out', async () => {
    const { port, emit } = createAuthPort();
    const openSession = vi.fn();
    renderProvider(port, openSession);
    emit(null);
    expect(await screen.findByTestId('services')).toHaveTextContent('fixtures:no-editor:');
    expect(openSession).not.toHaveBeenCalled();
  });

  it('opens A only and closes it before B services become visible', async () => {
    const { port, emit } = createAuthPort();
    const a = session('a');
    const b = session('b');
    const openSession = vi.fn(async (uid: string) => uid === 'user-a' ? a : b);
    renderProvider(port, openSession);
    emit(signedIn('user-a'));
    await screen.findByTestId('services');
    emit(signedIn('user-b'));
    await waitFor(() => expect(a.close).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('services')).toHaveTextContent('private:editor:');
    expect(openSession).toHaveBeenNthCalledWith(1, 'user-a', fixtureJourneyRepository);
    expect(openSession).toHaveBeenNthCalledWith(2, 'user-b', fixtureJourneyRepository);
  });

  it('closes a stale A session and never publishes it after B replaces it', async () => {
    const { port, emit } = createAuthPort();
    const openA = deferred<RepositorySession>();
    const b = session('b');
    const a = session('a');
    const openSession = vi.fn((uid: string) => uid === 'user-a' ? openA.promise : Promise.resolve(b));
    renderProvider(port, openSession);
    emit(signedIn('user-a'));
    emit(signedIn('user-b'));
    await screen.findByTestId('services');
    await act(async () => openA.resolve(a));
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('services')).toHaveTextContent('private:editor:');
  });

  it('uses the empty private query when opening B fails', async () => {
    const { port, emit } = createAuthPort();
    renderProvider(port, vi.fn(async () => { throw new Error('open failed'); }));
    emit(signedIn('user-b'));
    expect(await screen.findByTestId('services')).toHaveTextContent('?祆??脣?蝛粹??急??⊥?雿輻');
    expect(screen.getByTestId('services')).toHaveTextContent('private:no-editor:');
  });
});
