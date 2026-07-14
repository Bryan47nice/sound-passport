import type { IDBPDatabase, IDBPTransaction } from 'idb';
import { summarizeCountries } from '../domain/countrySummary';
import type {
  Journey,
  JourneyPatch,
  JourneyStatus,
  JourneyStory,
  Moment,
  MomentPatch,
  NewJourney,
  NormalizedPhotoInput,
  PhotoAsset,
  PrivateJourneySnapshot,
  SongReference,
} from '../domain/model';
import { validateJourneyForReview } from '../domain/journeyValidation';
import {
  assertPrivateSnapshotSemantics,
  isPublishablePrivateStory,
  SnapshotSemanticError,
} from '../domain/privateSnapshotValidation';
import { photoEnvelopeViolation } from '../media/photoLimits';
import { parseYouTubeVideoId } from '../domain/youtube';
import {
  JourneyStatusTransitionError,
  JourneyValidationError,
  JourneyVersionConflictError,
  MomentVersionConflictError,
  MomentOrderConflictError,
  PrivateDataStateConflictError,
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
  type MomentAutosaveOutboxPort,
  type MomentAutosaveOutboxRecord,
  type PrivateDataPrimaryKeys,
  type SetJourneyStatusOptions,
  type UpdateMomentOptions,
  JourneyEditorRepository,
  JourneyRepository,
  PhotoAssetRepository,
  PrivateDataPort,
} from './ports';
import type { SoundPassportDb } from './indexedDb';
import { JourneyQueryError, StorageCapacityError } from './storageErrors';

export { StorageCapacityError } from './storageErrors';

const stores = ['journeys', 'moments', 'songs', 'photos'] as const;
const privateStores = [...stores, 'journeyAutosaveOutbox', 'momentAutosaveOutbox'] as const;
type WriteTransaction = IDBPTransaction<SoundPassportDb, typeof stores, 'readwrite'>;
type PrivateWriteTransaction = IDBPTransaction<SoundPassportDb, typeof privateStores, 'readwrite'>;
type OutboxWriteTransaction = IDBPTransaction<
  SoundPassportDb,
  ['journeys', 'journeyAutosaveOutbox'],
  'readwrite'
>;
type MomentOutboxWriteTransaction = IDBPTransaction<
  SoundPassportDb,
  ['journeys', 'moments', 'momentAutosaveOutbox'],
  'readwrite'
>;

export interface IndexedDbJourneyRepository
  extends JourneyRepository,
    JourneyEditorRepository,
    JourneyAutosaveOutboxPort,
    MomentAutosaveOutboxPort,
    PhotoAssetRepository,
    PrivateDataPort {
  createJourneyCopy(
    input: NewJourney,
    moments: JourneyStory['moments'],
    photos: NormalizedPhotoInput[],
  ): Promise<Journey>;
}

export interface IndexedDbJourneyRepositoryOptions {
  db: IDBPDatabase<SoundPassportDb>;
}

function isQuotaExceededError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

function missingRecord(kind: string, id: string) {
  return new Error(`${kind} ${id} was not found.`);
}

function relationshipError(detail: string) {
  return new Error(`Snapshot relationship is invalid: ${detail}.`);
}

function assertSnapshotSemantics(snapshot: PrivateJourneySnapshot) {
  try {
    assertPrivateSnapshotSemantics(snapshot);
  } catch (error) {
    if (error instanceof SnapshotSemanticError) {
      throw relationshipError(`semantic validation failed: ${error.message}`);
    }
    throw error;
  }
}

function assertPhotoEnvelope(photos: Array<Pick<PhotoAsset, 'blob' | 'byteSize'>>) {
  const violation = photoEnvelopeViolation(photos);
  if (violation) throw relationshipError(`photo envelope exceeds the ${violation} limit`);
}

function nextUpdatedAt(previousUpdatedAt: string) {
  const previousTime = Date.parse(previousUpdatedAt);
  const minimumTime = Number.isFinite(previousTime) ? previousTime + 1 : Date.now();
  return new Date(Math.max(Date.now(), minimumTime)).toISOString();
}

function compareByCreatedAtAndId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function orderedSnapshot(snapshot: PrivateJourneySnapshot): PrivateJourneySnapshot {
  const journeys = [...snapshot.journeys].sort(compareByCreatedAtAndId);
  const journeyRank = new Map(journeys.map((journey, index) => [journey.id, index]));
  const moments = [...snapshot.moments].sort((left, right) =>
    (journeyRank.get(left.journeyId) ?? Number.MAX_SAFE_INTEGER) -
      (journeyRank.get(right.journeyId) ?? Number.MAX_SAFE_INTEGER) ||
    left.sortOrder - right.sortOrder ||
    compareByCreatedAtAndId(left, right),
  );
  const songRank = new Map(moments.map((moment, index) => [moment.songReferenceId, index]));
  const photoRank = new Map(
    moments.flatMap((moment, index) => (moment.photoAssetId ? [[moment.photoAssetId, index] as const] : [])),
  );
  const songs = [...snapshot.songs].sort(
    (left, right) =>
      (songRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (songRank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
  );
  const photos = [...snapshot.photos].sort(
    (left, right) =>
      (photoRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (photoRank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      compareByCreatedAtAndId(left, right),
  );
  return { journeys, moments, songs, photos };
}

function assertUniqueIds<T extends { id: string }>(kind: string, records: T[]) {
  const ids = new Set<string>();
  records.forEach((record) => {
    if (ids.has(record.id)) throw relationshipError(`duplicate ${kind} ${record.id}`);
    ids.add(record.id);
  });
  return ids;
}

function assertExactReorderSet(journeyId: string, journeyMoments: Moment[], orderedIds: string[]) {
  const expectedIds = new Set(journeyMoments.map((moment) => moment.id));
  const submittedIds = new Set(orderedIds);
  const isExactSet =
    expectedIds.size === orderedIds.length &&
    submittedIds.size === orderedIds.length &&
    orderedIds.every((id) => expectedIds.has(id));
  if (!isExactSet) throw new MomentOrderConflictError(journeyId);
}

function samePrimaryKeys(actual: string[], expected: readonly string[]) {
  if (new Set(expected).size !== expected.length || actual.length !== expected.length) return false;
  const sortedExpected = [...expected].sort();
  return [...actual].sort().every((key, index) => key === sortedExpected[index]);
}

async function assertTargetKeysUnchanged(tx: WriteTransaction, expected: PrivateDataPrimaryKeys) {
  const current = await Promise.all(stores.map((storeName) => tx.objectStore(storeName).getAllKeys()));
  for (const [index, storeName] of stores.entries()) {
    if (!samePrimaryKeys(current[index], expected[storeName])) {
      throw new PrivateDataStateConflictError();
    }
  }
}

async function readJoinedMoments(tx: WriteTransaction, journeyId: string) {
  const moments = await tx.objectStore('moments').index('journeyId').getAll(journeyId);
  moments.sort((left, right) => left.sortOrder - right.sortOrder);
  return Promise.all(moments.map(async (moment) => {
    const song = await tx.objectStore('songs').get(moment.songReferenceId);
    if (!song) throw relationshipError(`moment ${moment.id} references missing song ${moment.songReferenceId}`);
    return { ...moment, song };
  }));
}

async function advanceJourneyStoryVersion(tx: WriteTransaction, journeyId: string) {
  const journeyStore = tx.objectStore('journeys');
  const journey = await journeyStore.get(journeyId);
  if (!journey) throw missingRecord('Journey', journeyId);

  const joinedMoments = await readJoinedMoments(tx, journeyId);
  const status: JourneyStatus = journey.status === 'complete' &&
    !validateJourneyForReview({ journey, moments: joinedMoments }).valid
    ? 'review'
    : journey.status;
  const updated: Journey = { ...journey, status, updatedAt: nextUpdatedAt(journey.updatedAt) };
  await journeyStore.put(updated);
  return updated;
}

async function advanceJourneyStoryVersionInPrivateWrite(
  tx: PrivateWriteTransaction,
  journeyId: string,
) {
  const journeyStore = tx.objectStore('journeys');
  const journey = await journeyStore.get(journeyId);
  if (!journey) throw missingRecord('Journey', journeyId);

  const moments = await tx.objectStore('moments').index('journeyId').getAll(journeyId);
  moments.sort((left, right) => left.sortOrder - right.sortOrder);
  const joinedMoments = await Promise.all(moments.map(async (moment) => {
    const song = await tx.objectStore('songs').get(moment.songReferenceId);
    if (!song) throw relationshipError(`moment ${moment.id} references missing song ${moment.songReferenceId}`);
    return { ...moment, song };
  }));
  const status: JourneyStatus = journey.status === 'complete' &&
    !validateJourneyForReview({ journey, moments: joinedMoments }).valid
    ? 'review'
    : journey.status;
  const updated: Journey = { ...journey, status, updatedAt: nextUpdatedAt(journey.updatedAt) };
  await journeyStore.put(updated);
  return updated;
}

export function createIndexedDbJourneyRepository({ db }: IndexedDbJourneyRepositoryOptions): IndexedDbJourneyRepository {
  async function runWrite<T>(work: (tx: WriteTransaction) => Promise<T>) {
    const tx = db.transaction(stores, 'readwrite');
    try {
      const result = await work(tx);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // A failed IndexedDB request may have already aborted the transaction.
      }
      try {
        await tx.done;
      } catch {
        // Preserve the operation error, which carries more detail than AbortError.
      }
      if (isQuotaExceededError(error)) throw new StorageCapacityError(error);
      throw error;
    }
  }

  async function runOutboxWrite<T>(work: (tx: OutboxWriteTransaction) => Promise<T>) {
    const tx = db.transaction(['journeys', 'journeyAutosaveOutbox'], 'readwrite');
    try {
      const result = await work(tx);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // A failed IndexedDB request may have already aborted the transaction.
      }
      try {
        await tx.done;
      } catch {
        // Preserve the operation error, which carries more detail than AbortError.
      }
      if (isQuotaExceededError(error)) throw new StorageCapacityError(error);
      throw error;
    }
  }

  async function runMomentOutboxWrite<T>(work: (tx: MomentOutboxWriteTransaction) => Promise<T>) {
    const tx = db.transaction(['journeys', 'moments', 'momentAutosaveOutbox'], 'readwrite');
    try {
      const result = await work(tx);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // A failed IndexedDB request may have already aborted the transaction.
      }
      try {
        await tx.done;
      } catch {
        // Preserve the operation error, which carries more detail than AbortError.
      }
      if (isQuotaExceededError(error)) throw new StorageCapacityError(error);
      throw error;
    }
  }

  async function runPrivateWrite<T>(work: (tx: PrivateWriteTransaction) => Promise<T>) {
    const tx = db.transaction(privateStores, 'readwrite');
    try {
      const result = await work(tx);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // A failed IndexedDB request may have already aborted the transaction.
      }
      try {
        await tx.done;
      } catch {
        // Preserve the operation error, which carries more detail than AbortError.
      }
      if (isQuotaExceededError(error)) throw new StorageCapacityError(error);
      throw error;
    }
  }

  async function deleteJourneyOutboxes(tx: OutboxWriteTransaction, journeyId: string) {
    const store = tx.objectStore('journeyAutosaveOutbox');
    const keys = await store.index('journeyId').getAllKeys(journeyId);
    for (const key of keys) await store.delete(key);
  }

  async function deleteMomentOutboxesByMoment(tx: MomentOutboxWriteTransaction, momentId: string) {
    const store = tx.objectStore('momentAutosaveOutbox');
    const keys = await store.index('momentId').getAllKeys(momentId);
    for (const key of keys) await store.delete(key);
  }

  async function deleteMomentOutboxesByJourney(tx: MomentOutboxWriteTransaction, journeyId: string) {
    const store = tx.objectStore('momentAutosaveOutbox');
    const keys = await store.index('journeyId').getAllKeys(journeyId);
    for (const key of keys) await store.delete(key);
  }

  async function readSnapshot() {
    const tx = db.transaction(stores, 'readonly');
    const [journeys, moments, songs, photos] = await Promise.all([
      tx.objectStore('journeys').getAll(),
      tx.objectStore('moments').getAll(),
      tx.objectStore('songs').getAll(),
      tx.objectStore('photos').getAll(),
    ]);
    await tx.done;
    return orderedSnapshot({ journeys, moments, songs, photos });
  }

  async function readStory(id: string, completeOnly: boolean): Promise<JourneyStory | undefined> {
    const tx = db.transaction(['journeys', 'moments', 'songs'], 'readonly');
    const journey = await tx.objectStore('journeys').get(id);
    if (!journey || (completeOnly && journey.status !== 'complete')) {
      await tx.done;
      return undefined;
    }
    const moments = await tx.objectStore('moments').index('journeyId').getAll(id);
    moments.sort((left, right) => left.sortOrder - right.sortOrder);
    const joinedMoments = await Promise.all(
      moments.map(async (moment) => {
        const song = await tx.objectStore('songs').get(moment.songReferenceId);
        if (!song) throw relationshipError(`moment ${moment.id} references missing song ${moment.songReferenceId}`);
        return { ...moment, song };
      }),
    );
    await tx.done;
    const story = { journey, moments: joinedMoments };
    if (completeOnly && !isPublishablePrivateStory(story)) return undefined;
    return story;
  }

  async function listCompleteJourneys() {
    const tx = db.transaction('journeys', 'readonly');
    const journeys = await tx.store.index('status').getAll('complete');
    await tx.done;
    const stories = await Promise.all(journeys.map(({ id }) => readStory(id, true)));
    return stories.flatMap((story) => story ? [story.journey] : []);
  }

  async function runPublicQuery<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (cause) {
      if (cause instanceof JourneyQueryError) throw cause;
      throw new JourneyQueryError('Private journey data could not be read.', undefined, { cause });
    }
  }

  async function updateJourney(
    id: string,
    patch: JourneyPatch,
    options?: { expectedUpdatedAt?: string },
  ) {
    return runWrite(async (tx) => {
      const store = tx.objectStore('journeys');
      const journey = await store.get(id);
      if (!journey) throw missingRecord('Journey', id);
      if (options?.expectedUpdatedAt !== undefined && journey.updatedAt !== options.expectedUpdatedAt) {
        throw new JourneyVersionConflictError(id, options.expectedUpdatedAt, journey.updatedAt);
      }
      if (patch.coverPhotoAssetId && !(await tx.objectStore('photos').get(patch.coverPhotoAssetId))) {
        throw relationshipError(`journey ${id} references missing photo ${patch.coverPhotoAssetId}`);
      }
      if (patch.status !== undefined && patch.status !== journey.status) {
        const isDemotion = journey.status === 'complete' && patch.status === 'review';
        if (!isDemotion) throw new JourneyStatusTransitionError(journey.status, patch.status);
      }

      let candidate: Journey = { ...journey, ...patch };
      if (journey.status === 'complete' && candidate.status === 'complete') {
        const moments = await readJoinedMoments(tx, id);
        if (!validateJourneyForReview({ journey: candidate, moments }).valid) {
          candidate = { ...candidate, status: 'review' };
        }
      }
      const updated: Journey = { ...candidate, updatedAt: nextUpdatedAt(journey.updatedAt) };
      await store.put(updated);
      return updated;
    });
  }

  return {
    async listCountrySummaries() {
      return runPublicQuery(async () => summarizeCountries(await listCompleteJourneys()));
    },

    async listJourneysByCountry(countryCode) {
      return runPublicQuery(async () => (await listCompleteJourneys())
        .filter((journey) => journey.countryCode === countryCode)
        .sort((left, right) => right.startDate.localeCompare(left.startDate)));
    },

    async getJourneyStory(journeyId) {
      return runPublicQuery(() => readStory(journeyId, true));
    },

    async listPrivateJourneys() {
      const tx = db.transaction('journeys', 'readonly');
      const journeys = await tx.store.getAll();
      await tx.done;
      return journeys.sort(compareByCreatedAtAndId);
    },

    async createJourney(input: NewJourney) {
      return runWrite(async (tx) => {
        const timestamp = new Date().toISOString();
        const journey: Journey = {
          ...input,
          id: crypto.randomUUID(),
          status: 'draft',
          createdAt: timestamp,
          updatedAt: timestamp,
          source: 'private',
        };
        await tx.objectStore('journeys').add(journey);
        return journey;
      });
    },

    async createJourneyCopy(input, sourceMoments, photos) {
      if (sourceMoments.length !== photos.length) {
        throw relationshipError('fixture moment and photo counts do not match');
      }

      return runWrite(async (tx) => {
        const existingPhotos = await tx.objectStore('photos').getAll();
        assertPhotoEnvelope([...existingPhotos, ...photos]);

        const timestamp = new Date().toISOString();
        const journey: Journey = {
          ...input,
          countryCoordinates: [...input.countryCoordinates] as [number, number],
          cityLabels: [...input.cityLabels],
          id: crypto.randomUUID(),
          status: 'draft',
          createdAt: timestamp,
          updatedAt: timestamp,
          source: 'private',
        };
        await tx.objectStore('journeys').add(journey);

        for (const [index, sourceMoment] of sourceMoments.entries()) {
          const photoId = crypto.randomUUID();
          const songId = crypto.randomUUID();
          const photo: PhotoAsset = {
            ...photos[index],
            id: photoId,
            createdAt: timestamp,
          };
          const song: SongReference = {
            ...sourceMoment.song,
            id: songId,
          };
          const moment: Moment = {
            id: crypto.randomUUID(),
            journeyId: journey.id,
            photoAssetId: photoId,
            photoAlt: sourceMoment.photoAlt,
            songReferenceId: songId,
            localDate: sourceMoment.localDate,
            localTime: sourceMoment.localTime,
            cityLabel: sourceMoment.cityLabel,
            placeLabel: sourceMoment.placeLabel,
            caption: sourceMoment.caption,
            reason: sourceMoment.reason,
            reasonStatus: sourceMoment.reasonStatus,
            sortOrder: index,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

          await tx.objectStore('photos').add(photo);
          await tx.objectStore('songs').add(song);
          await tx.objectStore('moments').add(moment);
        }

        return journey;
      });
    },

    updateJourney,

    async deleteJourney(id: string) {
      await runPrivateWrite(async (tx) => {
        const journeyStore = tx.objectStore('journeys');
        const journey = await journeyStore.get(id);
        const outboxStore = tx.objectStore('journeyAutosaveOutbox');
        const outboxKeys = await outboxStore.index('journeyId').getAllKeys(id);
        for (const key of outboxKeys) await outboxStore.delete(key);
        const momentOutboxStore = tx.objectStore('momentAutosaveOutbox');
        const momentOutboxKeys = await momentOutboxStore.index('journeyId').getAllKeys(id);
        for (const key of momentOutboxKeys) await momentOutboxStore.delete(key);
        if (!journey) return;
        const momentStore = tx.objectStore('moments');
        const journeyMoments = await momentStore.index('journeyId').getAll(id);
        const deletedIds = new Set(journeyMoments.map((moment) => moment.id));
        const retainedMoments = (await momentStore.getAll()).filter((moment) => !deletedIds.has(moment.id));
        const retainedJourneys = (await journeyStore.getAll()).filter((item) => item.id !== id);

        await journeyStore.delete(id);
        for (const moment of journeyMoments) await momentStore.delete(moment.id);

        const songStore = tx.objectStore('songs');
        const photoStore = tx.objectStore('photos');
        for (const songId of new Set(journeyMoments.map((moment) => moment.songReferenceId))) {
          if (!retainedMoments.some((moment) => moment.songReferenceId === songId)) await songStore.delete(songId);
        }
        const photoIds = [
          ...journeyMoments.flatMap((moment) => (moment.photoAssetId ? [moment.photoAssetId] : [])),
          ...(journey.coverPhotoAssetId ? [journey.coverPhotoAssetId] : []),
        ];
        for (const photoId of new Set(photoIds)) {
          const isReferenced =
            retainedMoments.some((moment) => moment.photoAssetId === photoId) ||
            retainedJourneys.some((item) => item.coverPhotoAssetId === photoId);
          if (!isReferenced) await photoStore.delete(photoId);
        }
      });
    },

    async getPrivateJourneyStory(id) {
      return readStory(id, false);
    },

    async addMoments(journeyId: string, photos: NormalizedPhotoInput[]) {
      return runWrite(async (tx) => {
        const journey = await tx.objectStore('journeys').get(journeyId);
        if (!journey) throw missingRecord('Journey', journeyId);
        const momentStore = tx.objectStore('moments');
        const existing = await momentStore.index('journeyId').getAll(journeyId);
        const existingPhotos = await tx.objectStore('photos').getAll();
        assertPhotoEnvelope([...existingPhotos, ...photos]);
        const nextSortOrder = existing.reduce((maximum, moment) => Math.max(maximum, moment.sortOrder), -1) + 1;
        const created: Moment[] = [];

        for (const [index, input] of photos.entries()) {
          const timestamp = new Date().toISOString();
          const photoId = crypto.randomUUID();
          const songId = crypto.randomUUID();
          const photo: PhotoAsset = { ...input, id: photoId, createdAt: timestamp };
          const song: SongReference = {
            id: songId,
            provider: 'manual',
            title: '',
            artist: '',
            availability: 'needs_link',
          };
          const moment: Moment = {
            id: crypto.randomUUID(),
            journeyId,
            photoAssetId: photoId,
            photoAlt: input.originalFileName,
            songReferenceId: songId,
            localDate: journey.startDate,
            cityLabel: journey.cityLabels[0] ?? '',
            placeLabel: '',
            caption: '',
            reason: '',
            reasonStatus: 'needs_review',
            sortOrder: nextSortOrder + index,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await tx.objectStore('photos').add(photo);
          await tx.objectStore('songs').add(song);
          await momentStore.add(moment);
          created.push(moment);
        }
        if (created.length > 0) await advanceJourneyStoryVersion(tx, journeyId);
        return created;
      });
    },

    async updateMoment(id: string, patch: MomentPatch, options?: UpdateMomentOptions) {
      return runWrite(async (tx) => {
        const momentStore = tx.objectStore('moments');
        const moment = await momentStore.get(id);
        if (!moment) throw missingRecord('Moment', id);
        if (options?.expectedUpdatedAt !== undefined && moment.updatedAt !== options.expectedUpdatedAt) {
          throw new MomentVersionConflictError(id, options.expectedUpdatedAt, moment.updatedAt);
        }
        const { song: songPatch, ...momentPatch } = patch;
        const updated: Moment = { ...moment, ...momentPatch, updatedAt: nextUpdatedAt(moment.updatedAt) };

        if (songPatch) {
          const songStore = tx.objectStore('songs');
          const song = await songStore.get(moment.songReferenceId);
          if (!song) throw relationshipError(`moment ${id} references missing song ${moment.songReferenceId}`);
          const nextSong: SongReference = { ...song, ...songPatch };
          if ('sourceUrl' in songPatch) {
            const sourceUrl = songPatch.sourceUrl?.trim() || undefined;
            const providerItemId = sourceUrl ? parseYouTubeVideoId(sourceUrl) : undefined;
            nextSong.sourceUrl = sourceUrl;
            nextSong.providerItemId = providerItemId;
            nextSong.provider = sourceUrl ? 'youtube' : 'manual';
            nextSong.availability = !sourceUrl ? 'needs_link' : providerItemId ? 'available' : 'invalid_link';
          }
          await songStore.put(nextSong);
        }

        await momentStore.put(updated);
        await advanceJourneyStoryVersion(tx, moment.journeyId);
        return updated;
      });
    },

    async deleteMoment(id: string) {
      await runPrivateWrite(async (tx) => {
        const momentStore = tx.objectStore('moments');
        const moment = await momentStore.get(id);
        const outboxStore = tx.objectStore('momentAutosaveOutbox');
        const outboxKeys = await outboxStore.index('momentId').getAllKeys(id);
        for (const key of outboxKeys) await outboxStore.delete(key);
        if (!moment) return;
        await momentStore.delete(id);
        const retainedMoments = await momentStore.getAll();
        if (!retainedMoments.some((item) => item.songReferenceId === moment.songReferenceId)) {
          await tx.objectStore('songs').delete(moment.songReferenceId);
        }
        if (moment.photoAssetId) {
          const journeys = await tx.objectStore('journeys').getAll();
          const isReferenced =
            retainedMoments.some((item) => item.photoAssetId === moment.photoAssetId) ||
            journeys.some((journey) => journey.coverPhotoAssetId === moment.photoAssetId);
          if (!isReferenced) await tx.objectStore('photos').delete(moment.photoAssetId);
        }
        await advanceJourneyStoryVersionInPrivateWrite(tx, moment.journeyId);
      });
    },

    async reorderMoments(journeyId: string, orderedIds: string[]) {
      const readTx = db.transaction('moments', 'readonly');
      const journeyMoments = await readTx.store.index('journeyId').getAll(journeyId);
      await readTx.done;
      assertExactReorderSet(journeyId, journeyMoments, orderedIds);

      await runWrite(async (tx) => {
        const momentStore = tx.objectStore('moments');
        const currentJourneyMoments = await momentStore.index('journeyId').getAll(journeyId);
        assertExactReorderSet(journeyId, currentJourneyMoments, orderedIds);
        const momentsById = new Map(currentJourneyMoments.map((moment) => [moment.id, moment]));
        for (const [sortOrder, id] of orderedIds.entries()) {
          const moment = momentsById.get(id)!;
          await momentStore.put({
            ...moment,
            sortOrder,
            updatedAt: nextUpdatedAt(moment.updatedAt),
          });
        }
        await advanceJourneyStoryVersion(tx, journeyId);
      });
    },

    async setJourneyStatus(id: string, status: JourneyStatus, options: SetJourneyStatusOptions) {
      return runWrite(async (tx) => {
        const journeyStore = tx.objectStore('journeys');
        const journey = await journeyStore.get(id);
        if (!journey) throw missingRecord('Journey', id);
        const expectedUpdatedAt = options?.expectedUpdatedAt;
        if (
          typeof expectedUpdatedAt !== 'string' ||
          expectedUpdatedAt.trim() === '' ||
          journey.updatedAt !== expectedUpdatedAt
        ) {
          throw new JourneyVersionConflictError(
            id,
            typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : '',
            journey.updatedAt,
          );
        }
        if (status === journey.status) return journey;

        const isForwardTransition =
          (journey.status === 'draft' && status === 'review') ||
          (journey.status === 'review' && status === 'complete');
        if (!isForwardTransition) throw new JourneyStatusTransitionError(journey.status, status);

        const moments = await readJoinedMoments(tx, id);
        const validation = validateJourneyForReview({ journey, moments });
        if (!validation.valid) throw new JourneyValidationError(validation.issues);

        const updated: Journey = {
          ...journey,
          status,
          updatedAt: nextUpdatedAt(journey.updatedAt),
        };
        await journeyStore.put(updated);
        return updated;
      });
    },

    async get(journeyId: string, ownerId: string) {
      return runOutboxWrite(async (tx) => {
        if (!(await tx.objectStore('journeys').get(journeyId))) {
          await deleteJourneyOutboxes(tx, journeyId);
          return undefined;
        }
        return tx.objectStore('journeyAutosaveOutbox').get([journeyId, ownerId]);
      });
    },

    async listByJourney(journeyId: string) {
      return runOutboxWrite(async (tx) => {
        if (!(await tx.objectStore('journeys').get(journeyId))) {
          await deleteJourneyOutboxes(tx, journeyId);
          return [];
        }
        const records = await tx.objectStore('journeyAutosaveOutbox').index('journeyId').getAll(journeyId);
        return records.sort((left, right) => left.ownerId.localeCompare(right.ownerId));
      });
    },

    async adopt(
      journeyId: string,
      fromOwnerId: string,
      toOwnerId: string,
      expectedGeneration: string,
    ) {
      return runOutboxWrite(async (tx) => {
        if (!(await tx.objectStore('journeys').get(journeyId))) {
          await deleteJourneyOutboxes(tx, journeyId);
          return undefined;
        }
        const store = tx.objectStore('journeyAutosaveOutbox');
        const exact = await store.get([journeyId, toOwnerId]);
        if (exact) return exact;

        const source = await store.get([journeyId, fromOwnerId]);
        if (!source || source.generation !== expectedGeneration) return undefined;

        const adopted = { ...source, ownerId: toOwnerId };
        await store.delete([journeyId, fromOwnerId]);
        await store.put(adopted);
        return adopted;
      });
    },

    async put(record: JourneyAutosaveOutboxRecord) {
      await runOutboxWrite(async (tx) => {
        if (!(await tx.objectStore('journeys').get(record.journeyId))) {
          throw missingRecord('Journey', record.journeyId);
        }
        await tx.objectStore('journeyAutosaveOutbox').put(record);
      });
    },

    async compareAndDelete(journeyId: string, ownerId: string, generation: string) {
      return runOutboxWrite(async (tx) => {
        const key: [string, string] = [journeyId, ownerId];
        const store = tx.objectStore('journeyAutosaveOutbox');
        const stored = await store.get(key);
        if (!stored || stored.generation !== generation) return false;
        await store.delete(key);
        return true;
      });
    },

    async getMomentOutbox(momentId: string, ownerId: string) {
      return runMomentOutboxWrite(async (tx) => {
        const store = tx.objectStore('momentAutosaveOutbox');
        const key: [string, string] = [momentId, ownerId];
        const moment = await tx.objectStore('moments').get(momentId);
        if (!moment) {
          await deleteMomentOutboxesByMoment(tx, momentId);
          return undefined;
        }
        const record = await store.get(key);
        if (record && record.journeyId !== moment.journeyId) {
          await store.delete(key);
          return undefined;
        }
        return record;
      });
    },

    async listMomentOutboxesByJourney(journeyId: string) {
      return runMomentOutboxWrite(async (tx) => {
        if (!(await tx.objectStore('journeys').get(journeyId))) {
          await deleteMomentOutboxesByJourney(tx, journeyId);
          return [];
        }
        const store = tx.objectStore('momentAutosaveOutbox');
        const records = await store.index('journeyId').getAll(journeyId);
        const retained: MomentAutosaveOutboxRecord[] = [];
        for (const record of records) {
          const parent = await tx.objectStore('moments').get(record.momentId);
          if (!parent || parent.journeyId !== journeyId) {
            await store.delete([record.momentId, record.ownerId]);
          } else {
            retained.push(record);
          }
        }
        return retained.sort((left, right) => (
          left.momentId.localeCompare(right.momentId) || left.ownerId.localeCompare(right.ownerId)
        ));
      });
    },

    async adoptMomentOutbox(
      momentId: string,
      journeyId: string,
      fromOwnerId: string,
      toOwnerId: string,
      expectedGeneration: string,
    ) {
      return runMomentOutboxWrite(async (tx) => {
        const moment = await tx.objectStore('moments').get(momentId);
        if (!moment || moment.journeyId !== journeyId) {
          if (!moment) await deleteMomentOutboxesByMoment(tx, momentId);
          return undefined;
        }

        const store = tx.objectStore('momentAutosaveOutbox');
        const targetKey: [string, string] = [momentId, toOwnerId];
        const exact = await store.get(targetKey);
        if (exact?.journeyId === journeyId) return exact;
        if (exact) await store.delete(targetKey);

        const sourceKey: [string, string] = [momentId, fromOwnerId];
        const source = await store.get(sourceKey);
        if (
          !source ||
          source.journeyId !== journeyId ||
          source.generation !== expectedGeneration
        ) return undefined;

        const adopted = { ...source, ownerId: toOwnerId };
        await store.delete(sourceKey);
        await store.put(adopted);
        return adopted;
      });
    },

    async putMomentOutbox(record: MomentAutosaveOutboxRecord) {
      await runMomentOutboxWrite(async (tx) => {
        const moment = await tx.objectStore('moments').get(record.momentId);
        if (!moment) throw missingRecord('Moment', record.momentId);
        if (moment.journeyId !== record.journeyId) {
          throw relationshipError(`moment recovery ${record.momentId} references the wrong journey`);
        }
        await tx.objectStore('momentAutosaveOutbox').put(record);
      });
    },

    async compareAndDeleteMomentOutbox(momentId: string, ownerId: string, generation: string) {
      return runMomentOutboxWrite(async (tx) => {
        const key: [string, string] = [momentId, ownerId];
        const store = tx.objectStore('momentAutosaveOutbox');
        const stored = await store.get(key);
        if (!stored || stored.generation !== generation) return false;
        await store.delete(key);
        return true;
      });
    },

    async getPhotoAsset(id) {
      const tx = db.transaction('photos', 'readonly');
      const photo = await tx.store.get(id);
      await tx.done;
      return photo;
    },

    async exportSnapshot() {
      return readSnapshot();
    },

    async importSnapshot(snapshot: PrivateJourneySnapshot, expectedKeys: PrivateDataPrimaryKeys) {
      assertSnapshotSemantics(snapshot);
      assertPhotoEnvelope(snapshot.photos);
      await runWrite(async (tx) => {
        const journeyIds = assertUniqueIds('journey', snapshot.journeys);
        assertUniqueIds('moment', snapshot.moments);
        const songIds = assertUniqueIds('song', snapshot.songs);
        const photoIds = assertUniqueIds('photo', snapshot.photos);

        await assertTargetKeysUnchanged(tx, expectedKeys);
        const existingPhotos = await tx.objectStore('photos').getAll();
        assertPhotoEnvelope([...existingPhotos, ...snapshot.photos]);
        for (const photo of snapshot.photos) await tx.objectStore('photos').add(photo);
        for (const song of snapshot.songs) await tx.objectStore('songs').add(song);
        for (const journey of snapshot.journeys) {
          if (journey.source !== 'private') throw relationshipError(`journey ${journey.id} is not private`);
          if (journey.coverPhotoAssetId && !photoIds.has(journey.coverPhotoAssetId)) {
            throw relationshipError(`journey ${journey.id} references missing photo ${journey.coverPhotoAssetId}`);
          }
          await tx.objectStore('journeys').add(journey);
        }
        for (const moment of snapshot.moments) {
          if (moment.photoUrl !== undefined) {
            throw relationshipError(`private moment ${moment.id} must not contain photoUrl`);
          }
          if (!journeyIds.has(moment.journeyId)) {
            throw relationshipError(`moment ${moment.id} references missing journey ${moment.journeyId}`);
          }
          if (!songIds.has(moment.songReferenceId)) {
            throw relationshipError(`moment ${moment.id} references missing song ${moment.songReferenceId}`);
          }
          if (!moment.photoAssetId || !photoIds.has(moment.photoAssetId)) {
            throw relationshipError(`moment ${moment.id} references a missing photo`);
          }
          await tx.objectStore('moments').add(moment);
        }
      });
    },

    async clearPrivateData() {
      const tx = db.transaction(privateStores, 'readwrite');
      try {
        for (const storeName of privateStores) await tx.objectStore(storeName).clear();
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // A failed IndexedDB request may have already aborted the transaction.
        }
        try {
          await tx.done;
        } catch {
          // Preserve the operation error, which carries more detail than AbortError.
        }
        if (isQuotaExceededError(error)) throw new StorageCapacityError(error);
        throw error;
      }
    },
  };
}
