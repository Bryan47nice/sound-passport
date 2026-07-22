import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

type FirebaseEnv = Partial<Record<
  | 'VITE_FIREBASE_API_KEY'
  | 'VITE_FIREBASE_AUTH_DOMAIN'
  | 'VITE_FIREBASE_PROJECT_ID'
  | 'VITE_FIREBASE_STORAGE_BUCKET'
  | 'VITE_FIREBASE_APP_ID'
  | 'VITE_USE_FIREBASE_EMULATORS',
  string
>>;

export interface FirebaseRuntime {
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
}

const APP_NAME = 'sound-passport-web';
const emulatorState = globalThis as typeof globalThis & {
  __soundPassportFirebaseEmulatorsConnected?: boolean;
};

export function resolveFirebaseOptions(env: FirebaseEnv): FirebaseOptions | undefined {
  if (env.VITE_USE_FIREBASE_EMULATORS === 'true') {
    return {
      apiKey: 'demo-api-key',
      authDomain: 'demo-sound-passport.firebaseapp.com',
      projectId: 'demo-sound-passport',
      storageBucket: 'demo-sound-passport.appspot.com',
      appId: 'demo-web-app',
    };
  }

  const values = [
    env.VITE_FIREBASE_API_KEY,
    env.VITE_FIREBASE_AUTH_DOMAIN,
    env.VITE_FIREBASE_PROJECT_ID,
    env.VITE_FIREBASE_STORAGE_BUCKET,
    env.VITE_FIREBASE_APP_ID,
  ];
  if (values.some((value) => !value)) return undefined;

  return {
    apiKey: values[0],
    authDomain: values[1],
    projectId: values[2],
    storageBucket: values[3],
    appId: values[4],
  };
}

export function createFirebaseRuntime(env: FirebaseEnv = import.meta.env): FirebaseRuntime | undefined {
  const options = resolveFirebaseOptions(env);
  if (!options) return undefined;

  const app = getApps().some(({ name }) => name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(options, APP_NAME);
  const runtime = {
    auth: getAuth(app),
    firestore: getFirestore(app),
    storage: getStorage(app),
  };

  if (env.VITE_USE_FIREBASE_EMULATORS === 'true'
    && !emulatorState.__soundPassportFirebaseEmulatorsConnected) {
    connectAuthEmulator(runtime.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(runtime.firestore, '127.0.0.1', 8080);
    connectStorageEmulator(runtime.storage, '127.0.0.1', 9199);
    emulatorState.__soundPassportFirebaseEmulatorsConnected = true;
  }

  return runtime;
}
