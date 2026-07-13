import { strFromU8, strToU8, unzip, zip, type AsyncZippable } from 'fflate';
import packageMetadata from '../../package.json';
import {
  PrivateDataStateConflictError,
  type PrivateDataPort,
  type PrivateDataPrimaryKeys,
} from '../data/ports';
import type { PhotoAsset, PrivateJourneySnapshot } from '../domain/model';
import { inspectPhoto, type PhotoInspector } from '../media/photoInspector';
import { BACKUP_LIMITS } from './backupLimits';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BackupError,
  parseBackupManifest,
  type BackupManifest,
} from './backupManifest';
import { assertBackupContainerSize, assertExtractedZip, preflightZip } from './zipPreflight';

export const BACKUP_MEDIA_TYPE = 'application/vnd.sound-passport.backup';
export { BACKUP_LIMITS } from './backupLimits';

export interface ImportSummary {
  journeys: number;
  moments: number;
  photos: number;
}

export interface ImportPlan {
  readonly summary: ImportSummary;
  readonly snapshot: PrivateJourneySnapshot;
  readonly remapped: boolean;
}

export interface ImportResult {
  readonly summary: ImportSummary;
}

export interface BackupServiceOptions {
  appVersion?: string;
  now?: () => Date;
  photoInspector?: PhotoInspector;
}

interface ValidatedPlan {
  snapshot: PrivateJourneySnapshot;
  summary: ImportSummary;
  epoch: number;
  expectedKeys: PrivateDataPrimaryKeys;
}

const extensionsByContentType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, files) => error ? reject(error) : resolve(files));
  });
}

function bytesForBlob(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytesForBlob(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function sniffContentType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 4))) return 'image/avif';
  return undefined;
}

function expectedPhotoPath(photo: Pick<PhotoAsset, 'id' | 'contentType'>) {
  const extension = extensionsByContentType[photo.contentType];
  if (!extension) throw new BackupError('invalid_manifest', 'A photo has an unsupported content type.');
  return `photos/${encodeURIComponent(photo.id)}.${extension}`;
}

function assertUniqueIds(label: string, values: Array<{ id: string }>) {
  const ids = values.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new BackupError('relationship_error', `Backup ${label} IDs must be unique.`);
  }
  return new Set(ids);
}

function validateRelationships(snapshot: PrivateJourneySnapshot) {
  const journeyIds = assertUniqueIds('journey', snapshot.journeys);
  assertUniqueIds('moment', snapshot.moments);
  const songIds = assertUniqueIds('song', snapshot.songs);
  const photoIds = assertUniqueIds('photo', snapshot.photos);

  for (const journey of snapshot.journeys) {
    if (journey.coverPhotoAssetId && !photoIds.has(journey.coverPhotoAssetId)) {
      throw new BackupError('relationship_error', 'A journey references a missing cover photo.');
    }
  }
  for (const moment of snapshot.moments) {
    if (!journeyIds.has(moment.journeyId)) {
      throw new BackupError('relationship_error', 'A moment references a missing journey.');
    }
    if (!songIds.has(moment.songReferenceId)) {
      throw new BackupError('relationship_error', 'A moment references a missing song.');
    }
    if (moment.photoUrl !== undefined) {
      throw new BackupError('relationship_error', 'A private moment must not contain photoUrl.');
    }
    if (!moment.photoAssetId || !photoIds.has(moment.photoAssetId)) {
      throw new BackupError('relationship_error', 'A moment references a missing photo.');
    }
  }
}

function cloneSnapshot(snapshot: PrivateJourneySnapshot): PrivateJourneySnapshot {
  return {
    journeys: snapshot.journeys.map((journey) => ({
      ...journey,
      countryCoordinates: [...journey.countryCoordinates] as [number, number],
      cityLabels: [...journey.cityLabels],
    })),
    moments: snapshot.moments.map((moment) => ({ ...moment })),
    songs: snapshot.songs.map((song) => ({ ...song })),
    photos: snapshot.photos.map((photo) => ({ ...photo })),
  };
}

function freezeSnapshot(snapshot: PrivateJourneySnapshot) {
  snapshot.journeys.forEach((journey) => {
    Object.freeze(journey.countryCoordinates);
    Object.freeze(journey.cityLabels);
    Object.freeze(journey);
  });
  snapshot.moments.forEach(Object.freeze);
  snapshot.songs.forEach(Object.freeze);
  snapshot.photos.forEach(Object.freeze);
  Object.values(snapshot).forEach(Object.freeze);
  return Object.freeze(snapshot);
}

function hasCollision(incoming: PrivateJourneySnapshot, existing: PrivateJourneySnapshot) {
  const collides = <T extends { id: string }>(left: T[], right: T[]) => {
    const ids = new Set(right.map(({ id }) => id));
    return left.some(({ id }) => ids.has(id));
  };
  return collides(incoming.journeys, existing.journeys)
    || collides(incoming.moments, existing.moments)
    || collides(incoming.songs, existing.songs)
    || collides(incoming.photos, existing.photos);
}

function createIdMap(values: Array<{ id: string }>, existing: Array<{ id: string }>) {
  const reserved = new Set([...values, ...existing].map(({ id }) => id));
  const result = new Map<string, string>();
  for (const { id } of values) {
    let suffix = 1;
    let candidate = `${id}~import-${suffix}`;
    while (reserved.has(candidate)) candidate = `${id}~import-${++suffix}`;
    reserved.add(candidate);
    result.set(id, candidate);
  }
  return result;
}

function remapSnapshot(snapshot: PrivateJourneySnapshot, existing: PrivateJourneySnapshot) {
  const journeyIds = createIdMap(snapshot.journeys, existing.journeys);
  const momentIds = createIdMap(snapshot.moments, existing.moments);
  const songIds = createIdMap(snapshot.songs, existing.songs);
  const photoIds = createIdMap(snapshot.photos, existing.photos);
  const required = (ids: Map<string, string>, id: string) => ids.get(id)!;

  return {
    journeys: snapshot.journeys.map((journey) => ({
      ...journey,
      id: required(journeyIds, journey.id),
      coverPhotoAssetId: journey.coverPhotoAssetId ? required(photoIds, journey.coverPhotoAssetId) : undefined,
    })),
    moments: snapshot.moments.map((moment) => ({
      ...moment,
      id: required(momentIds, moment.id),
      journeyId: required(journeyIds, moment.journeyId),
      songReferenceId: required(songIds, moment.songReferenceId),
      photoAssetId: moment.photoAssetId ? required(photoIds, moment.photoAssetId) : undefined,
    })),
    songs: snapshot.songs.map((song) => ({ ...song, id: required(songIds, song.id) })),
    photos: snapshot.photos.map((photo) => ({ ...photo, id: required(photoIds, photo.id) })),
  } satisfies PrivateJourneySnapshot;
}

function summaryFor(snapshot: PrivateJourneySnapshot): ImportSummary {
  return {
    journeys: snapshot.journeys.length,
    moments: snapshot.moments.length,
    photos: snapshot.photos.length,
  };
}

function primaryKeys(snapshot: PrivateJourneySnapshot): PrivateDataPrimaryKeys {
  return {
    journeys: snapshot.journeys.map(({ id }) => id).sort(),
    moments: snapshot.moments.map(({ id }) => id).sort(),
    songs: snapshot.songs.map(({ id }) => id).sort(),
    photos: snapshot.photos.map(({ id }) => id).sort(),
  };
}

export class BackupService {
  private readonly appVersion: string;
  private readonly now: () => Date;
  private readonly photoInspector: PhotoInspector;
  private readonly plans = new WeakMap<ImportPlan, ValidatedPlan>();
  private planEpoch = 0;

  constructor(private readonly privateData: PrivateDataPort, options: BackupServiceOptions = {}) {
    this.appVersion = options.appVersion ?? packageMetadata.version;
    this.now = options.now ?? (() => new Date());
    this.photoInspector = options.photoInspector ?? inspectPhoto;
  }

  async exportBackup(): Promise<Blob> {
    const snapshot = cloneSnapshot(await this.privateData.exportSnapshot());
    validateRelationships(snapshot);
    const files: AsyncZippable = {};
    const photos: BackupManifest['photos'] = [];

    for (const photo of snapshot.photos) {
      const bytes = new Uint8Array(await photo.blob.arrayBuffer());
      if (bytes.byteLength !== photo.byteSize || photo.blob.size !== photo.byteSize) {
        throw new BackupError('invalid_manifest', 'A photo byte size does not match its metadata.');
      }
      if (photo.blob.type !== photo.contentType || sniffContentType(bytes) !== photo.contentType) {
        throw new BackupError('invalid_manifest', 'A photo content type does not match its bytes.');
      }
      const path = expectedPhotoPath(photo);
      files[path] = [bytes, { level: 0 }];
      const { blob: _blob, ...metadata } = photo;
      photos.push({ ...metadata, path, sha256: await sha256(bytes) });
    }

    const manifest = parseBackupManifest({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: this.now().toISOString(),
      appVersion: this.appVersion,
      journeys: snapshot.journeys,
      moments: snapshot.moments,
      songs: snapshot.songs,
      photos,
    });
    files['manifest.json'] = strToU8(JSON.stringify(manifest));

    try {
      const archive = await zipAsync(files);
      return new Blob([bytesForBlob(archive)], { type: BACKUP_MEDIA_TYPE });
    } catch (cause) {
      throw new BackupError('invalid_container', 'The backup ZIP could not be created.', { cause });
    }
  }

  async planImport(file: Blob): Promise<ImportPlan> {
    assertBackupContainerSize(file.size);
    let archiveBytes: Uint8Array;
    try {
      archiveBytes = new Uint8Array(await file.arrayBuffer());
    } catch (cause) {
      throw new BackupError('invalid_container', 'The backup file could not be read.', { cause });
    }
    const entries = preflightZip(archiveBytes);
    let files: Record<string, Uint8Array>;
    try {
      files = await unzipAsync(archiveBytes);
    } catch (cause) {
      throw new BackupError('invalid_container', 'The file is not a readable ZIP container.', { cause });
    }
    assertExtractedZip(entries, files);

    const manifestBytes = files['manifest.json'];
    if (!manifestBytes) throw new BackupError('invalid_container', 'The ZIP does not contain manifest.json.');

    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(manifestBytes));
    } catch (cause) {
      throw new BackupError('invalid_manifest', 'manifest.json is not valid JSON.', { cause });
    }
    const manifest = parseBackupManifest(parsed);
    const metadataById = new Map(manifest.photos.map((photo) => [photo.id, photo]));
    const snapshot: PrivateJourneySnapshot = {
      journeys: manifest.journeys.map((journey) => ({ ...journey })),
      moments: manifest.moments.map((moment) => ({ ...moment })),
      songs: manifest.songs.map((song) => ({ ...song })),
      photos: [],
    };

    const relationshipSnapshot: PrivateJourneySnapshot = {
      ...snapshot,
      photos: manifest.photos.map(({ path: _path, sha256: _sha256, ...photo }) => ({
        ...photo,
        blob: new Blob([], { type: photo.contentType }),
      })),
    };
    validateRelationships(relationshipSnapshot);

    const expectedFiles = new Set(['manifest.json', ...manifest.photos.map(({ path }) => path)]);
    if (Object.keys(files).some((path) => !expectedFiles.has(path))) {
      throw new BackupError('invalid_manifest', 'The ZIP contains an unreferenced file.');
    }

    for (const metadata of metadataById.values()) {
      const bytes = files[metadata.path];
      if (!bytes) throw new BackupError('missing_photo', 'A photo declared by the manifest is missing.');
      if (metadata.path !== expectedPhotoPath(metadata)) {
        throw new BackupError('invalid_manifest', 'A photo path is not canonical for its ID and content type.');
      }
      if (metadata.byteSize > BACKUP_LIMITS.maxPhotoBytes) {
        throw new BackupError('limit_exceeded', 'A declared photo byte size exceeds the backup limit.');
      }
      if (metadata.width > BACKUP_LIMITS.maxPhotoEdge || metadata.height > BACKUP_LIMITS.maxPhotoEdge) {
        throw new BackupError('limit_exceeded', 'A declared photo dimension exceeds the backup limit.');
      }
      if (await sha256(bytes) !== metadata.sha256) {
        throw new BackupError('checksum_mismatch', 'A photo checksum does not match the manifest.');
      }
      if (bytes.byteLength !== metadata.byteSize) {
        throw new BackupError('checksum_mismatch', 'A photo byte size does not match the manifest.');
      }
      if (sniffContentType(bytes) !== metadata.contentType) {
        throw new BackupError('invalid_manifest', 'A photo content type does not match its bytes.');
      }
      const blob = new Blob([bytesForBlob(bytes)], { type: metadata.contentType });
      let dimensions: Awaited<ReturnType<PhotoInspector>>;
      try {
        dimensions = await this.photoInspector(blob);
      } catch (cause) {
        throw new BackupError('invalid_manifest', 'A photo cannot be decoded.', { cause });
      }
      if (
        !Number.isInteger(dimensions.width) || dimensions.width < 1 ||
        !Number.isInteger(dimensions.height) || dimensions.height < 1
      ) {
        throw new BackupError('invalid_manifest', 'A decoded photo has invalid dimensions.');
      }
      if (dimensions.width > BACKUP_LIMITS.maxPhotoEdge || dimensions.height > BACKUP_LIMITS.maxPhotoEdge) {
        throw new BackupError('limit_exceeded', 'A decoded photo dimension exceeds the backup limit.');
      }
      if (dimensions.width !== metadata.width || dimensions.height !== metadata.height) {
        throw new BackupError('invalid_manifest', 'Decoded photo dimensions do not match the manifest.');
      }
      const { path: _path, sha256: _sha256, ...photo } = metadata;
      snapshot.photos.push({ ...photo, blob });
    }

    validateRelationships(snapshot);
    const existing = await this.privateData.exportSnapshot();
    const remapped = hasCollision(snapshot, existing);
    const validatedSnapshot = remapped ? remapSnapshot(snapshot, existing) : snapshot;
    validateRelationships(validatedSnapshot);

    const summary = Object.freeze(summaryFor(validatedSnapshot));
    const plan: ImportPlan = Object.freeze({
      summary,
      snapshot: freezeSnapshot(cloneSnapshot(validatedSnapshot)),
      remapped,
    });
    this.plans.set(plan, {
      snapshot: cloneSnapshot(validatedSnapshot),
      summary: { ...summary },
      epoch: this.planEpoch,
      expectedKeys: primaryKeys(existing),
    });
    return plan;
  }

  async commitImport(plan: ImportPlan): Promise<ImportResult> {
    const validated = this.plans.get(plan);
    if (!validated || validated.epoch !== this.planEpoch) {
      throw new BackupError('invalid_manifest', 'The import plan was not validated for the current data state.');
    }
    this.plans.delete(plan);
    this.planEpoch += 1;
    try {
      await this.privateData.importSnapshot(cloneSnapshot(validated.snapshot), validated.expectedKeys);
    } catch (cause) {
      if (cause instanceof PrivateDataStateConflictError) {
        throw new BackupError('stale_plan', 'Private data changed after this import was planned.', { cause });
      }
      throw cause;
    }
    return { summary: { ...validated.summary } };
  }

  async clearPrivateData(): Promise<void> {
    await this.privateData.clearPrivateData();
    this.planEpoch += 1;
  }
}
