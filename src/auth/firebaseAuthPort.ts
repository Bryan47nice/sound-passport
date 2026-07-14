import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import type { AuthPort, AuthUser } from './ports';

interface FirebaseAuthDriver {
  observe(next: (user: User | null) => void, error: (error: Error) => void): () => void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

function mapUser(user: Pick<User, 'uid' | 'displayName' | 'email' | 'photoURL'>): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  };
}

export function firebaseAuthDriver(auth: Auth): FirebaseAuthDriver {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  return {
    observe: (next, error) => onAuthStateChanged(auth, next, error),
    signInWithGoogle: async () => { await signInWithPopup(auth, provider); },
    signOut: async () => { await signOut(auth); },
  };
}

export function createFirebaseAuthPort(driver: FirebaseAuthDriver): AuthPort {
  return {
    observe(listener, onError) {
      return driver.observe((user) => listener(user ? mapUser(user) : null), onError);
    },
    signInWithGoogle: () => driver.signInWithGoogle(),
    signOut: () => driver.signOut(),
  };
}

export function createUnavailableAuthPort(): AuthPort {
  return {
    observe(listener) {
      queueMicrotask(() => listener(null));
      return () => undefined;
    },
    async signInWithGoogle() {
      throw new Error('FIREBASE_NOT_CONFIGURED');
    },
    async signOut() {},
  };
}
