import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BackupError,
  parseBackupManifest,
  type BackupManifest,
} from './backupManifest';

function manifest(): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-07-13T08:00:00.000Z',
    appVersion: '1.0.0-test',
    journeys: [{
      id: 'journey-1',
      title: 'Synthetic journey',
      countryCode: 'ZZ',
      countryName: 'Testland',
      countryCoordinates: [12, 34],
      cityLabels: ['Sample City'],
      startDate: '2026-01-02',
      endDate: '2026-01-03',
      summary: 'Synthetic test record.',
      coverPhotoAssetId: 'photo-1',
      status: 'complete',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
      source: 'private',
    }],
    moments: [{
      id: 'moment-1',
      journeyId: 'journey-1',
      photoAssetId: 'photo-1',
      photoAlt: 'Synthetic photo',
      songReferenceId: 'song-1',
      localDate: '2026-01-02',
      cityLabel: 'Sample City',
      placeLabel: 'Test Place',
      caption: 'Synthetic caption.',
      reason: 'Synthetic reason.',
      reasonStatus: 'complete',
      sortOrder: 0,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }],
    songs: [{
      id: 'song-1',
      provider: 'manual',
      title: 'Synthetic song',
      artist: 'Synthetic artist',
      availability: 'needs_link',
    }],
    photos: [{
      id: 'photo-1',
      contentType: 'image/jpeg',
      originalFileName: 'synthetic.jpg',
      width: 8,
      height: 6,
      byteSize: 8,
      createdAt: '2026-01-02T00:00:00.000Z',
      path: 'photos/photo-1.jpg',
      sha256: 'a'.repeat(64),
    }],
  };
}

function expectCode(action: () => unknown, code: BackupError['code']) {
  expect(action).toThrowError(expect.objectContaining({ code }));
}

describe('backup manifest validation', () => {
  it('accepts the complete version 1 manifest schema', () => {
    expect(parseBackupManifest(manifest())).toEqual(manifest());
  });

  it('rejects a wrong format identifier as an invalid container', () => {
    expectCode(() => parseBackupManifest({ ...manifest(), format: 'other-format' }), 'invalid_container');
  });

  it('rejects an unsupported schema version with its exact code', () => {
    expectCode(() => parseBackupManifest({ ...manifest(), schemaVersion: 999 }), 'unsupported_version');
  });

  it.each([
    ['journey field type', (value: BackupManifest) => ({ ...value, journeys: [{ ...value.journeys[0], title: 42 }] })],
    ['coordinate tuple', (value: BackupManifest) => ({ ...value, journeys: [{ ...value.journeys[0], countryCoordinates: [12] }] })],
    ['moment enum', (value: BackupManifest) => ({ ...value, moments: [{ ...value.moments[0], reasonStatus: 'unknown' }] })],
    ['missing moment photoAssetId', (value: BackupManifest) => {
      const moment = { ...value.moments[0] } as Record<string, unknown>;
      delete moment.photoAssetId;
      return { ...value, moments: [moment] };
    }],
    ['private moment photoUrl', (value: BackupManifest) => ({
      ...value,
      moments: [{ ...value.moments[0], photoUrl: 'blob:private-photo' }],
    })],
    ['photo byte size', (value: BackupManifest) => ({ ...value, photos: [{ ...value.photos[0], byteSize: -1 }] })],
    ['unsafe photo path', (value: BackupManifest) => ({ ...value, photos: [{ ...value.photos[0], path: '../photo.jpg' }] })],
    ['non-lowercase checksum', (value: BackupManifest) => ({ ...value, photos: [{ ...value.photos[0], sha256: 'A'.repeat(64) }] })],
  ])('rejects an invalid %s', (_label, mutate) => {
    expectCode(() => parseBackupManifest(mutate(manifest())), 'invalid_manifest');
  });
});
