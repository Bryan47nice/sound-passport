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

  it('enters an explicit locked state when the initial observer event is an error', () => {
    const driver = createControllableAuthPort();
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });

    act(() => driver.emitError(new Error('observer failed')));

    expect(result.current.state).toEqual({
      kind: 'observer-failed',
      message: '無法確認登入狀態。請檢查網路連線後再試一次。',
    });
    expect(result.current.commandError).toBe('無法確認登入狀態。請檢查網路連線後再試一次。');
  });

  it('locks a previously signed-in user when the observer reports an error', () => {
    const driver = createControllableAuthPort();
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });
    const user = { uid: 'user-a', displayName: '使用者 A', email: 'a@example.com', photoURL: null };

    act(() => driver.emit(user));
    act(() => driver.emitError(new Error('observer failed')));

    expect(result.current.state.kind).toBe('observer-failed');
    expect(result.current.state.kind).not.toBe('signed-in');
  });

  it('recovers from the locked state only after the next successful observer event', () => {
    const driver = createControllableAuthPort();
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });
    const user = { uid: 'user-a', displayName: '使用者 A', email: 'a@example.com', photoURL: null };

    act(() => driver.emitError(new Error('observer failed')));
    act(() => result.current.clearCommandError());
    expect(result.current.state.kind).toBe('observer-failed');

    act(() => driver.emit(user));
    expect(result.current.state).toEqual({ kind: 'signed-in', user });
    expect(result.current.commandError).toBe('');

    act(() => driver.emitError(new Error('observer failed again')));
    act(() => driver.emit(null));
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

  it('exposes a sign-out-specific error without changing the signed-in state', async () => {
    const driver = createControllableAuthPort();
    driver.signOut.mockRejectedValueOnce(new Error('network unavailable'));
    const { result } = renderHook(useAuth, { wrapper: provider(driver.port) });
    const user = { uid: 'user-a', displayName: '使用者 A', email: 'a@example.com', photoURL: null };
    act(() => driver.emit(user));

    await act(async () => { await result.current.signOut(); });

    expect(driver.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: 'signed-in', user });
    expect(result.current.commandError).toBe('登出失敗，私人資料仍保持登入狀態。請再試一次。');
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
