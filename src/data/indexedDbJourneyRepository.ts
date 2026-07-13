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
import { parseYouTubeVideoId } from '../domain/youtube';
import type {
  JourneyEditorRepository,
  JourneyRepository,
  PhotoAssetRepository,
  PrivateDataPort,
} from './ports';
import type { SoundPassportDb } from './indexedDb';

const stores = ['journeys', 'moments', 'songs', 'photos'] as const;
type WriteTransaction = IDBPTransaction<SoundPassportDb, typeof stores, 'readwrite'>;

export interface IndexedDbJourneyRepository
  extends JourneyRepository, JourneyEditorRepository, PhotoAssetRepository, PrivateDataPort {}

export interface IndexedDbJourneyRepositoryOptions {
  db: IDBPDatabase<SoundPassportDb>;
}

export class StorageCapacityError extends Error {
  constructor(cause: unknown) {
    super('Sound Passport does not have enough local storage capacity.', { cause });
    this.name = 'StorageCapacityError';
  }
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

function assertExactReorderSet(journeyMoments: Moment[], orderedIds: string[]) {
  const expectedIds = new Set(journeyMoments.map((moment) => moment.id));
  const submittedIds = new Set(orderedIds);
  const isExactSet =
    expectedIds.size === orderedIds.length &&
    submittedIds.size === orderedIds.length &&
    orderedIds.every((id) => expectedIds.has(id));
  if (!isExactSet) throw new Error('Reorder IDs must exactly match the journey moments.');
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
    return { journey, moments: joinedMoments };
  }

  async function listCompleteJourneys() {
    const tx = db.transaction('journeys', 'readonly');
    const journeys = await tx.store.index('status').getAll('complete');
    await tx.done;
    return journeys;
  }

  async function updateJourney(id: string, patch: JourneyPatch) {
    return runWrite(async (tx) => {
      const store = tx.objectStore('journeys');
      const journey = await store.get(id);
      if (!journey) throw missingRecord('Journey', id);
      if (patch.coverPhotoAssetId && !(await tx.objectStore('photos').get(patch.coverPhotoAssetId))) {
        throw relationshipError(`journey ${id} references missing photo ${patch.coverPhotoAssetId}`);
      }
      const updated: Journey = { ...journey, ...patch, updatedAt: new Date().toISOString() };
      await store.put(updated);
      return updated;
    });
  }

  return {
    async listCountrySummaries() {
      return summarizeCountries(await listCompleteJourneys());
    },

    async listJourneysByCountry(countryCode) {
      return (await listCompleteJourneys())
        .filter((journey) => journey.countryCode === countryCode)
        .sort((left, right) => right.startDate.localeCompare(left.startDate));
    },

    async getJourneyStory(journeyId) {
      return readStory(journeyId, true);
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

    updateJourney,

    async deleteJourney(id: string) {
      await runWrite(async (tx) => {
        const journeyStore = tx.objectStore('journeys');
        const journey = await journeyStore.get(id);
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
        return created;
      });
    },

    async updateMoment(id: string, patch: MomentPatch) {
      return runWrite(async (tx) => {
        const momentStore = tx.objectStore('moments');
        const moment = await momentStore.get(id);
        if (!moment) throw missingRecord('Moment', id);
        const { song: songPatch, ...momentPatch } = patch;
        const updated: Moment = { ...moment, ...momentPatch, updatedAt: new Date().toISOString() };

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
        return updated;
      });
    },

    async deleteMoment(id: string) {
      await runWrite(async (tx) => {
        const momentStore = tx.objectStore('moments');
        const moment = await momentStore.get(id);
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
      });
    },

    async reorderMoments(journeyId: string, orderedIds: string[]) {
      const readTx = db.transaction('moments', 'readonly');
      const journeyMoments = await readTx.store.index('journeyId').getAll(journeyId);
      await readTx.done;
      assertExactReorderSet(journeyMoments, orderedIds);

      await runWrite(async (tx) => {
        const momentStore = tx.objectStore('moments');
        const currentJourneyMoments = await momentStore.index('journeyId').getAll(journeyId);
        assertExactReorderSet(currentJourneyMoments, orderedIds);
        const momentsById = new Map(currentJourneyMoments.map((moment) => [moment.id, moment]));
        const timestamp = new Date().toISOString();
        for (const [sortOrder, id] of orderedIds.entries()) {
          const moment = momentsById.get(id)!;
          await momentStore.put({ ...moment, sortOrder, updatedAt: timestamp });
        }
      });
    },

    async setJourneyStatus(id: string, status: JourneyStatus) {
      return updateJourney(id, { status });
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

    async importSnapshot(snapshot: PrivateJourneySnapshot) {
      await runWrite(async (tx) => {
        const journeyIds = assertUniqueIds('journey', snapshot.journeys);
        assertUniqueIds('moment', snapshot.moments);
        const songIds = assertUniqueIds('song', snapshot.songs);
        const photoIds = assertUniqueIds('photo', snapshot.photos);

        for (const storeName of stores) await tx.objectStore(storeName).clear();
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
      await runWrite(async (tx) => {
        for (const storeName of stores) await tx.objectStore(storeName).clear();
      });
    },
  };
}
