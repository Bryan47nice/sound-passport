import type {
  Journey,
  JourneyStory,
  Moment,
  PrivateJourneySnapshot,
  SongReference,
} from './model';
import { validateJourneyForReview } from './journeyValidation';
import {
  hasValidCoordinates,
  isCanonicalRouteId,
  isCanonicalTimestamp,
  isStrictLocalDate,
  isStrictLocalTime,
} from './semanticValidation';

export type SnapshotSemanticErrorKind = 'invalid' | 'relationship';

export class SnapshotSemanticError extends Error {
  constructor(readonly kind: SnapshotSemanticErrorKind, message: string) {
    super(message);
    this.name = 'SnapshotSemanticError';
  }
}

function invalid(message: string): never {
  throw new SnapshotSemanticError('invalid', message);
}

function relationship(message: string): never {
  throw new SnapshotSemanticError('relationship', message);
}

function uniqueIds(label: string, values: Array<{ id: string }>): Set<string> {
  const ids = values.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) relationship(`${label} IDs must be unique.`);
  return new Set(ids);
}

function assertCanonicalId(value: string, label: string) {
  if (!isCanonicalRouteId(value)) invalid(`${label} is not canonical or route-safe.`);
}

function assertJourneySemantics(journey: Journey) {
  assertCanonicalId(journey.id, `Journey ID ${journey.id}`);
  if (journey.source !== 'private') relationship(`Journey ${journey.id} is not private.`);
  if (!['draft', 'review', 'complete'].includes(journey.status)) {
    invalid(`Journey ${journey.id} has an unsupported status.`);
  }
  if (!isStrictLocalDate(journey.startDate) || !isStrictLocalDate(journey.endDate)) {
    invalid(`Journey ${journey.id} has an invalid local date.`);
  }
  if (journey.startDate > journey.endDate) relationship(`Journey ${journey.id} has an invalid date range.`);
  if (!hasValidCoordinates(journey.countryCoordinates)) {
    invalid(`Journey ${journey.id} has invalid coordinates.`);
  }
  if (!isCanonicalTimestamp(journey.createdAt) || !isCanonicalTimestamp(journey.updatedAt)) {
    invalid(`Journey ${journey.id} has a noncanonical timestamp.`);
  }
  if (journey.createdAt > journey.updatedAt) relationship(`Journey ${journey.id} has an invalid lifecycle.`);
  if (journey.coverPhotoAssetId) {
    assertCanonicalId(journey.coverPhotoAssetId, `Journey ${journey.id} cover photo ID`);
  }
}

function assertSongSemantics(song: SongReference) {
  assertCanonicalId(song.id, `Song ID ${song.id}`);
  if (!['youtube', 'manual'].includes(song.provider)) invalid(`Song ${song.id} has an unsupported provider.`);
  if (!['available', 'invalid_link', 'needs_link'].includes(song.availability)) {
    invalid(`Song ${song.id} has an unsupported availability status.`);
  }
}

function assertMomentSemantics(moment: Moment, journey: Journey) {
  assertCanonicalId(moment.id, `Moment ID ${moment.id}`);
  assertCanonicalId(moment.journeyId, `Moment ${moment.id} journey ID`);
  assertCanonicalId(moment.songReferenceId, `Moment ${moment.id} song ID`);
  if (moment.photoAssetId) assertCanonicalId(moment.photoAssetId, `Moment ${moment.id} photo ID`);
  if (!['complete', 'needs_review'].includes(moment.reasonStatus)) {
    invalid(`Moment ${moment.id} has an unsupported reason status.`);
  }
  if (!Number.isInteger(moment.sortOrder) || moment.sortOrder < 0) {
    invalid(`Moment ${moment.id} has an invalid sort order.`);
  }
  if (!isStrictLocalDate(moment.localDate) || (moment.localTime !== undefined && !isStrictLocalTime(moment.localTime))) {
    invalid(`Moment ${moment.id} has an invalid local date or time.`);
  }
  if (!isCanonicalTimestamp(moment.createdAt) || !isCanonicalTimestamp(moment.updatedAt)) {
    invalid(`Moment ${moment.id} has a noncanonical timestamp.`);
  }
  if (moment.createdAt > moment.updatedAt
    || moment.createdAt < journey.createdAt
    || moment.updatedAt > journey.updatedAt) {
    relationship(`Moment ${moment.id} has an invalid joined lifecycle.`);
  }
  if (moment.localDate < journey.startDate || moment.localDate > journey.endDate) {
    relationship(`Moment ${moment.id} falls outside its journey date range.`);
  }
  if (moment.photoUrl !== undefined) relationship(`Private moment ${moment.id} must not contain photoUrl.`);
  if (!moment.photoAssetId) relationship(`Moment ${moment.id} references a missing photo.`);
}

export function assertPrivateJourneyStorySemantics(story: JourneyStory): void {
  const { journey, moments } = story;
  assertJourneySemantics(journey);
  uniqueIds('Moment', moments);
  const orderKeys = new Set<number>();
  for (const moment of moments) {
    if (moment.journeyId !== journey.id) relationship(`Moment ${moment.id} references the wrong journey.`);
    if (moment.songReferenceId !== moment.song.id) relationship(`Moment ${moment.id} references the wrong song.`);
    assertMomentSemantics(moment, journey);
    assertSongSemantics(moment.song);
    if (orderKeys.has(moment.sortOrder)) relationship(`Journey ${journey.id} has duplicate moment order.`);
    orderKeys.add(moment.sortOrder);
  }
}

export function assertPrivateSnapshotSemantics(snapshot: PrivateJourneySnapshot): void {
  const journeyIds = uniqueIds('Journey', snapshot.journeys);
  uniqueIds('Moment', snapshot.moments);
  const songIds = uniqueIds('Song', snapshot.songs);
  const photoIds = uniqueIds('Photo', snapshot.photos);
  const journeys = new Map(snapshot.journeys.map((journey) => [journey.id, journey]));
  const songs = new Map(snapshot.songs.map((song) => [song.id, song]));
  const orderKeys = new Set<string>();

  for (const journey of snapshot.journeys) {
    assertJourneySemantics(journey);
    if (journey.coverPhotoAssetId && !photoIds.has(journey.coverPhotoAssetId)) {
      relationship(`Journey ${journey.id} references a missing cover photo.`);
    }
  }

  for (const photo of snapshot.photos) {
    assertCanonicalId(photo.id, `Photo ID ${photo.id}`);
    if (!isCanonicalTimestamp(photo.createdAt)) invalid(`Photo ${photo.id} has a noncanonical timestamp.`);
  }

  for (const song of snapshot.songs) assertSongSemantics(song);

  for (const moment of snapshot.moments) {
    const journey = journeys.get(moment.journeyId);
    if (!journeyIds.has(moment.journeyId) || !journey) {
      relationship(`Moment ${moment.id} references a missing journey.`);
    }
    if (!songIds.has(moment.songReferenceId)) relationship(`Moment ${moment.id} references a missing song.`);
    if (moment.photoUrl !== undefined) relationship(`Private moment ${moment.id} must not contain photoUrl.`);
    if (!moment.photoAssetId || !photoIds.has(moment.photoAssetId)) {
      relationship(`Moment ${moment.id} references a missing photo.`);
    }
    assertMomentSemantics(moment, journey);
    const orderKey = `${moment.journeyId}\u0000${moment.sortOrder}`;
    if (orderKeys.has(orderKey)) relationship(`Journey ${moment.journeyId} has duplicate moment order.`);
    orderKeys.add(orderKey);
  }

  for (const journey of snapshot.journeys.filter(({ status }) => status === 'complete')) {
    const moments = snapshot.moments
      .filter(({ journeyId }) => journeyId === journey.id)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((moment) => ({ ...moment, song: songs.get(moment.songReferenceId)! }));
    const story: JourneyStory = { journey, moments };
    if (!isPublishablePrivateStory(story)) {
      relationship(`Completed journey ${journey.id} does not satisfy publication requirements.`);
    }
  }
}

export function isPublishablePrivateStory(story: JourneyStory): boolean {
  if (story.journey.status !== 'complete') return false;
  try {
    assertPrivateJourneyStorySemantics(story);
  } catch (error) {
    if (error instanceof SnapshotSemanticError) return false;
    throw error;
  }
  return validateJourneyForReview(story).valid;
}
