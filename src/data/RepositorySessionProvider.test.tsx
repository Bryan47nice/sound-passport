import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { useAuth } from '../auth/AuthContext';
import type { AuthPort, AuthUser } from '../auth/ports';
import type { RepositorySession } from '../bootstrap';
import { emptyJourneyRepository } from './emptyJourneyRepository';
import { fixtureJourneyRepository } from './fixtureJourneyRepository';
import type { JourneyRepository } from './ports';
import { useJourneyRepository, useOptionalJourneyEditorRepository, usePrivateStorageError } from './RepositoryContext';
import { RepositorySessionProvider } from './RepositorySessionProvider';

type EventLog = string[];

const repositoryIdentities = new WeakMap<JourneyRepository, string>();

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

function signedIn(uid: string, overrides: Partial<AuthUser> = {}): AuthUser {
  return { uid, displayName: uid, email: null, photoURL: null, ...overrides };
}

function session(identity: string, events: EventLog = []): RepositorySession {
  const query: JourneyRepository = {
    listCountrySummaries: vi.fn(async () => []),
    listJourneysByCountry: vi.fn(async () => []),
    getJourneyStory: vi.fn(async () => undefined),
  };
  repositoryIdentities.set(query, identity);
  return {
    services: { query, fixtures: fixtureJourneyRepository, editor: query as never },
    close: vi.fn(() => events.push(`close-${identity}`)),
  };
}

function repositoryIdentity(query: JourneyRepository) {
  if (query === fixtureJourneyRepository) return 'fixtures';
  if (query === emptyJourneyRepository) return 'empty';
  return repositoryIdentities.get(query) ?? 'unknown';
}

function Probe({ events, renders }: { events: EventLog; renders?: EventLog }) {
  const { state } = useAuth();
  const query = useJourneyRepository();
  const editor = useOptionalJourneyEditorRepository();
  const error = usePrivateStorageError();
  const identity = repositoryIdentity(query);
  const authIdentity = state.kind === 'signed-in' ? state.user.uid : state.kind;
  renders?.push(`${authIdentity}:${identity}`);

  useEffect(() => {
    events.push(`publish-${identity}`);
  }, [events, identity]);

  return (
    <output data-testid="services">
      {`${identity}:${editor ? 'editor' : 'no-editor'}:${error ?? ''}`}
    </output>
  );
}

interface RenderProviderOptions {
  events?: EventLog;
  renders?: EventLog;
  strictMode?: boolean;
}

function renderProvider(
  port: AuthPort,
  openSession: (uid: string, fixtures: JourneyRepository) => Promise<RepositorySession>,
  { events = [], renders, strictMode = false }: RenderProviderOptions = {},
) {
  const providers = (
    <AuthProvider port={port}>
      <RepositorySessionProvider openSession={openSession}>
        <Probe events={events} renders={renders} />
      </RepositorySessionProvider>
    </AuthProvider>
  );
  const tree: ReactNode = strictMode ? <StrictMode>{providers}</StrictMode> : providers;
  return render(tree);
}

async function expectPublished(identity: string, suffix = 'editor:') {
  await waitFor(() => {
    expect(screen.getByTestId('services')).toHaveTextContent(`${identity}:${suffix}`);
  });
}

afterEach(cleanup);

describe('RepositorySessionProvider', () => {
  it('renders the exact loading label without opening a database', () => {
    const { port } = createAuthPort();
    const openSession = vi.fn();
    renderProvider(port, openSession);
    expect(screen.getByLabelText('確認私人資料')).toBeInTheDocument();
    expect(openSession).not.toHaveBeenCalled();
  });

  it('supplies fixture queries without an editor while signed out', async () => {
    const { port, emit } = createAuthPort();
    const openSession = vi.fn();
    renderProvider(port, openSession);
    emit(null);
    await expectPublished('fixtures', 'no-editor:');
    expect(openSession).not.toHaveBeenCalled();
  });

  it('closes A before publishing B', async () => {
    const events: EventLog = [];
    const { port, emit } = createAuthPort();
    const a = session('a', events);
    const b = session('b', events);
    const openSession = vi.fn(async (uid: string) => uid === 'user-a' ? a : b);
    renderProvider(port, openSession, { events });

    emit(signedIn('user-a'));
    await expectPublished('a');
    emit(signedIn('user-b'));
    await expectPublished('b');

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(events.indexOf('close-a')).toBeLessThan(events.indexOf('publish-b'));
    expect(openSession).toHaveBeenNthCalledWith(1, 'user-a', fixtureJourneyRepository);
    expect(openSession).toHaveBeenNthCalledWith(2, 'user-b', fixtureJourneyRepository);
  });

  it('never renders A services under B auth while B is opening', async () => {
    const renders: EventLog = [];
    const { port, emit } = createAuthPort();
    const a = session('a');
    const openB = deferred<RepositorySession>();
    const openSession = vi.fn((uid: string) => uid === 'user-a' ? Promise.resolve(a) : openB.promise);
    renderProvider(port, openSession, { renders });

    emit(signedIn('user-a'));
    await expectPublished('a');
    renders.length = 0;
    emit(signedIn('user-b'));
    await waitFor(() => expect(openSession).toHaveBeenCalledTimes(2));

    expect(renders).not.toContain('user-b:a');
    expect(screen.queryByTestId('services')).not.toBeInTheDocument();
  });

  it('never renders signed-out fixtures under signed-in auth while the session is opening', async () => {
    const renders: EventLog = [];
    const { port, emit } = createAuthPort();
    const openA = deferred<RepositorySession>();
    const openSession = vi.fn(() => openA.promise);
    renderProvider(port, openSession, { renders });

    emit(null);
    await expectPublished('fixtures', 'no-editor:');
    renders.length = 0;
    emit(signedIn('user-a'));
    await waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));

    expect(renders).not.toContain('user-a:fixtures');
    expect(screen.queryByTestId('services')).not.toBeInTheDocument();
  });

  it('never renders signed-in services under signed-out auth', async () => {
    const renders: EventLog = [];
    const { port, emit } = createAuthPort();
    const a = session('a');
    renderProvider(port, vi.fn(async () => a), { renders });

    emit(signedIn('user-a'));
    await expectPublished('a');
    renders.length = 0;
    emit(null);
    await expectPublished('fixtures', 'no-editor:');

    expect(renders).not.toContain('signed-out:a');
  });

  it('closes a stale A completion without ever publishing A after B', async () => {
    const events: EventLog = [];
    const { port, emit } = createAuthPort();
    const openA = deferred<RepositorySession>();
    const a = session('a', events);
    const b = session('b', events);
    const openSession = vi.fn((uid: string) => uid === 'user-a' ? openA.promise : Promise.resolve(b));
    renderProvider(port, openSession, { events });

    emit(signedIn('user-a'));
    await waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    emit(signedIn('user-b'));
    await expectPublished('b');
    await act(async () => { openA.resolve(a); });

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('services')).toHaveTextContent('b:editor:');
    expect(events).not.toContain('publish-a');
  });

  it('uses the exact private-storage error with an empty private query', async () => {
    const { port, emit } = createAuthPort();
    renderProvider(port, vi.fn(async () => { throw new Error('open failed'); }));
    emit(signedIn('user-b'));

    await expectPublished('empty', 'no-editor:本機儲存空間暫時無法使用');
    expect(screen.getByTestId('services')).toHaveTextContent('本機儲存空間暫時無法使用');
  });

  it('opens and disposes one signed-in session under React StrictMode', async () => {
    const { port, emit } = createAuthPort();
    const a = session('a');
    const openSession = vi.fn(async () => a);
    const view = renderProvider(port, openSession, { strictMode: true });

    emit(signedIn('user-a'));
    await expectPublished('a');
    expect(openSession).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it('closes A and B when switching accounts and then signing out', async () => {
    const { port, emit } = createAuthPort();
    const a = session('a');
    const b = session('b');
    const openSession = vi.fn(async (uid: string) => uid === 'user-a' ? a : b);
    renderProvider(port, openSession);

    emit(signedIn('user-a'));
    await expectPublished('a');
    emit(signedIn('user-b'));
    await expectPublished('b');
    emit(null);
    await expectPublished('fixtures', 'no-editor:');

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the second A published when a stale B completes during A to B to A', async () => {
    const events: EventLog = [];
    const { port, emit } = createAuthPort();
    const firstA = session('a-1', events);
    const secondA = session('a-2', events);
    const b = session('b', events);
    const openB = deferred<RepositorySession>();
    let aCount = 0;
    const openSession = vi.fn((uid: string) => {
      if (uid === 'user-b') return openB.promise;
      aCount += 1;
      return Promise.resolve(aCount === 1 ? firstA : secondA);
    });
    renderProvider(port, openSession, { events });

    emit(signedIn('user-a'));
    await expectPublished('a-1');
    emit(signedIn('user-b'));
    await waitFor(() => expect(openSession).toHaveBeenCalledTimes(2));
    emit(signedIn('user-a'));
    await expectPublished('a-2');
    await act(async () => { openB.resolve(b); });

    expect(firstA.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(secondA.close).not.toHaveBeenCalled();
    expect(screen.getByTestId('services')).toHaveTextContent('a-2:editor:');
    expect(events).not.toContain('publish-b');
  });

  it('ignores a late rejection from A after B is published', async () => {
    const { port, emit } = createAuthPort();
    const openA = deferred<RepositorySession>();
    const b = session('b');
    const openSession = vi.fn((uid: string) => uid === 'user-a' ? openA.promise : Promise.resolve(b));
    renderProvider(port, openSession);

    emit(signedIn('user-a'));
    await waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    emit(signedIn('user-b'));
    await expectPublished('b');
    await act(async () => { openA.reject(new Error('late A failure')); });

    expect(screen.getByTestId('services')).toHaveTextContent('b:editor:');
    expect(screen.getByTestId('services')).not.toHaveTextContent('本機儲存空間暫時無法使用');
  });

  it('does not reopen the database when only profile metadata changes for the same uid', async () => {
    const { port, emit } = createAuthPort();
    const a = session('a');
    const openSession = vi.fn(async () => a);
    renderProvider(port, openSession);

    emit(signedIn('user-a', { displayName: 'First name', email: 'first@example.com' }));
    await expectPublished('a');
    emit(signedIn('user-a', { displayName: 'Updated name', email: 'updated@example.com' }));

    await waitFor(() => expect(openSession).toHaveBeenCalledTimes(1));
    expect(a.close).not.toHaveBeenCalled();
    expect(screen.getByTestId('services')).toHaveTextContent('a:editor:');
  });
});
