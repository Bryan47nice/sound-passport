import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthPort, AuthUser } from '../auth/ports';
import type { RepositorySession } from '../bootstrap';
import { emptyJourneyRepository } from '../data/emptyJourneyRepository';
import { fixtureJourneyRepository } from '../data/fixtureJourneyRepository';
import { RepositorySessionProvider } from '../data/RepositorySessionProvider';
import { useDirtyNavigationGuard } from '../features/studio/useDirtyNavigationGuard';
import { AppShell } from './AppShell';
import { NavigationGuardProvider } from './navigationGuard';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAuthPort(user: AuthUser) {
  let listener: ((nextUser: AuthUser | null) => void) | undefined;
  const port: AuthPort = {
    observe: vi.fn((next) => {
      listener = next;
      next(user);
      return vi.fn();
    }),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => { listener?.(null); }),
  };
  return {
    port,
    signOut: port.signOut as ReturnType<typeof vi.fn>,
    emit: (nextUser: AuthUser | null) => listener?.(nextUser),
  };
}

function DirtyGuard({ flush }: { flush: () => Promise<void> }) {
  useDirtyNavigationGuard({ dirty: true, flush });
  return null;
}

function renderSignedInShell(flush: () => Promise<void>, strictMode = false) {
  const auth = createAuthPort({
    uid: 'user-a',
    displayName: '使用者 A',
    email: 'a@example.com',
    photoURL: null,
  });
  const close = vi.fn();
  const session: RepositorySession = {
    services: { query: emptyJourneyRepository, fixtures: fixtureJourneyRepository },
    close,
  };

  const tree = (
    <AuthProvider port={auth.port}>
      <RepositorySessionProvider openSession={vi.fn(async () => session)}>
        <MemoryRouter>
          <NavigationGuardProvider>
            <AppShell><DirtyGuard flush={flush} /></AppShell>
          </NavigationGuardProvider>
        </MemoryRouter>
      </RepositorySessionProvider>
    </AuthProvider>
  );
  render(strictMode ? <StrictMode>{tree}</StrictMode> : tree);

  return { ...auth, close };
}

async function openAccountMenu() {
  await screen.findByLabelText('帳戶選單');
  await userEvent.click(screen.getByLabelText('帳戶選單'));
}

describe('AppShell guarded sign-out', () => {
  afterEach(cleanup);

  it('waits for a deferred dirty flush and runs sign-out exactly once after it resolves', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const { signOut } = renderSignedInShell(flush);
    await openAccountMenu();

    await userEvent.click(screen.getByRole('button', { name: '登出' }));
    await userEvent.click(screen.getByRole('button', { name: '登出' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(); await pending.promise; });
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('write failed'))],
    ['throws', () => { throw new Error('write failed'); }],
  ])('does not sign out or close the uid repository when dirty flush %s', async (_label, flush) => {
    const { signOut, close } = renderSignedInShell(vi.fn(flush));
    await openAccountMenu();

    await userEvent.click(screen.getByRole('button', { name: '登出' }));

    expect(await screen.findByText('目前的變更無法儲存，因此尚未登出。請稍後再試一次。')).toBeVisible();
    expect(signOut).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText('帳戶選單')).toBeInTheDocument();
  });

  it('shows a rejected flush error under React StrictMode', async () => {
    const { signOut } = renderSignedInShell(
      vi.fn(() => Promise.reject(new Error('write failed'))),
      true,
    );
    await openAccountMenu();

    await userEvent.click(screen.getByRole('button', { name: '登出' }));

    expect(await screen.findByText('目前的變更無法儲存，因此尚未登出。請稍後再試一次。')).toBeVisible();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears a dirty-flush error after the next successful auth observer event', async () => {
    const { emit } = renderSignedInShell(vi.fn(() => Promise.reject(new Error('write failed'))));
    await openAccountMenu();
    await userEvent.click(screen.getByRole('button', { name: '登出' }));
    expect(await screen.findByText('目前的變更無法儲存，因此尚未登出。請稍後再試一次。')).toBeVisible();

    act(() => emit({
      uid: 'user-a',
      displayName: '使用者 A',
      email: 'a@example.com',
      photoURL: null,
    }));

    expect(screen.queryByText('目前的變更無法儲存，因此尚未登出。請稍後再試一次。')).not.toBeInTheDocument();
  });
});
