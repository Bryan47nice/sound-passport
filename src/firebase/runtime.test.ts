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

const productionConfig = {
  VITE_FIREBASE_API_KEY: 'public-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'sound-passport.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'sound-passport',
  VITE_FIREBASE_STORAGE_BUCKET: 'sound-passport.firebasestorage.app',
  VITE_FIREBASE_APP_ID: 'web-app-id',
};

function expectFirebaseApisUntouched() {
  expect(firebase.initializeApp).not.toHaveBeenCalled();
  expect(firebase.getAuth).not.toHaveBeenCalled();
  expect(firebase.getFirestore).not.toHaveBeenCalled();
  expect(firebase.getStorage).not.toHaveBeenCalled();
  expect(firebase.connectAuthEmulator).not.toHaveBeenCalled();
  expect(firebase.connectFirestoreEmulator).not.toHaveBeenCalled();
  expect(firebase.connectStorageEmulator).not.toHaveBeenCalled();
}

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
    const env = {
      VITE_FIREBASE_PROJECT_ID: 'sound-passport',
      VITE_USE_FIREBASE_EMULATORS: 'false',
    };

    expect(resolveFirebaseOptions(env)).toBeUndefined();
    expect(createFirebaseRuntime(env)).toBeUndefined();
    expectFirebaseApisUntouched();
  });

  it('maps a complete production web configuration', () => {
    expect(resolveFirebaseOptions({
      ...productionConfig,
      VITE_USE_FIREBASE_EMULATORS: 'false',
    })).toEqual({
      apiKey: 'public-api-key',
      authDomain: 'sound-passport.firebaseapp.com',
      projectId: 'sound-passport',
      storageBucket: 'sound-passport.firebasestorage.app',
      appId: 'web-app-id',
    });
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
  ])('fails closed before Firebase initialization when the emulator flag is %s', (_label, flag) => {
    const env = {
      ...productionConfig,
      ...(flag === undefined ? {} : { VITE_USE_FIREBASE_EMULATORS: flag }),
    };

    expect(resolveFirebaseOptions(env)).toBeUndefined();
    expect(createFirebaseRuntime(env)).toBeUndefined();
    expectFirebaseApisUntouched();
  });

  it('fails closed before Firebase initialization when the emulator flag is malformed', () => {
    const env = {
      VITE_FIREBASE_API_KEY: 'public-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'sound-passport.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'sound-passport',
      VITE_FIREBASE_STORAGE_BUCKET: 'sound-passport.firebasestorage.app',
      VITE_FIREBASE_APP_ID: 'web-app-id',
      VITE_USE_FIREBASE_EMULATORS: 'tru',
    };

    expect(resolveFirebaseOptions(env)).toBeUndefined();
    expect(createFirebaseRuntime(env)).toBeUndefined();
    expectFirebaseApisUntouched();
  });

  it('connects each emulator only once across runtime calls', () => {
    const env = { ...productionConfig, VITE_USE_FIREBASE_EMULATORS: 'true' };

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
