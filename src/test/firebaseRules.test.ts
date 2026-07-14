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
      title: '\u4e0d\u61c9\u5beb\u5165?',
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
