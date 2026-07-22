import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './ports';
import { createE2eAuthPort } from './e2eAuthPort';

const userA: AuthUser = {
  uid: 'e2e-user-a',
  displayName: 'E2E 旅人 A',
  email: 'a@example.test',
  photoURL: null,
};

const userB: AuthUser = {
  uid: 'e2e-user-b',
  displayName: 'E2E 旅人 B',
  email: 'b@example.test',
  photoURL: null,
};

describe('createE2eAuthPort', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__SOUND_PASSPORT_E2E_AUTH__;
  });

  it('restores the stored user, notifies changes once, and detaches unsubscribed listeners', async () => {
    sessionStorage.setItem('sound-passport-e2e-auth', JSON.stringify(userA));
    const port = createE2eAuthPort();
    const listener = vi.fn();

    const unsubscribe = port.observe(listener, vi.fn());
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(userA);

    window.__SOUND_PASSPORT_E2E_AUTH__?.setUser(userB);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(userB);

    await port.signOut();
    expect(sessionStorage.getItem('sound-passport-e2e-auth')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
    window.__SOUND_PASSPORT_E2E_AUTH__?.setUser(userA);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('clears an invalid stored session and reports a signed-out user', async () => {
    sessionStorage.setItem('sound-passport-e2e-auth', '{not-json');

    const port = createE2eAuthPort();
    const listener = vi.fn();
    port.observe(listener, vi.fn());
    await Promise.resolve();

    expect(sessionStorage.getItem('sound-passport-e2e-auth')).toBeNull();
    expect(listener).toHaveBeenCalledWith(null);
  });
});
