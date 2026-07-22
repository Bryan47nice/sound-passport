import type { AuthPort, AuthUser } from './ports';

const STORAGE_KEY = 'sound-passport-e2e-auth';
const defaultUser: AuthUser = {
  uid: 'e2e-user-a',
  displayName: 'E2E 旅人 A',
  email: 'a@example.test',
  photoURL: null,
};

declare global {
  interface Window {
    __SOUND_PASSPORT_E2E_AUTH__?: {
      setUser(user: AuthUser | null): void;
    };
  }
}

function readStoredUser(): AuthUser | null {
  const value = sessionStorage.getItem(STORAGE_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AuthUser;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function createE2eAuthPort(): AuthPort {
  let listener: ((user: AuthUser | null) => void) | undefined;
  let currentUser = readStoredUser();
  const setUser = (user: AuthUser | null) => {
    currentUser = user;
    if (user) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(STORAGE_KEY);
    listener?.(user);
  };

  window.__SOUND_PASSPORT_E2E_AUTH__ = { setUser };

  return {
    observe(next) {
      listener = next;
      queueMicrotask(() => {
        if (listener === next) next(currentUser);
      });
      return () => {
        if (listener === next) listener = undefined;
      };
    },
    signInWithGoogle: async () => setUser(defaultUser),
    signOut: async () => setUser(null),
  };
}
