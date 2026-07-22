# Sound Passport Auth and Data Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google sign-in, Firebase Emulator security foundations, uid-isolated local repositories, and explicit separation between signed-out demo content and each signed-in user's private Atlas.

**Architecture:** Keep Firebase behind small runtime and authentication ports. A signed-in Firebase `uid` selects an independent IndexedDB database, while the legacy unscoped database remains untouched for the later consent-based migration Goal. Repository sessions expose either fixture-only services or one user's private services; route-level experience context chooses private or demo navigation without merging their statistics.

**Tech Stack:** React 19, React Router 8, TypeScript 5.9, Vite 8, Vitest 4, Testing Library, Playwright, IndexedDB through `idb`, Firebase modular Web SDK, Firebase Local Emulator Suite, and `@firebase/rules-unit-testing`.

## Global Constraints

- Use Traditional Chinese for all new visible UI copy.
- Google is the only sign-in provider.
- Unauthenticated users can read only fixed fixture journeys; they cannot open private storage or create anonymous cloud records.
- Signed-in Atlas, country counts, journey lists, and playback queries include only the current `uid`'s private completed journeys.
- Fixture journeys remain available through an explicit demo experience and never contribute to private statistics.
- Use one IndexedDB database per Firebase `uid`; never rely on client-side filtering to separate local accounts.
- Preserve the existing unscoped `sound-passport` IndexedDB database byte-for-byte. Consent-based legacy migration is outside this Goal.
- Do not enable Firestore persistent cache. The product's IndexedDB repository remains the only persistent local source.
- Do not write journey, moment, song, or photo content to Firebase in this Goal.
- Cloud photo upload, capacity reservations, account deletion, first-login migration, synchronization, PWA installation, and mobile-home redesign are outside this Goal.
- Firebase web configuration may be committed through environment examples because it is not a server credential; service-account credentials and access tokens must never enter the repository.
- Use a `demo-` Firebase project ID for emulator runs so a missing emulator cannot fall through to live resources.
- Use Java 21 or newer for the Firebase Emulator Suite.
- Every task follows red-green-refactor TDD and ends with a focused commit.

## File Map

- `firebase.json`, `.firebaserc`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`: local Firebase topology and closed-by-default rules.
- `src/test/firebaseRules.test.ts`: cross-user Firestore and Storage isolation tests against emulators.
- `src/firebase/runtime.ts`: environment parsing and modular Firebase SDK initialization; no UI imports.
- `src/auth/ports.ts`: provider-neutral auth contracts.
- `src/auth/firebaseAuthPort.ts`: Google popup adapter for Firebase Authentication.
- `src/auth/AuthContext.tsx`: React auth state machine and user-facing command errors.
- `src/auth/RequireAuth.tsx`: protects Studio routes without changing the requested URL.
- `src/data/indexedDb.ts`: deterministic uid-specific database naming and existing schema opening.
- `src/bootstrap.ts`: creates fixture-only or uid-private repository sessions.
- `src/data/RepositorySessionProvider.tsx`: owns session lifecycle and closes stale database handles.
- `src/app/JourneyExperienceContext.tsx`: selects private or fixture query source plus route prefix.
- `src/auth/e2eAuthPort.ts`: E2E-only auth driver loaded exclusively in Vite `e2e` mode.
- `e2e/auth-data-isolation.spec.ts`: browser-level signed-out, signed-in, demo, and account-switch checks.

## Official References

- Firebase Google sign-in: `https://firebase.google.com/docs/auth/web/google-signin`
- Authentication Emulator: `https://firebase.google.com/docs/emulator-suite/connect_auth`
- Firestore Emulator: `https://firebase.google.com/docs/emulator-suite/connect_firestore`
- Security Rules unit tests: `https://firebase.google.com/docs/rules/unit-tests`

---

### Task 1: Firebase Emulator Configuration and Closed Security Rules

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.firebaserc`
- Create: `firebase.json`
- Create: `firestore.indexes.json`
- Create: `firestore.rules`
- Create: `storage.rules`
- Create: `vitest.rules.config.ts`
- Create: `src/test/firebaseRules.test.ts`
- Create or modify: `.gitignore`

**Interfaces:**
- Produces: `npm run emulators`
- Produces: `npm run test:rules`
- Produces: Firestore profile path `users/{uid}` with `{ createdAt, schemaVersion }`
- Produces: read-only owner access to future Storage path `users/{uid}/photos/{photoId}`
- Does not permit client journey metadata writes or any Storage upload.

- [ ] **Step 1: Install Firebase runtime and test dependencies**

Run:

```powershell
npm.cmd install firebase
npm.cmd install --save-dev firebase-tools @firebase/rules-unit-testing
```

Expected: both commands exit 0 and update `package.json` plus `package-lock.json`.

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "emulators": "firebase emulators:start --project demo-sound-passport",
    "test:rules:vitest": "vitest run --config vitest.rules.config.ts",
    "test:rules": "firebase emulators:exec --project demo-sound-passport --only firestore,storage \"npm run test:rules:vitest\""
  }
}
```

- [ ] **Step 2: Add deterministic emulator configuration**

Create `.firebaserc`:

```json
{
  "projects": {
    "default": "demo-sound-passport"
  }
}
```

Create `firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "auth": { "host": "127.0.0.1", "port": 9099 },
    "firestore": { "host": "127.0.0.1", "port": 8080 },
    "storage": { "host": "127.0.0.1", "port": 9199 },
    "ui": { "enabled": true, "host": "127.0.0.1", "port": 4000 },
    "singleProjectMode": true
  }
}
```

Create `firestore.indexes.json`:

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

Create `vitest.rules.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/firebaseRules.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
```

Ensure `.gitignore` contains:

```gitignore
.env.local
.env.*.local
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
```

- [ ] **Step 3: Write failing cross-user rules tests**

Create `src/test/firebaseRules.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-sound-passport';
let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile('firestore.rules', 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: await readFile('storage.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
});

afterAll(async () => {
  await environment.cleanup();
});

describe('private Firebase paths', () => {
  it('allows an owner profile but rejects another user and unauthenticated access', async () => {
    const userA = environment.authenticatedContext('user-a');
    const userB = environment.authenticatedContext('user-b');
    const anonymous = environment.unauthenticatedContext();
    const profileA = doc(userA.firestore(), 'users/user-a');

    await assertSucceeds(setDoc(profileA, {
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    }));
    await assertSucceeds(getDoc(profileA));
    await assertFails(getDoc(doc(userB.firestore(), 'users/user-a')));
    await assertFails(getDoc(doc(anonymous.firestore(), 'users/user-a')));
    await assertFails(setDoc(doc(userA.firestore(), 'users/user-b'), {
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    }));
  });

  it('rejects client journey writes until the synchronization Goal defines their contract', async () => {
    const userA = environment.authenticatedContext('user-a');
    await assertFails(setDoc(doc(userA.firestore(), 'users/user-a/journeys/journey-1'), {
      title: '不應寫入',
    }));
  });

  it('allows only the owner to read a seeded photo and rejects every client upload', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/user-a'), {
        createdAt: Timestamp.fromMillis(0),
        schemaVersion: 1,
      });
      await uploadBytes(
        ref(context.storage(), 'users/user-a/photos/photo-1'),
        new Uint8Array([1, 2, 3]),
        { contentType: 'image/webp' },
      );
    });

    const userA = environment.authenticatedContext('user-a');
    const userB = environment.authenticatedContext('user-b');
    const anonymous = environment.unauthenticatedContext();
    await assertSucceeds(getBytes(ref(userA.storage(), 'users/user-a/photos/photo-1')));
    await assertFails(getBytes(ref(userB.storage(), 'users/user-a/photos/photo-1')));
    await assertFails(getBytes(ref(anonymous.storage(), 'users/user-a/photos/photo-1')));
    await assertFails(uploadBytes(
      ref(userA.storage(), 'users/user-a/photos/new-photo'),
      new Uint8Array([4]),
      { contentType: 'image/webp' },
    ));
  });
});
```

Temporarily create permissive `firestore.rules` and `storage.rules` with `allow read, write: if true;` so the denial assertions exercise a red state.

- [ ] **Step 4: Run rules tests and verify red state**

Run:

```powershell
npm.cmd run test:rules
```

Expected: FAIL because cross-user reads and writes are currently permitted.

- [ ] **Step 5: Implement closed-by-default rules**

Replace `firestore.rules` with:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    match /users/{uid} {
      allow read: if isOwner(uid);
      allow create: if isOwner(uid)
        && request.resource.data.keys().hasOnly(['createdAt', 'schemaVersion'])
        && request.resource.data.createdAt == request.time
        && request.resource.data.schemaVersion == 1;
      allow update, delete: if false;

      match /{privateDocument=**} {
        allow read, write: if false;
      }
    }
  }
}
```

Replace `storage.rules` with:

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    match /users/{uid}/photos/{photoId} {
      allow read: if isOwner(uid);
      allow write: if false;
    }
  }
}
```

- [ ] **Step 6: Run rules tests and commit**

Run:

```powershell
npm.cmd run test:rules
git add package.json package-lock.json .gitignore .firebaserc firebase.json firestore.indexes.json firestore.rules storage.rules vitest.rules.config.ts src/test/firebaseRules.test.ts
git commit -m "Add Firebase emulator security foundation"
```

Expected: rules tests PASS; commit contains no `.env.local`, emulator export, or Firebase credential file.

---

### Task 2: Firebase Runtime and Provider-Neutral Auth Port

**Files:**
- Create: `.env.example`
- Create: `src/vite-env.d.ts`
- Create: `src/firebase/runtime.ts`
- Create: `src/firebase/runtime.test.ts`
- Create: `src/auth/ports.ts`
- Create: `src/auth/firebaseAuthPort.ts`
- Create: `src/auth/firebaseAuthPort.test.ts`

**Interfaces:**
- Produces: `AuthUser`
- Produces: `AuthPort.observe(listener, onError): () => void`
- Produces: `AuthPort.signInWithGoogle(): Promise<void>`
- Produces: `AuthPort.signOut(): Promise<void>`
- Produces: `createFirebaseRuntime(env): FirebaseRuntime | undefined`
- Consumes: Firebase modular `Auth`, `Firestore`, and `FirebaseStorage` instances.

- [ ] **Step 1: Define the environment contract**

Create `.env.example`:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_APP_ID=
VITE_USE_FIREBASE_EMULATORS=false
```

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_USE_FIREBASE_EMULATORS?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Write failing runtime and auth-adapter tests**

Create `src/firebase/runtime.test.ts` with these exact assertions:

```ts
import { describe, expect, it } from 'vitest';
import { resolveFirebaseOptions } from './runtime';

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
});
```

Create `src/auth/firebaseAuthPort.test.ts` using an injected Firebase driver:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFirebaseAuthPort } from './firebaseAuthPort';

describe('createFirebaseAuthPort', () => {
  it('maps Firebase users and delegates Google sign-in and sign-out', async () => {
    const unsubscribe = vi.fn();
    const driver = {
      observe: vi.fn((next: (user: unknown) => void) => {
        next({ uid: 'user-a', displayName: '旅人 A', email: 'a@example.com', photoURL: null });
        return unsubscribe;
      }),
      signInWithGoogle: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
    };
    const port = createFirebaseAuthPort(driver);
    const listener = vi.fn();

    expect(port.observe(listener, vi.fn())).toBe(unsubscribe);
    expect(listener).toHaveBeenCalledWith({
      uid: 'user-a', displayName: '旅人 A', email: 'a@example.com', photoURL: null,
    });
    await port.signInWithGoogle();
    await port.signOut();
    expect(driver.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(driver.signOut).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run focused tests and verify red state**

Run:

```powershell
npm.cmd run test:run -- src/firebase/runtime.test.ts src/auth/firebaseAuthPort.test.ts
```

Expected: FAIL because the runtime and auth contracts do not exist.

- [ ] **Step 4: Implement Firebase runtime without persistent Firestore cache**

Create `src/firebase/runtime.ts` with these exports and behavior:

```ts
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
    apiKey: values[0], authDomain: values[1], projectId: values[2],
    storageBucket: values[3], appId: values[4],
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
```

Do not call `enableIndexedDbPersistence`, `persistentLocalCache`, or any Firestore persistence initializer.

- [ ] **Step 5: Implement auth contracts and Google adapter**

Create `src/auth/ports.ts`:

```ts
export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface AuthPort {
  observe(listener: (user: AuthUser | null) => void, onError: (error: Error) => void): () => void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}
```

Create `src/auth/firebaseAuthPort.ts`:

```ts
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
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npm.cmd run test:run -- src/firebase/runtime.test.ts src/auth/firebaseAuthPort.test.ts
npm.cmd run typecheck
git add .env.example src/vite-env.d.ts src/firebase src/auth/ports.ts src/auth/firebaseAuthPort.ts src/auth/firebaseAuthPort.test.ts
git commit -m "Add Firebase authentication adapter"
```

Expected: focused tests and typecheck PASS.

---

### Task 3: Auth State Machine, Header Account Menu, and Protected Studio

**Files:**
- Create: `src/auth/AuthContext.tsx`
- Create: `src/auth/AuthContext.test.tsx`
- Create: `src/auth/RequireAuth.tsx`
- Create: `src/auth/RequireAuth.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `AuthPort`
- Produces: `AuthState = loading | signed-out | signed-in`
- Produces: `useAuth()` with `signInWithGoogle`, `signOut`, `busy`, and `commandError`
- Produces: `RequireAuth` route boundary.

- [ ] **Step 1: Write failing auth state and route tests**

Create a reusable fake in `src/auth/AuthContext.test.tsx` and assert these transitions:

```tsx
const driver = createControllableAuthPort();
const { result } = renderHook(useAuth, {
  wrapper: ({ children }) => <AuthProvider port={driver.port}>{children}</AuthProvider>,
});
expect(result.current.state).toEqual({ kind: 'loading' });
act(() => driver.emit(null));
expect(result.current.state).toEqual({ kind: 'signed-out' });
act(() => driver.emit({ uid: 'user-a', displayName: '旅人 A', email: 'a@example.com', photoURL: null }));
expect(result.current.state).toMatchObject({ kind: 'signed-in', user: { uid: 'user-a' } });
```

Also assert:

```tsx
await act(() => result.current.signInWithGoogle());
expect(driver.signInWithGoogle).toHaveBeenCalledTimes(1);
driver.signInWithGoogle.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
await act(() => result.current.signInWithGoogle());
expect(result.current.commandError).toBe('登入視窗被阻擋，請允許彈出式視窗後再試一次。');
```

Create `src/auth/RequireAuth.test.tsx` and verify that a signed-out `/studio` keeps the URL but shows `登入以整理私人旅程`, while a signed-in state renders an `<Outlet />` child.

- [ ] **Step 2: Run focused tests and verify red state**

Run:

```powershell
npm.cmd run test:run -- src/auth/AuthContext.test.tsx src/auth/RequireAuth.test.tsx
```

Expected: FAIL because the provider and route boundary do not exist.

- [ ] **Step 3: Implement the auth state machine**

Create `src/auth/AuthContext.tsx` around this exact public contract:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { AuthPort, AuthUser } from './ports';

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  busy: boolean;
  commandError: string;
  clearCommandError(): void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

const Context = createContext<AuthContextValue | null>(null);

function authMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : error instanceof Error ? error.message : '';
  if (code === 'auth/popup-blocked') return '登入視窗被阻擋，請允許彈出式視窗後再試一次。';
  if (code === 'auth/popup-closed-by-user') return '登入尚未完成，請再試一次。';
  if (code === 'FIREBASE_NOT_CONFIGURED') return 'Google 登入尚未完成環境設定。';
  return '目前無法登入，請稍後再試。';
}

export function AuthProvider({ port, children }: PropsWithChildren<{ port: AuthPort }>) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState('');
  const commandPending = useRef(false);
  useEffect(() => port.observe(
    (user) => setState(user ? { kind: 'signed-in', user } : { kind: 'signed-out' }),
    () => setState({ kind: 'signed-out' }),
  ), [port]);
  const run = useCallback(async (command: () => Promise<void>) => {
    if (commandPending.current) return;
    commandPending.current = true;
    setBusy(true);
    setCommandError('');
    try { await command(); } catch (error) { setCommandError(authMessage(error)); }
    finally {
      commandPending.current = false;
      setBusy(false);
    }
  }, []);
  const value = useMemo<AuthContextValue>(() => ({
    state, busy, commandError,
    clearCommandError: () => setCommandError(''),
    signInWithGoogle: () => run(() => port.signInWithGoogle()),
    signOut: () => run(() => port.signOut()),
  }), [busy, commandError, port, run, state]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthContext is not available');
  return value;
}
```

- [ ] **Step 4: Protect Studio without redirecting away from the requested URL**

Create `src/auth/RequireAuth.tsx`:

```tsx
import { LogIn } from 'lucide-react';
import { Outlet } from 'react-router';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const { state, busy, commandError, signInWithGoogle } = useAuth();
  if (state.kind === 'loading') return <section className="page" aria-label="確認登入狀態" />;
  if (state.kind === 'signed-in') return <Outlet />;
  return (
    <section className="page auth-required">
      <h1 className="page-title">登入以整理私人旅程</h1>
      <p className="muted">登入後，每個帳號只會開啟自己的旅程資料。</p>
      <button className="primary-command" type="button" disabled={busy} onClick={() => void signInWithGoogle()}>
        <LogIn size={17} aria-hidden="true" />{busy ? '登入中' : '使用 Google 登入'}
      </button>
      {commandError && <p className="field-error" role="alert">{commandError}</p>}
    </section>
  );
}
```

Wrap all four `studio` routes in `src/app/App.tsx`:

```tsx
<Route element={<RequireAuth />}>
  <Route path="studio" element={<StudioPage />} />
  <Route path="studio/journeys/new" element={<JourneyCreatePage />} />
  <Route path="studio/journeys/:journeyId/preview" element={<JourneyPreviewPage />} />
  <Route path="studio/journeys/:journeyId" element={<JourneyEditorPage />} />
</Route>
```

- [ ] **Step 5: Replace the local-preview label with auth commands**

Update `AppShell` so signed-out users get one `使用 Google 登入` command and signed-in users get an account menu showing `displayName ?? email ?? '我的帳號'` and `登出`. Keep the passport logo and existing primary navigation. Use `LogIn` and `LogOut` Lucide icons; use the Google profile photo only when `photoURL` is present and keep a text fallback. Task 5 adds `探索示範` only after `/demo` exists.

The command branch must follow this structure:

```tsx
{state.kind === 'signed-out' && (
  <button className="header-auth-command" type="button" disabled={busy} onClick={() => void signInWithGoogle()}>
    <LogIn size={17} aria-hidden="true" />使用 Google 登入
  </button>
)}
{state.kind === 'signed-in' && (
  <details className="account-menu">
    <summary aria-label="開啟帳號選單">
      {state.user.photoURL
        ? <img src={state.user.photoURL} alt="" referrerPolicy="no-referrer" />
        : <span aria-hidden="true">{(state.user.displayName ?? state.user.email ?? '我').slice(0, 1)}</span>}
    </summary>
    <div className="account-menu-popover">
      <strong>{state.user.displayName ?? state.user.email ?? '我的帳號'}</strong>
      <button type="button" disabled={busy} onClick={() => void signOut()}>
        <LogOut size={16} aria-hidden="true" />登出
      </button>
    </div>
  </details>
)}
```

Add compact header/account-menu styles to `src/styles/global.css`. At 390px, the logo, navigation, and account command must fit without horizontal overflow; hide the redundant `brand-name` before hiding navigation labels.

- [ ] **Step 6: Update App tests, run focused verification, and commit**

Create a test wrapper that always provides `AuthProvider`, and update existing App tests to choose signed-out or signed-in state explicitly. Run:

```powershell
npm.cmd run test:run -- src/auth/AuthContext.test.tsx src/auth/RequireAuth.test.tsx src/app/App.test.tsx
npm.cmd run typecheck
git add src/auth/AuthContext.tsx src/auth/AuthContext.test.tsx src/auth/RequireAuth.tsx src/auth/RequireAuth.test.tsx src/app/AppShell.tsx src/app/App.tsx src/app/App.test.tsx src/styles/global.css
git commit -m "Add Google sign-in application states"
```

Expected: focused tests and typecheck PASS; signed-out Studio tests now expect the auth-required screen rather than the storage-unavailable screen.

---

### Task 4: UID-Isolated IndexedDB Repository Sessions

**Files:**
- Modify: `src/data/indexedDb.ts`
- Modify: `src/data/indexedDb.test.ts`
- Create: `src/data/emptyJourneyRepository.ts`
- Modify: `src/data/RepositoryContext.tsx`
- Modify: `src/data/RepositoryContext.test.tsx`
- Replace: `src/bootstrap.ts`
- Replace: `src/bootstrap.test.ts`
- Create: `src/data/RepositorySessionProvider.tsx`
- Create: `src/data/RepositorySessionProvider.test.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `userDatabaseName(uid): string`
- Produces: `openUserSoundPassportDb(uid): Promise<IDBPDatabase<SoundPassportDb>>`
- Produces: `RepositorySession = { services, close }`
- Produces: `openPrivateRepositorySession(options): Promise<RepositorySession>`
- Produces: `RepositorySessionProvider` that reacts to `AuthState`.
- Preserves: `openSoundPassportDb()` and database name `sound-passport` for later migration only.

- [ ] **Step 1: Write failing database-name and isolation tests**

Extend `src/data/indexedDb.test.ts`:

```ts
expect(userDatabaseName('user-a')).toBe('sound-passport-user-user-a');
expect(userDatabaseName('user-b')).toBe('sound-passport-user-user-b');
expect(() => userDatabaseName('')).toThrowError('Firebase uid is required');
```

Add an integration case that opens user A and B databases, creates one draft in A, then asserts B has no private journeys and A still has one after reopening. Also seed the legacy `sound-passport` database first and assert neither uid database sees its records.

- [ ] **Step 2: Run the isolation test and verify red state**

Run:

```powershell
npm.cmd run test:run -- src/data/indexedDb.test.ts src/data/indexedDbJourneyRepository.test.ts
```

Expected: FAIL because uid-specific open functions do not exist.

- [ ] **Step 3: Add deterministic uid database opening**

Add to `src/data/indexedDb.ts` without changing `DB_VERSION` or the store schema:

```ts
export function userDatabaseName(uid: string) {
  if (!uid) throw new Error('Firebase uid is required');
  return `${DB_NAME}-user-${encodeURIComponent(uid)}`;
}

export function openUserSoundPassportDb(uid: string) {
  return openSoundPassportDb(userDatabaseName(uid));
}
```

Do not read, rename, copy, clear, or delete `DB_NAME` in this task.

- [ ] **Step 4: Write failing repository-session lifecycle tests**

Replace `src/bootstrap.test.ts` with tests proving:

```ts
const session = await openPrivateRepositorySession({ uid: 'user-a', ...dependencies });
expect(openDatabase).toHaveBeenCalledWith('user-a');
expect(session.services.query).toBe(privateRepository);
expect(session.services.fixtures).toBe(fixtureJourneyRepository);
expect(session.services.editor).toBe(privateRepository);
session.close();
expect(database.close).toHaveBeenCalledTimes(1);
```

Create `src/data/RepositorySessionProvider.test.tsx` with a controllable auth port and deferred database opening. Verify:

1. `loading` auth renders `確認私人資料` and opens no database.
2. signed-out auth supplies fixture query and no editor.
3. signing in as A opens only A.
4. switching to B closes A before B services become visible.
5. an A open that resolves after switching to B is closed and never published.
6. a failed B open publishes the empty private query plus `本機儲存空間暫時無法使用`, never fixture results.

- [ ] **Step 5: Implement session creation and lifecycle**

Replace `src/bootstrap.ts` with a pure session factory retaining the existing repository assembly:

```ts
import type { IDBPDatabase } from 'idb';
import { BackupService } from './backup/backupService';
import type { SoundPassportDb } from './data/indexedDb';
import { createIndexedDbJourneyRepository } from './data/indexedDbJourneyRepository';
import type { JourneyRepository } from './data/ports';
import type { RepositoryServices } from './data/RepositoryContext';

export interface RepositorySession {
  services: RepositoryServices;
  close(): void;
}

interface SessionOptions {
  uid: string;
  fixtures: JourneyRepository;
  openDatabase(uid: string): Promise<IDBPDatabase<SoundPassportDb>>;
}

export async function openPrivateRepositorySession({ uid, fixtures, openDatabase }: SessionOptions): Promise<RepositorySession> {
  const database = await openDatabase(uid);
  const privateRepository = createIndexedDbJourneyRepository({ db: database });
  return {
    services: {
      query: privateRepository,
      fixtures,
      editor: privateRepository,
      outbox: privateRepository,
      momentOutbox: privateRepository,
      photos: privateRepository,
      privateData: privateRepository,
      backup: new BackupService(privateRepository),
    },
    close: () => database.close(),
  };
}
```

Create `src/data/emptyJourneyRepository.ts`:

```ts
import type { JourneyRepository } from './ports';

export const emptyJourneyRepository: JourneyRepository = {
  listCountrySummaries: async () => [],
  listJourneysByCountry: async () => [],
  getJourneyStory: async () => undefined,
};
```

Extend `RepositoryServices` with optional `fixtures?: JourneyRepository` so existing focused component tests remain concise. `useFixtureJourneyRepository()` returns `context.fixtures ?? context.query`; production session factories must always pass `fixtures` explicitly, and their tests assert that requirement.

Create `RepositorySessionProvider` with an injected `openSession` default. Each auth effect owns a cancellation flag: cleanup closes the published session, and a late resolution closes only its stale database handle. Use this implementation shape:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthContext';
import { openPrivateRepositorySession, type RepositorySession } from '../bootstrap';
import { emptyJourneyRepository } from './emptyJourneyRepository';
import { fixtureJourneyRepository } from './fixtureJourneyRepository';
import { openUserSoundPassportDb } from './indexedDb';
import type { JourneyRepository } from './ports';
import { RepositoryProvider, type RepositoryServices } from './RepositoryContext';

type SessionOpener = (uid: string, fixtures: JourneyRepository) => Promise<RepositorySession>;
type SessionView =
  | { kind: 'loading' }
  | { kind: 'ready'; services: RepositoryServices };

interface RepositorySessionProviderProps extends PropsWithChildren {
  fixtures?: JourneyRepository;
  openSession?: SessionOpener;
}

export function RepositorySessionProvider({
  children,
  fixtures = fixtureJourneyRepository,
  openSession,
}: RepositorySessionProviderProps) {
  const { state } = useAuth();
  const uid = state.kind === 'signed-in' ? state.user.uid : undefined;
  const activeSession = useRef<RepositorySession | undefined>(undefined);
  const defaultOpenSession = useCallback<SessionOpener>(
    (nextUid, nextFixtures) => openPrivateRepositorySession({
      uid: nextUid,
      fixtures: nextFixtures,
      openDatabase: openUserSoundPassportDb,
    }),
    [],
  );
  const sessionOpener = openSession ?? defaultOpenSession;
  const signedOutServices = useMemo<RepositoryServices>(() => ({
    query: fixtures,
    fixtures,
  }), [fixtures]);
  const [view, setView] = useState<SessionView>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    activeSession.current?.close();
    activeSession.current = undefined;

    if (state.kind === 'loading') {
      setView({ kind: 'loading' });
      return () => { cancelled = true; };
    }
    if (state.kind === 'signed-out') {
      setView({ kind: 'ready', services: signedOutServices });
      return () => { cancelled = true; };
    }

    setView({ kind: 'loading' });
    const nextUid = state.user.uid;
    void sessionOpener(nextUid, fixtures).then(
      (session) => {
        if (cancelled) {
          session.close();
          return;
        }
        activeSession.current = session;
        setView({ kind: 'ready', services: session.services });
      },
      () => {
        if (!cancelled) {
          setView({
            kind: 'ready',
            services: {
              query: emptyJourneyRepository,
              fixtures,
              privateStorageError: '本機儲存空間暫時無法使用',
            },
          });
        }
      },
    );

    return () => {
      cancelled = true;
      activeSession.current?.close();
      activeSession.current = undefined;
    };
  }, [fixtures, sessionOpener, signedOutServices, state.kind, uid]);

  if (view.kind === 'loading') {
    return <section className="page" aria-label="確認私人資料" />;
  }
  return <RepositoryProvider services={view.services}>{children}</RepositoryProvider>;
}
```

If linting flags the dependency on `state.kind` plus `uid`, retain both: the kind distinguishes loading/signed-out while `uid` distinguishes signed-in accounts. The effect must never depend on the whole user object, because a display-name refresh must not reopen IndexedDB.

- [ ] **Step 6: Mount the application once with auth and repository providers**

Replace the callback re-render bootstrap in `src/main.tsx` with one root render:

```tsx
const runtime = createFirebaseRuntime();
const authPort = runtime
  ? createFirebaseAuthPort(firebaseAuthDriver(runtime.auth))
  : createUnavailableAuthPort();

root.render(
  <React.StrictMode>
    <AuthProvider port={authPort}>
      <RepositorySessionProvider>
        <BrowserRouter><App /></BrowserRouter>
      </RepositorySessionProvider>
    </AuthProvider>
  </React.StrictMode>,
);
```

Do not place the Firebase SDK inside `RepositoryContext`, domain models, or feature components.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
npm.cmd run test:run -- src/data/indexedDb.test.ts src/bootstrap.test.ts src/data/RepositoryContext.test.tsx src/data/RepositorySessionProvider.test.tsx
npm.cmd run typecheck
git add src/data/indexedDb.ts src/data/indexedDb.test.ts src/data/emptyJourneyRepository.ts src/data/RepositoryContext.tsx src/data/RepositoryContext.test.tsx src/bootstrap.ts src/bootstrap.test.ts src/data/RepositorySessionProvider.tsx src/data/RepositorySessionProvider.test.tsx src/main.tsx
git commit -m "Isolate local repositories by Firebase user"
```

Expected: focused tests and typecheck PASS; no test or implementation opens the legacy database for a signed-in session.

---

### Task 5: Separate Private and Demo Experiences

**Files:**
- Create: `src/app/JourneyExperienceContext.tsx`
- Create: `src/app/JourneyExperienceContext.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/features/atlas/AtlasPage.tsx`
- Modify: `src/features/atlas/AtlasPage.test.tsx`
- Modify: `src/features/country/CountryPage.tsx`
- Modify: `src/features/country/CountryPage.test.tsx`
- Modify: `src/features/journey/JourneyPage.tsx`
- Modify: `src/features/journey/JourneyPage.test.tsx`
- Modify: `src/features/player/JourneyPlayerPage.tsx`
- Modify: `src/features/player/JourneyPlayerPage.test.tsx`

**Interfaces:**
- Produces: `JourneyExperienceKind = 'private' | 'demo'`
- Produces: `useJourneyExperience(): { kind, repository, routePrefix }`
- Produces: `experiencePath(routePrefix, path): string`
- Consumes: `useJourneyRepository()` for private/selected root query and `useFixtureJourneyRepository()` for explicit demos.

- [ ] **Step 1: Write failing experience-path and route tests**

Create `src/app/JourneyExperienceContext.test.tsx`:

```tsx
expect(experiencePath('', '/countries/JP')).toBe('/countries/JP');
expect(experiencePath('/demo', '/countries/JP')).toBe('/demo/countries/JP');
expect(experiencePath('/demo', '')).toBe('/demo');
```

Extend `App.test.tsx` to verify:

1. signed-out `/` uses fixture summaries.
2. signed-in `/` uses only the private repository.
3. signed-in `/demo` uses fixtures and labels the experience `探索示範`.
4. signed-in fixture counts do not appear on `/`.
5. signed-out `/studio` still shows the Google sign-in wall.

- [ ] **Step 2: Run focused route tests and verify red state**

Run:

```powershell
npm.cmd run test:run -- src/app/JourneyExperienceContext.test.tsx src/app/App.test.tsx
```

Expected: FAIL because the demo route and experience context do not exist.

- [ ] **Step 3: Implement the route-level query source**

Create `src/app/JourneyExperienceContext.tsx`:

```tsx
import { createContext, useContext, useMemo } from 'react';
import { Outlet } from 'react-router';
import { useFixtureJourneyRepository, useJourneyRepository } from '../data/RepositoryContext';
import type { JourneyRepository } from '../data/ports';

export type JourneyExperienceKind = 'private' | 'demo';

interface JourneyExperienceValue {
  kind: JourneyExperienceKind;
  repository: JourneyRepository;
  routePrefix: '' | '/demo';
}

const Context = createContext<JourneyExperienceValue | null>(null);

export function experiencePath(prefix: '' | '/demo', path: string) {
  return `${prefix}${path}` || '/';
}

export function JourneyExperienceBoundary({
  kind,
  routePrefix,
}: {
  kind: JourneyExperienceKind;
  routePrefix: '' | '/demo';
}) {
  const privateRepository = useJourneyRepository();
  const fixtureRepository = useFixtureJourneyRepository();
  const value = useMemo(() => ({
    kind,
    routePrefix,
    repository: kind === 'demo' ? fixtureRepository : privateRepository,
  }), [fixtureRepository, kind, privateRepository, routePrefix]);
  return <Context.Provider value={value}><Outlet /></Context.Provider>;
}

export function useJourneyExperience() {
  const value = useContext(Context);
  if (!value) throw new Error('JourneyExperienceContext is not available');
  return value;
}
```

- [ ] **Step 4: Define private root and explicit demo routes**

In `App.tsx`, use auth state to choose the root experience:

```tsx
function RootExperienceBoundary() {
  const { state } = useAuth();
  return <JourneyExperienceBoundary
    kind={state.kind === 'signed-in' ? 'private' : 'demo'}
    routePrefix=""
  />;
}
```

Use the same read-only pages under both route groups:

```tsx
<Route element={<RootExperienceBoundary />}>
  <Route index element={<AtlasPage />} />
  <Route path="countries/:countryCode" element={<CountryPage />} />
  <Route path="journeys/:journeyId/play" element={<JourneyPlayerPage />} />
  <Route path="journeys/:journeyId" element={<JourneyPage />} />
</Route>
<Route path="demo" element={<JourneyExperienceBoundary kind="demo" routePrefix="/demo" />}>
  <Route index element={<AtlasPage />} />
  <Route path="countries/:countryCode" element={<CountryPage />} />
  <Route path="journeys/:journeyId/play" element={<JourneyPlayerPage />} />
  <Route path="journeys/:journeyId" element={<JourneyPage />} />
</Route>
```

Keep Studio routes outside both experience groups.

Now that `/demo` exists, add this signed-in entry inside `AppShell`'s account popover:

```tsx
<GuardedLink to="/demo">探索示範</GuardedLink>
```

- [ ] **Step 5: Make all read-only pages experience-aware**

In `AtlasPage`, `CountryPage`, `JourneyPage`, and `JourneyPlayerPage`, replace `useJourneyRepository()` with `useJourneyExperience()`. Build links with `experiencePath(routePrefix, ...)`:

```ts
navigate(experiencePath(routePrefix, `/countries/${countryCode}`));
```

```tsx
<GuardedLink to={experiencePath(routePrefix, `/journeys/${journey.id}`)}>
```

```tsx
<GuardedLink to={experiencePath(routePrefix, `/journeys/${story.journey.id}/play`)}>
```

```tsx
<GuardedLink to={experiencePath(routePrefix, '')}>返回旅行地圖</GuardedLink>
```

Remove degraded combined-repository copy such as `目前只顯示示範旅程`; a private query failure must show a private-data error and must never fall back to fixtures.

For an empty private Atlas, render:

```tsx
<section className="page empty-state">
  <h1>還沒有私人旅程</h1>
  <GuardedLink className="primary-command" to="/studio/journeys/new">建立第一趟旅程</GuardedLink>
  <GuardedLink className="secondary-command" to="/demo">查看示範</GuardedLink>
</section>
```

For the explicit demo Atlas, use eyebrow `探索示範` and do not show private counts. Fixture copying remains available only when the signed-in repository session exposes `editor`; signed-out sessions expose no editor.

- [ ] **Step 6: Update focused page tests and commit**

Wrap direct page tests in `JourneyExperienceBoundary` or a small test provider with the expected prefix. Add assertions that country, journey, player, and back links retain `/demo` throughout the demo flow.

Run:

```powershell
npm.cmd run test:run -- src/app/JourneyExperienceContext.test.tsx src/app/App.test.tsx src/features/atlas/AtlasPage.test.tsx src/features/country/CountryPage.test.tsx src/features/journey/JourneyPage.test.tsx src/features/player/JourneyPlayerPage.test.tsx
npm.cmd run typecheck
git add src/app/JourneyExperienceContext.tsx src/app/JourneyExperienceContext.test.tsx src/app/App.tsx src/app/App.test.tsx src/app/AppShell.tsx src/features/atlas src/features/country src/features/journey src/features/player
git commit -m "Separate private Atlas from demo journeys"
```

Expected: focused tests and typecheck PASS; private and demo paths never share query results or counts.

---

### Task 6: Browser-Level Account Switching and Isolation

**Files:**
- Create: `src/auth/e2eAuthPort.ts`
- Create: `src/auth/e2eAuthPort.test.ts`
- Modify: `src/main.tsx`
- Modify: `e2e/viteServer.ts`
- Create: `e2e/helpers/auth.ts`
- Create: `e2e/auth-data-isolation.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Produces only in `import.meta.env.MODE === 'e2e'`: `window.__SOUND_PASSPORT_E2E_AUTH__.setUser(user)`.
- Uses the same `AuthPort`, `AuthProvider`, repository session provider, routes, and IndexedDB implementation as production.
- Does not bypass Firebase Security Rules tests; it avoids automating Google's real account chooser.

- [ ] **Step 1: Write a failing unit test for the E2E auth driver**

Create `src/auth/e2eAuthPort.test.ts` and assert that `observe` immediately receives the stored user, `setUser` notifies once, `signOut` stores `null`, and an unsubscribed listener receives no later updates.

Use this fixed non-sensitive test user shape:

```ts
{
  uid: 'e2e-user-a',
  displayName: 'E2E 旅人 A',
  email: 'a@example.test',
  photoURL: null,
}
```

- [ ] **Step 2: Run the driver test and verify red state**

Run:

```powershell
npm.cmd run test:run -- src/auth/e2eAuthPort.test.ts
```

Expected: FAIL because the E2E-only adapter does not exist.

- [ ] **Step 3: Implement a mode-gated E2E auth adapter**

Create `src/auth/e2eAuthPort.ts` with sessionStorage key `sound-passport-e2e-auth`, an internal current listener, and this controller contract:

```ts
declare global {
  interface Window {
    __SOUND_PASSPORT_E2E_AUTH__?: {
      setUser(user: AuthUser | null): void;
    };
  }
}
```

`createE2eAuthPort()` must install the controller for the lifetime of the E2E page. Observer unsubscribe detaches only that listener so React Strict Mode can subscribe again without losing the controller. Implement it as:

```ts
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
  return value ? JSON.parse(value) as AuthUser : null;
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
```

In `main.tsx`, load it only through this compile-time branch:

```ts
async function resolveAuthPort() {
  if (import.meta.env.MODE === 'e2e') {
    const { createE2eAuthPort } = await import('./auth/e2eAuthPort');
    return createE2eAuthPort();
  }
  const runtime = createFirebaseRuntime();
  return runtime
    ? createFirebaseAuthPort(firebaseAuthDriver(runtime.auth))
    : createUnavailableAuthPort();
}
```

Never select this adapter from a query string, localStorage flag, hostname, or production environment variable.

- [ ] **Step 4: Start Playwright's Vite server in E2E mode**

Change `e2e/viteServer.ts`:

```ts
const server = await createServer({
  mode: 'e2e',
  server: {
    host: baseURL.hostname,
    port: Number(baseURL.port),
    strictPort: true,
  },
});
```

Create `e2e/helpers/auth.ts`:

```ts
import type { Page } from '@playwright/test';
import type { AuthUser } from '../../src/auth/ports';

export async function setE2eUser(page: Page, user: AuthUser | null) {
  await page.waitForFunction(() => Boolean(window.__SOUND_PASSPORT_E2E_AUTH__));
  await page.evaluate((nextUser) => {
    window.__SOUND_PASSPORT_E2E_AUTH__?.setUser(nextUser);
  }, user);
}
```

- [ ] **Step 5: Add browser isolation scenarios**

Create `e2e/auth-data-isolation.spec.ts` with desktop-only account mutation and read-only mobile checks:

```ts
test('keeps each signed-in account in its own local repository', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Studio is desktop-only.');
  await page.goto('/');
  await setE2eUser(page, userA);
  await page.goto('/studio/journeys/new');
  await page.getByLabel('旅程標題').fill('A 的東京旅程');
  await page.getByLabel('國家').fill('日本');
  await page.getByLabel('開始日期').fill('2026-01-01');
  await page.getByLabel('結束日期').fill('2026-01-03');
  await page.getByRole('button', { name: '建立旅程' }).click();
  await expect(page).toHaveURL(/\/studio\/journeys\//);

  await setE2eUser(page, userB);
  await page.goto('/studio');
  await expect(page.getByText('A 的東京旅程')).toHaveCount(0);

  await setE2eUser(page, userA);
  await page.goto('/studio');
  await expect(page.getByText('A 的東京旅程')).toBeVisible();
});
```

Add scenarios that verify:

```ts
await setE2eUser(page, null);
await page.goto('/studio');
await expect(page.getByRole('heading', { name: '登入以整理私人旅程' })).toBeVisible();
```

```ts
await setE2eUser(page, userA);
await page.goto('/');
await expect(page.getByRole('heading', { name: '還沒有私人旅程' })).toBeVisible();
await page.goto('/demo');
await expect(page.getByRole('button', { name: '日本，2 趟旅程' })).toBeVisible();
```

The mobile project must verify the signed-in account menu and `/demo` route at 390x844 without horizontal overflow.

- [ ] **Step 6: Run E2E-focused and full browser tests, then commit**

Run:

```powershell
npm.cmd run test:run -- src/auth/e2eAuthPort.test.ts
npm.cmd run test:e2e -- e2e/auth-data-isolation.spec.ts
npm.cmd run test:e2e
git add src/auth/e2eAuthPort.ts src/auth/e2eAuthPort.test.ts src/main.tsx e2e/viteServer.ts e2e/helpers/auth.ts e2e/auth-data-isolation.spec.ts playwright.config.ts
git commit -m "Verify browser account data isolation"
```

Expected: focused auth test and all Playwright projects PASS; existing signed-out fixture flows remain unchanged.

---

### Task 7: Documentation and Complete Goal Verification

**Files:**
- Modify: `README.md`
- Modify if required by review: files changed in Tasks 1-6

**Interfaces:**
- Documents local emulator startup, production Firebase web configuration, Google provider enablement, test commands, and current scope exclusions.

- [ ] **Step 1: Document setup without recording credentials**

Add a `Firebase 開發環境` section to `README.md` containing these commands:

```powershell
Copy-Item .env.example .env.local
npm.cmd run emulators
npm.cmd run dev
```

Document that production setup requires creating a Firebase Web App, enabling only Google under Authentication providers, copying the public web config to `.env.local`, and adding authorized domains in Firebase Console. State that `.env.local` is intentionally ignored and that service-account JSON must never be placed in this frontend repository.

Document the current milestone boundary: the application uses Firebase Authentication, while Firestore rules only reserve a minimal owner-profile contract and the application does not write that profile yet. Travel metadata and photos remain local until later migration/sync Goals.

- [ ] **Step 2: Run the complete verification matrix**

Run in this order:

```powershell
npm.cmd run test:run
npm.cmd run test:rules
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Expected:

- Vitest reports 0 failed test files and 0 failed tests.
- Rules tests prove unauthenticated and cross-user Firestore/Storage access is denied.
- TypeScript and Vite production build exit 0.
- Desktop and mobile Playwright projects exit 0.
- `git diff --check` prints no errors.

- [ ] **Step 3: Perform a privacy and scope audit**

Run:

```powershell
rg -n "enableIndexedDbPersistence|persistentLocalCache|serviceAccount|private_key|GOOGLE_APPLICATION_CREDENTIALS" src . --glob '!node_modules/**' --glob '!docs/superpowers/**'
rg -n "createCombinedJourneyRepository" src/main.tsx src/bootstrap.ts src/data/RepositorySessionProvider.tsx
git status --short
```

Expected:

- No Firestore persistent cache calls or credential material.
- Production bootstrap does not combine fixtures with private queries.
- Only intentional source, test, configuration, lockfile, README, and plan/spec changes are present.
- Existing unrelated `.superpowers/sdd/task-5-report.md` remains unstaged and unmodified by this Goal.

- [ ] **Step 4: Commit documentation and prepare review**

Run:

```powershell
git add README.md
git commit -m "Document private Firebase foundation"
git status --short
```

Expected: implementation commits are ready for review; the Goal is not marked complete until every command in Step 2 has fresh passing output and the privacy audit in Step 3 matches expectations.
