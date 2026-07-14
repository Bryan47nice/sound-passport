import { describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase/auth';

const firebase = vi.hoisted(() => ({
  setCustomParameters: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider() {
    return { setCustomParameters: firebase.setCustomParameters };
  }),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: firebase.GoogleAuthProvider,
  onAuthStateChanged: firebase.onAuthStateChanged,
  signInWithPopup: firebase.signInWithPopup,
  signOut: firebase.signOut,
}));

import {
  createFirebaseAuthPort,
  createUnavailableAuthPort,
  firebaseAuthDriver,
} from './firebaseAuthPort';

describe('createFirebaseAuthPort', () => {
  it('maps Firebase users and delegates Google sign-in and sign-out', async () => {
    const unsubscribe = vi.fn();
    const driver = {
      observe: vi.fn((next: (user: unknown) => void) => {
        next({ uid: 'user-a', displayName: 'User A', email: 'a@example.com', photoURL: null });
        return unsubscribe;
      }),
      signInWithGoogle: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
    };
    const port = createFirebaseAuthPort(driver);
    const listener = vi.fn();

    expect(port.observe(listener, vi.fn())).toBe(unsubscribe);
    expect(listener).toHaveBeenCalledWith({
      uid: 'user-a', displayName: 'User A', email: 'a@example.com', photoURL: null,
    });
    await port.signInWithGoogle();
    await port.signOut();
    expect(driver.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(driver.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('createUnavailableAuthPort', () => {
  it('reports a signed-out user and refuses Google sign-in', async () => {
    const port = createUnavailableAuthPort();
    const listener = vi.fn();

    port.observe(listener, vi.fn());
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(null);
    await expect(port.signInWithGoogle()).rejects.toThrow('FIREBASE_NOT_CONFIGURED');
    await expect(port.signOut()).resolves.toBeUndefined();
  });
});

describe('firebaseAuthDriver', () => {
  it('selects a Google account and forwards authentication observer errors', async () => {
    const auth = {} as Auth;
    const unsubscribe = vi.fn();
    const expectedError = new Error('observer failed');
    const listener = vi.fn();
    const onError = vi.fn();
    firebase.onAuthStateChanged.mockImplementation((_auth, next, error) => {
      next(null);
      error?.(expectedError);
      return unsubscribe;
    });

    const port = createFirebaseAuthPort(firebaseAuthDriver(auth));

    expect(port.observe(listener, onError)).toBe(unsubscribe);
    expect(listener).toHaveBeenCalledWith(null);
    expect(onError).toHaveBeenCalledWith(expectedError);
    expect(firebase.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    await port.signInWithGoogle();
    await port.signOut();
    expect(firebase.signInWithPopup).toHaveBeenCalledWith(auth, expect.anything());
    expect(firebase.signOut).toHaveBeenCalledWith(auth);
  });
});
