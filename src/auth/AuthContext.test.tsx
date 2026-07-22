import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import type { AuthPort, AuthUser } from './ports';

function createControllableAuthPort() {
  let listener: ((user: AuthUser | null) => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  const port: AuthPort = {
    observe: vi.fn((next, error) => {
      listener = next;
      onError = error;
      return vi.fn();
    }),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  };

  return {
    port,
    emit: (user: AuthUser | null) => listener?.(user),
    emitError: (error: Error) => onError?.(error),
    signInWithGoogle: port.signInWithGoogle as ReturnType<typeof vi.fn>,
    signOut: port.signOut as ReturnType<typeof vi.fn>,
  };
}

function provider(port: AuthPort) {
  return function Provider({ children }: PropsWithChildren) {
    return <AuthProvider port={port}>{children}</AuthProvider>;
  };
}

describe('AuthProvider', () => {
  it('transitions from loading through signed-out to signed-in when the observer reports users', () => {
    const driver = createControllableAuthPort();
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });

    expect(result.current.state).toEqual({ kind: 'loading' });
    act(() => driver.emit(null));
    expect(result.current.state).toEqual({ kind: 'signed-out' });
    act(() => driver.emit({ uid: 'user-a', displayName: '使用者 A', email: 'a@example.com', photoURL: null }));
    expect(result.current.state).toMatchObject({ kind: 'signed-in', user: { uid: 'user-a' } });
  });

  it('falls back to signed-out when the auth observer reports an error', () => {
    const driver = createControllableAuthPort();
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });

    act(() => driver.emitError(new Error('observer failed')));

    expect(result.current.state).toEqual({ kind: 'signed-out' });
  });

  it('runs Google sign-in and exposes a localized popup-blocked error', async () => {
    const driver = createControllableAuthPort();
    driver.signInWithGoogle.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });

    await act(async () => { await result.current.signInWithGoogle(); });

    expect(driver.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(result.current.commandError).toBe('瀏覽器封鎖了登入視窗。請允許彈出式視窗後再試一次。');
  });

  it('explains when a user closes the Google sign-in popup', async () => {
    const driver = createControllableAuthPort();
    driver.signInWithGoogle.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });

    await act(async () => { await result.current.signInWithGoogle(); });

    expect(result.current.commandError).toBe('你已關閉登入視窗，請再試一次。');
  });

  it('prevents duplicate commands while an auth command is in flight', async () => {
    const driver = createControllableAuthPort();
    let resolve!: () => void;
    driver.signInWithGoogle.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.signInWithGoogle();
      await Promise.resolve();
    });
    expect(result.current.busy).toBe(true);
    await act(async () => { await result.current.signInWithGoogle(); });
    expect(driver.signInWithGoogle).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve();
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});
