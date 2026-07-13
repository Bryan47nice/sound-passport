import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';

export function uniqueDbName(testName: string) {
  return `sound-passport-test-${testName}-${crypto.randomUUID()}`;
}

export async function cleanupDb(name: string) {
  await deleteDB(name);
}
