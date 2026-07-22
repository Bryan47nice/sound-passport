import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => {
  const app = { name: 'sound-passport-web' };
  const auth = {};
  const firestore = {};
  const storage = {};
  const apps: Array<typeof app> = [];

  return {
    app,
    auth,
    firestore,
    storage,
    apps,
    getApp: vi.fn(() => app),
    getApps: vi.fn(() => apps),
    initializeApp: vi.fn(() => {
      apps.push(app);
      return app;
    }),
    getAuth: vi.fn(() => auth),
    getFirestore: vi.fn(() => firestore),
    getStorage: vi.fn(() => storage),
    connectAuthEmulator: vi.fn(),
    connectFirestoreEmulator: vi.fn(),
    connectStorageEmulator: vi.fn(),
  };
});

vi.mock('firebase/app', () => ({
  getApp: firebase.getApp,
  getApps: firebase.getApps,
  initializeApp: firebase.initializeApp,
}));
vi.mock('firebase/auth', () => ({
  connectAuthEmulator: firebase.connectAuthEmulator,
  getAuth: firebase.getAuth,
}));
vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: firebase.connectFirestoreEmulator,
  getFirestore: firebase.getFirestore,
}));
vi.mock('firebase/storage', () => ({
  connectStorageEmulator: firebase.connectStorageEmulator,
  getStorage: firebase.getStorage,
}));

import { createFirebaseRuntime, resolveFirebaseOptions } from './runtime';

beforeEach(() => {
  firebase.apps.length = 0;
  vi.clearAllMocks();
  delete (globalThis as typeof globalThis & {
    __soundPassportFirebaseEmulatorsConnected?: boolean;
  }).__soundPassportFirebaseEmulatorsConnected;
});

describe('resolveFirebaseOptions', () => {
  it('uses a safe demo project for emulator-only development', () => {
    expect(resolveFirebaseOptions({ VITE_USE_FIREBASE_EMULATORS: 'true' })).toMatchObject({
      projectId: 'demo-sound-passport',
      authDomain: 'demo-sound-passport.firebaseapp.com',
    });
  });

  it('returns undefined rather than partially configuring production', () => {
    expect(resolveFirebaseOptions({ VITE_FIREBASE_PROJECT_ID: 'sound-passport' })).toBeUndefined();
  });

  it('maps a complete production web configuration', () => {
    expect(resolveFirebaseOptions({
      VITE_FIREBASE_API_KEY: 'public-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'sound-passport.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'sound-passport',
      VITE_FIREBASE_STORAGE_BUCKET: 'sound-passport.firebasestorage.app',
      VITE_FIREBASE_APP_ID: 'web-app-id',
    })).toEqual({
      apiKey: 'public-api-key',
      authDomain: 'sound-passport.firebaseapp.com',
      projectId: 'sound-passport',
      storageBucket: 'sound-passport.firebasestorage.app',
      appId: 'web-app-id',
    });
  });

  it('connects each emulator only once across runtime calls', () => {
    const env = { VITE_USE_FIREBASE_EMULATORS: 'true' };

    expect(createFirebaseRuntime(env)).toEqual({
      auth: firebase.auth,
      firestore: firebase.firestore,
      storage: firebase.storage,
    });
    expect(createFirebaseRuntime(env)).toEqual({
      auth: firebase.auth,
      firestore: firebase.firestore,
      storage: firebase.storage,
    });

    expect(firebase.connectAuthEmulator).toHaveBeenCalledTimes(1);
    expect(firebase.connectAuthEmulator).toHaveBeenCalledWith(
      firebase.auth,
      'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
    expect(firebase.connectFirestoreEmulator).toHaveBeenCalledTimes(1);
    expect(firebase.connectStorageEmulator).toHaveBeenCalledTimes(1);
  });
});
