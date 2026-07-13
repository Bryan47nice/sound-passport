import type { Journey, Moment, PhotoAsset, SongReference } from '../domain/model';

export const BACKUP_FORMAT = 'sound-passport';
export const BACKUP_SCHEMA_VERSION = 1;

export const BACKUP_ERROR_CODES = [
  'invalid_container',
  'unsupported_version',
  'invalid_manifest',
  'missing_photo',
  'checksum_mismatch',
  'relationship_error',
  'stale_plan',
  'limit_exceeded',
] as const;

export type BackupErrorCode = typeof BACKUP_ERROR_CODES[number];

export class BackupError extends Error {
  constructor(public readonly code: BackupErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BackupError';
  }
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  appVersion: string;
  journeys: Journey[];
  moments: Moment[];
  songs: SongReference[];
  photos: Array<Omit<PhotoAsset, 'blob'> & { path: string; sha256: string }>;
}

type JsonRecord = Record<string, unknown>;

function invalid(detail: string): never {
  throw new BackupError('invalid_manifest', `Invalid backup manifest: ${detail}.`);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is JsonRecord {
  if (!isRecord(value)) invalid(`${label} must be an object`);
}

function assertShape(value: JsonRecord, required: string[], optional: string[], label: string) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value))) invalid(`${label} is missing a required field`);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid(`${label} has an unknown field`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (value.length === 0) invalid(`${label} must not be empty`);
}

function assertOptionalString(value: unknown, label: string): asserts value is string | undefined {
  if (value !== undefined) assertString(value, label);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be a finite number`);
}

function assertInteger(value: unknown, label: string, minimum: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    invalid(`${label} must be an integer greater than or equal to ${minimum}`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid(`${label} must be an array of strings`);
  }
}

function assertEnum<const Value extends string>(value: unknown, allowed: readonly Value[], label: string): asserts value is Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) invalid(`${label} is not supported`);
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (!Number.isFinite(Date.parse(value))) invalid(`${label} must be a timestamp`);
}

function validateJourney(value: unknown, index: number) {
  const label = `journeys[${index}]`;
  assertRecord(value, label);
  assertShape(value, [
    'id', 'title', 'countryCode', 'countryName', 'countryCoordinates', 'cityLabels',
    'startDate', 'endDate', 'summary', 'status', 'createdAt', 'updatedAt', 'source',
  ], ['coverPhotoAssetId'], label);
  assertNonEmptyString(value.id, `${label}.id`);
  ['title', 'countryCode', 'countryName', 'startDate', 'endDate', 'summary'].forEach((key) =>
    assertString(value[key], `${label}.${key}`));
  if (!Array.isArray(value.countryCoordinates) || value.countryCoordinates.length !== 2) {
    invalid(`${label}.countryCoordinates must be a coordinate tuple`);
  }
  value.countryCoordinates.forEach((coordinate, coordinateIndex) =>
    assertFiniteNumber(coordinate, `${label}.countryCoordinates[${coordinateIndex}]`));
  assertStringArray(value.cityLabels, `${label}.cityLabels`);
  assertOptionalString(value.coverPhotoAssetId, `${label}.coverPhotoAssetId`);
  assertEnum(value.status, ['draft', 'review', 'complete'], `${label}.status`);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
  assertTimestamp(value.updatedAt, `${label}.updatedAt`);
  assertEnum(value.source, ['private'], `${label}.source`);
}

function validateMoment(value: unknown, index: number) {
  const label = `moments[${index}]`;
  assertRecord(value, label);
  assertShape(value, [
    'id', 'journeyId', 'photoAssetId', 'photoAlt', 'songReferenceId', 'localDate', 'cityLabel',
    'placeLabel', 'caption', 'reason', 'reasonStatus', 'sortOrder', 'createdAt', 'updatedAt',
  ], ['localTime'], label);
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.journeyId, `${label}.journeyId`);
  assertNonEmptyString(value.photoAssetId, `${label}.photoAssetId`);
  assertNonEmptyString(value.songReferenceId, `${label}.songReferenceId`);
  ['photoAlt', 'localDate', 'cityLabel', 'placeLabel', 'caption', 'reason'].forEach((key) =>
    assertString(value[key], `${label}.${key}`));
  assertOptionalString(value.localTime, `${label}.localTime`);
  assertEnum(value.reasonStatus, ['complete', 'needs_review'], `${label}.reasonStatus`);
  assertInteger(value.sortOrder, `${label}.sortOrder`, 0);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
  assertTimestamp(value.updatedAt, `${label}.updatedAt`);
}

function validateSong(value: unknown, index: number) {
  const label = `songs[${index}]`;
  assertRecord(value, label);
  assertShape(value, ['id', 'provider', 'title', 'artist', 'availability'], ['providerItemId', 'sourceUrl'], label);
  assertNonEmptyString(value.id, `${label}.id`);
  assertEnum(value.provider, ['youtube', 'manual'], `${label}.provider`);
  assertOptionalString(value.providerItemId, `${label}.providerItemId`);
  assertOptionalString(value.sourceUrl, `${label}.sourceUrl`);
  assertString(value.title, `${label}.title`);
  assertString(value.artist, `${label}.artist`);
  assertEnum(value.availability, ['available', 'invalid_link', 'needs_link'], `${label}.availability`);
}

function validatePhoto(value: unknown, index: number) {
  const label = `photos[${index}]`;
  assertRecord(value, label);
  assertShape(value, [
    'id', 'contentType', 'originalFileName', 'width', 'height', 'byteSize', 'createdAt', 'path', 'sha256',
  ], [], label);
  assertNonEmptyString(value.id, `${label}.id`);
  assertEnum(value.contentType, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'], `${label}.contentType`);
  assertString(value.originalFileName, `${label}.originalFileName`);
  assertInteger(value.width, `${label}.width`, 1);
  assertInteger(value.height, `${label}.height`, 1);
  assertInteger(value.byteSize, `${label}.byteSize`, 0);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
  assertString(value.path, `${label}.path`);
  if (!/^photos\/[^/\\]+$/.test(value.path)) invalid(`${label}.path must name one file under photos/`);
  assertString(value.sha256, `${label}.sha256`);
  if (!/^[0-9a-f]{64}$/.test(value.sha256)) invalid(`${label}.sha256 must be lowercase SHA-256 hexadecimal`);
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
}

export function parseBackupManifest(value: unknown): BackupManifest {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
    throw new BackupError('invalid_container', 'The file is not a Sound Passport backup.');
  }
  if (typeof value.schemaVersion === 'number' && value.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new BackupError('unsupported_version', `Backup schema version ${value.schemaVersion} is not supported.`);
  }

  assertShape(value, [
    'format', 'schemaVersion', 'exportedAt', 'appVersion', 'journeys', 'moments', 'songs', 'photos',
  ], [], 'manifest');
  if (value.schemaVersion !== BACKUP_SCHEMA_VERSION) invalid('schemaVersion must be a supported number');
  assertTimestamp(value.exportedAt, 'manifest.exportedAt');
  assertNonEmptyString(value.appVersion, 'manifest.appVersion');
  assertArray(value.journeys, 'manifest.journeys');
  assertArray(value.moments, 'manifest.moments');
  assertArray(value.songs, 'manifest.songs');
  assertArray(value.photos, 'manifest.photos');
  value.journeys.forEach(validateJourney);
  value.moments.forEach(validateMoment);
  value.songs.forEach(validateSong);
  value.photos.forEach(validatePhoto);

  const photoPaths = value.photos.map((photo) => (photo as JsonRecord).path);
  if (new Set(photoPaths).size !== photoPaths.length) invalid('photo paths must be unique');
  return value as unknown as BackupManifest;
}
