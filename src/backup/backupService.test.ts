import { strFromU8, strToU8, unzip, zip, type AsyncZippable } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  PrivateDataStateConflictError,
  type PrivateDataPort,
  type PrivateDataPrimaryKeys,
} from '../data/ports';
import type { Journey, PhotoAsset, PrivateJourneySnapshot } from '../domain/model';
import { BackupError } from './backupManifest';
import { BACKUP_LIMITS, BackupService, type BackupServiceOptions, type ImportPlan } from './backupService';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function journey(id = 'journey-1'): Journey {
  return {
    id,
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
  };
}

function photo(id: string, bytes: Uint8Array, contentType: string, name: string): PhotoAsset {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType });
  return {
    id,
    blob,
    contentType,
    originalFileName: name,
    width: 8,
    height: 6,
    byteSize: blob.size,
    createdAt: '2026-01-02T00:00:00.000Z',
  };
}

function populatedSnapshot(): PrivateJourneySnapshot {
  return {
    journeys: [journey()],
    moments: [
      {
        id: 'moment-1',
        journeyId: 'journey-1',
        photoAssetId: 'photo-1',
        photoAlt: 'Synthetic JPEG',
        songReferenceId: 'song-1',
        localDate: '2026-01-02',
        cityLabel: 'Sample City',
        placeLabel: 'Test Place 1',
        caption: 'Synthetic caption 1.',
        reason: 'Synthetic reason 1.',
        reasonStatus: 'complete',
        sortOrder: 0,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'moment-2',
        journeyId: 'journey-1',
        photoAssetId: 'photo-2',
        photoAlt: 'Synthetic PNG',
        songReferenceId: 'song-2',
        localDate: '2026-01-03',
        localTime: '12:30',
        cityLabel: 'Sample City',
        placeLabel: 'Test Place 2',
        caption: 'Synthetic caption 2.',
        reason: 'Synthetic reason 2.',
        reasonStatus: 'needs_review',
        sortOrder: 1,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    ],
    songs: [
      { id: 'song-1', provider: 'manual', title: 'Synthetic song 1', artist: 'Artist 1', availability: 'needs_link' },
      { id: 'song-2', provider: 'youtube', providerItemId: 'M7lc1UVf-VE', sourceUrl: 'https://youtu.be/M7lc1UVf-VE', title: 'Synthetic song 2', artist: 'Artist 2', availability: 'available' },
    ],
    photos: [
      photo('photo-1', JPEG_BYTES, 'image/jpeg', 'synthetic-1.jpg'),
      photo('photo-2', PNG_BYTES, 'image/png', 'synthetic-2.png'),
    ],
  };
}

function emptySnapshot(): PrivateJourneySnapshot {
  return { journeys: [], moments: [], songs: [], photos: [] };
}

class MemoryPrivateDataPort implements PrivateDataPort {
  importCalls = 0;
  clearCalls = 0;
  imported?: PrivateJourneySnapshot;
  importedExpectedKeys?: PrivateDataPrimaryKeys;
  importFailure?: Error;

  constructor(public snapshot: PrivateJourneySnapshot) {}

  async exportSnapshot() {
    return this.snapshot;
  }

  async importSnapshot(snapshot: PrivateJourneySnapshot, expectedKeys: PrivateDataPrimaryKeys) {
    this.importCalls += 1;
    this.imported = snapshot;
    this.importedExpectedKeys = expectedKeys;
    if (this.importFailure) throw this.importFailure;
  }

  async clearPrivateData() {
    this.clearCalls += 1;
    this.snapshot = emptySnapshot();
  }
}

function service(port: PrivateDataPort, options: Partial<BackupServiceOptions> = {}) {
  return new BackupService(port, {
    appVersion: '1.0.0-test',
    now: () => new Date('2026-07-13T08:00:00.000Z'),
    photoInspector: async () => ({ width: 8, height: 6 }),
    ...options,
  });
}

function zipStoredAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, files) => error ? reject(error) : resolve(files));
  });
}

async function alterBackup(
  backup: Blob,
  alter: (files: Record<string, Uint8Array>, manifest: Record<string, any>) => void,
) {
  const files = await unzipAsync(new Uint8Array(await backup.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Record<string, any>;
  alter(files, manifest);
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return new Blob([(await zipStoredAsync(files)).slice().buffer as ArrayBuffer], { type: backup.type });
}

async function expectPlanError(
  target: MemoryPrivateDataPort,
  backup: Blob,
  code: BackupError['code'],
) {
  const before = target.snapshot;
  await expect(service(target).planImport(backup)).rejects.toMatchObject({ code });
  expect(target.importCalls).toBe(0);
  expect(target.snapshot).toEqual(before);
}

function localEntry(bytes: Uint8Array, fileName: string) {
  const name = strToU8(fileName);
  const index = bytes.findIndex((_value, start) => name.every((byte, offset) => bytes[start + offset] === byte));
  expect(index).toBeGreaterThanOrEqual(30);
  const view = new DataView(bytes.buffer, bytes.byteOffset + index - 30, 30);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  return {
    compressionMethod: view.getUint16(8, true),
    compressedSize: view.getUint32(18, true),
    dataOffset: index + name.byteLength + view.getUint16(28, true),
  };
}

function localCompressionMethod(bytes: Uint8Array, fileName: string) {
  return localEntry(bytes, fileName).compressionMethod;
}

async function corruptStoredEntry(backup: Blob, fileName: string) {
  const bytes = new Uint8Array(await backup.arrayBuffer());
  const entry = localEntry(bytes, fileName);
  expect(entry.compressionMethod).toBe(0);
  expect(entry.compressedSize).toBeGreaterThan(0);
  bytes[entry.dataOffset] ^= 0x01;
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: backup.type });
}

describe('BackupService', () => {
  it('exports and plans a complete backup while preserving IDs for an empty target', async () => {
    const blob = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const plan = await service(new MemoryPrivateDataPort(emptySnapshot())).planImport(blob);

    expect(blob.type).toBe('application/vnd.sound-passport.backup');
    expect(plan.summary).toEqual({ journeys: 1, moments: 2, photos: 2 });
    expect(plan.snapshot.journeys[0].id).toBe('journey-1');
    expect(plan.snapshot.moments.map((moment) => moment.id)).toEqual(['moment-1', 'moment-2']);
    expect(plan.remapped).toBe(false);
  });

  it('stores every generated entry so the archive satisfies importer ratio policy', async () => {
    const bytes = new Uint8Array(await (await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup()).arrayBuffer());

    expect(localCompressionMethod(bytes, 'manifest.json')).toBe(0);
    expect(localCompressionMethod(bytes, 'photos/photo-1.jpg')).toBe(0);
    expect(localCompressionMethod(bytes, 'photos/photo-2.png')).toBe(0);
  });

  it('decodes every exported photo through the same validation boundary as import', async () => {
    const inspector = vi.fn(async (_blob: Blob) => ({ width: 8, height: 6 }));

    await service(new MemoryPrivateDataPort(populatedSnapshot()), { photoInspector: inspector }).exportBackup();

    expect(inspector).toHaveBeenCalledTimes(2);
    expect(inspector.mock.calls.map(([blob]) => ({ size: blob.size, type: blob.type }))).toEqual([
      { size: JPEG_BYTES.byteLength, type: 'image/jpeg' },
      { size: PNG_BYTES.byteLength, type: 'image/png' },
    ]);
  });

  it('rejects an undecodable photo during export', async () => {
    const inspector = vi.fn().mockRejectedValue(new Error('synthetic decode failure'));

    await expect(service(new MemoryPrivateDataPort(populatedSnapshot()), { photoInspector: inspector }).exportBackup())
      .rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('rejects decoded export dimensions above 2560px with a typed limit error', async () => {
    const inspector = vi.fn(async (blob: Blob) => blob.type === 'image/jpeg'
      ? { width: BACKUP_LIMITS.maxPhotoEdge + 1, height: 6 }
      : { width: 8, height: 6 });

    await expect(service(new MemoryPrivateDataPort(populatedSnapshot()), { photoInspector: inspector }).exportBackup())
      .rejects.toMatchObject({ code: 'limit_exceeded' });
  });

  it('rejects an export blob above 25 MiB before reading it', async () => {
    const snapshot = populatedSnapshot();
    const arrayBuffer = vi.fn().mockRejectedValue(new Error('oversized blobs must not be read'));
    const blob = {
      size: BACKUP_LIMITS.maxPhotoBytes + 1,
      type: 'image/jpeg',
      arrayBuffer,
    } as unknown as Blob;
    snapshot.photos[0] = { ...snapshot.photos[0], blob, byteSize: blob.size };

    await expect(service(new MemoryPrivateDataPort(snapshot)).exportBackup())
      .rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects generated archives whose manifest exceeds importer limits', async () => {
    const snapshot = populatedSnapshot();
    snapshot.journeys[0].summary = 'x'.repeat(BACKUP_LIMITS.maxManifestBytes);

    await expect(service(new MemoryPrivateDataPort(snapshot)).exportBackup())
      .rejects.toMatchObject({ code: 'limit_exceeded' });
  });

  it('rejects malformed ZIP bytes as invalid_container without writing', async () => {
    await expectPlanError(
      new MemoryPrivateDataPort(populatedSnapshot()),
      new Blob([new Uint8Array([1, 2, 3])]),
      'invalid_container',
    );
  });

  it('rejects stored manifest byte corruption as invalid_container before parsing JSON', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const corrupted = await corruptStoredEntry(backup, 'manifest.json');

    await expectPlanError(new MemoryPrivateDataPort(emptySnapshot()), corrupted, 'invalid_container');
  });

  it.each([
    ['wrong format', (files: Record<string, Uint8Array>, manifest: Record<string, any>) => { manifest.format = 'wrong'; }, 'invalid_container'],
    ['unsupported version', (files: Record<string, Uint8Array>, manifest: Record<string, any>) => { manifest.schemaVersion = 999; }, 'unsupported_version'],
    ['missing photo', (files: Record<string, Uint8Array>, manifest: Record<string, any>) => { delete files[manifest.photos[0].path]; }, 'missing_photo'],
    ['signature-corrupt photo', (files: Record<string, Uint8Array>, manifest: Record<string, any>) => { files[manifest.photos[0].path][0] ^= 0xff; }, 'checksum_mismatch'],
    ['corrupt photo', (files: Record<string, Uint8Array>, manifest: Record<string, any>) => { files[manifest.photos[0].path][4] ^= 0xff; }, 'checksum_mismatch'],
    ['wrong byte size', (_files: Record<string, Uint8Array>, manifest: Record<string, any>) => { manifest.photos[0].byteSize += 1; }, 'checksum_mismatch'],
    ['wrong content type', (_files: Record<string, Uint8Array>, manifest: Record<string, any>) => { manifest.photos[0].contentType = 'image/png'; }, 'invalid_manifest'],
    ['dangling song', (_files: Record<string, Uint8Array>, manifest: Record<string, any>) => { manifest.moments[0].songReferenceId = 'missing-song'; }, 'relationship_error'],
    ['moment without a photoAssetId', (_files: Record<string, Uint8Array>, manifest: Record<string, any>) => { delete manifest.moments[0].photoAssetId; }, 'invalid_manifest'],
    ['private moment photoUrl', (_files: Record<string, Uint8Array>, manifest: Record<string, any>) => { manifest.moments[0].photoUrl = 'blob:private-photo'; }, 'invalid_manifest'],
    ['extra file', (files: Record<string, Uint8Array>) => { files['photos/extra.jpg'] = JPEG_BYTES; }, 'invalid_manifest'],
  ] as const)('rejects a %s and leaves existing data unchanged', async (_label, mutate, code) => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const altered = await alterBackup(backup, mutate);
    await expectPlanError(new MemoryPrivateDataPort(populatedSnapshot()), altered, code);
  });

  it.each([
    ['route-unsafe ID', (manifest: Record<string, any>) => {
      manifest.journeys[0].id = '../journey';
      manifest.moments.forEach((moment: Record<string, any>) => { moment.journeyId = '../journey'; });
    }, 'invalid_manifest'],
    ['impossible local date', (manifest: Record<string, any>) => {
      manifest.moments[0].localDate = '2026-02-30';
    }, 'invalid_manifest'],
    ['invalid local time', (manifest: Record<string, any>) => {
      manifest.moments[1].localTime = '24:00';
    }, 'invalid_manifest'],
    ['noncanonical timestamp', (manifest: Record<string, any>) => {
      manifest.journeys[0].updatedAt = '2026-01-04T00:00:00Z';
    }, 'invalid_manifest'],
    ['out-of-range longitude', (manifest: Record<string, any>) => {
      manifest.journeys[0].countryCoordinates = [181, 34];
    }, 'invalid_manifest'],
    ['duplicate moment order', (manifest: Record<string, any>) => {
      manifest.moments[1].sortOrder = manifest.moments[0].sortOrder;
    }, 'relationship_error'],
    ['invalid completed lifecycle', (manifest: Record<string, any>) => {
      manifest.songs[0].title = '';
    }, 'relationship_error'],
    ['invalid moment lifecycle', (manifest: Record<string, any>) => {
      manifest.moments[0].createdAt = '2026-01-03T00:00:00.000Z';
      manifest.moments[0].updatedAt = '2026-01-02T00:00:00.000Z';
    }, 'relationship_error'],
  ] as const)('atomically rejects semantic archive violation: %s', async (_label, mutate, code) => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const altered = await alterBackup(backup, (_files, manifest) => mutate(manifest));

    await expectPlanError(new MemoryPrivateDataPort(populatedSnapshot()), altered, code);
  });

  it('rejects noncanonical photo paths even when the referenced bytes exist', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const altered = await alterBackup(backup, (files, manifest) => {
      const canonical = manifest.photos[0].path as string;
      const noncanonical = canonical.replace(/\.jpg$/, '.jpeg');
      files[noncanonical] = files[canonical];
      delete files[canonical];
      manifest.photos[0].path = noncanonical;
    });

    await expectPlanError(new MemoryPrivateDataPort(emptySnapshot()), altered, 'invalid_container');
  });

  it.each([
    ['missing photoAssetId', (snapshot: PrivateJourneySnapshot) => { delete snapshot.moments[0].photoAssetId; }],
    ['private photoUrl', (snapshot: PrivateJourneySnapshot) => { snapshot.moments[0].photoUrl = 'blob:private-photo'; }],
    ['empty private photoUrl', (snapshot: PrivateJourneySnapshot) => { snapshot.moments[0].photoUrl = ''; }],
  ] as const)('rejects exporting a private moment with %s', async (_label, mutate) => {
    const snapshot = populatedSnapshot();
    mutate(snapshot);

    await expect(service(new MemoryPrivateDataPort(snapshot)).exportBackup())
      .rejects.toMatchObject({ code: 'relationship_error' });
  });

  it.each(['\ud800', '\udc00'])('rejects malformed Unicode photo ID %j without leaking URIError', async (id) => {
    const snapshot = populatedSnapshot();
    snapshot.photos[0].id = id;
    snapshot.journeys[0].coverPhotoAssetId = id;
    snapshot.moments[0].photoAssetId = id;

    await expect(service(new MemoryPrivateDataPort(snapshot)).exportBackup())
      .rejects.toMatchObject({ name: 'BackupError', code: 'invalid_manifest' });
  });

  it('decodes every imported photo before producing a plan', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const inspector = vi.fn(async (_blob: Blob) => ({ width: 8, height: 6 }));

    await service(new MemoryPrivateDataPort(emptySnapshot()), { photoInspector: inspector }).planImport(backup);

    expect(inspector).toHaveBeenCalledTimes(2);
    expect(inspector.mock.calls.map(([blob]) => ({ size: blob.size, type: blob.type }))).toEqual([
      { size: JPEG_BYTES.byteLength, type: 'image/jpeg' },
      { size: PNG_BYTES.byteLength, type: 'image/png' },
    ]);
  });

  it('rejects undecodable or truncated photo content before producing a plan', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const inspector = vi.fn().mockRejectedValue(new Error('synthetic decode failure'));

    await expect(service(new MemoryPrivateDataPort(emptySnapshot()), { photoInspector: inspector }).planImport(backup))
      .rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('rejects actual photo dimensions that differ from the manifest', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();

    await expect(service(new MemoryPrivateDataPort(emptySnapshot()), {
      photoInspector: async () => ({ width: 9, height: 6 }),
    }).planImport(backup)).rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('rejects photo dimensions above the 2560px cap with an explicit limit error', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const altered = await alterBackup(backup, (_files, manifest) => { manifest.photos[0].width = 2561; });

    await expect(service(new MemoryPrivateDataPort(emptySnapshot()), {
      photoInspector: async (blob) => blob.type === 'image/jpeg'
        ? { width: 2561, height: 6 }
        : { width: 8, height: 6 },
    }).planImport(altered)).rejects.toMatchObject({ code: 'limit_exceeded' });
  });

  it('rejects a declared photo size above 25 MiB with an explicit limit error', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const altered = await alterBackup(backup, (_files, manifest) => {
      manifest.photos[0].byteSize = 25 * 1024 * 1024 + 1;
    });

    await expect(service(new MemoryPrivateDataPort(emptySnapshot())).planImport(altered))
      .rejects.toMatchObject({ code: 'limit_exceeded' });
  });

  it('rejects too many photos before reading any photo blobs', async () => {
    const snapshot = populatedSnapshot();
    const arrayBuffer = vi.fn().mockRejectedValue(new Error('photo bytes must not be read'));
    snapshot.photos = Array.from({ length: BACKUP_LIMITS.maxPhotoCount + 1 }, (_, index) => {
      const blob = { size: 1, type: 'image/jpeg', arrayBuffer } as unknown as Blob;
      return { ...snapshot.photos[0], id: `photo-${index}`, blob, byteSize: 1 };
    });
    snapshot.journeys[0].coverPhotoAssetId = snapshot.photos[0].id;
    snapshot.moments[0].photoAssetId = snapshot.photos[0].id;
    snapshot.moments[1].photoAssetId = snapshot.photos[1].id;

    await expect(service(new MemoryPrivateDataPort(snapshot)).exportBackup())
      .rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects aggregate photo bytes before reading any photo blobs', async () => {
    const snapshot = populatedSnapshot();
    const photoSize = BACKUP_LIMITS.maxPhotoBytes;
    const photoCount = Math.floor(BACKUP_LIMITS.maxTotalPhotoBytes / photoSize) + 1;
    const arrayBuffer = vi.fn().mockRejectedValue(new Error('photo bytes must not be read'));
    snapshot.photos = Array.from({ length: photoCount }, (_, index) => {
      const blob = { size: photoSize, type: 'image/jpeg', arrayBuffer } as unknown as Blob;
      return { ...snapshot.photos[0], id: `photo-${index}`, blob, byteSize: photoSize };
    });
    snapshot.journeys[0].coverPhotoAssetId = snapshot.photos[0].id;
    snapshot.moments[0].photoAssetId = snapshot.photos[0].id;
    snapshot.moments[1].photoAssetId = snapshot.photos[1].id;

    await expect(service(new MemoryPrivateDataPort(snapshot)).exportBackup())
      .rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('deterministically remaps every primary and foreign key when any target ID collides', async () => {
    const original = populatedSnapshot();
    const backup = await service(new MemoryPrivateDataPort(original)).exportBackup();
    const existing: PrivateJourneySnapshot = { ...emptySnapshot(), journeys: [{ ...journey(), coverPhotoAssetId: undefined }] };
    const target = new MemoryPrivateDataPort(existing);
    const targetService = service(target);

    const first = await targetService.planImport(backup);
    const second = await targetService.planImport(backup);

    expect(first.remapped).toBe(true);
    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.snapshot.journeys[0].id).not.toBe(original.journeys[0].id);
    expect(first.snapshot.moments.map(({ id }) => id)).not.toEqual(original.moments.map(({ id }) => id));
    expect(first.snapshot.songs.map(({ id }) => id)).not.toEqual(original.songs.map(({ id }) => id));
    expect(first.snapshot.photos.map(({ id }) => id)).not.toEqual(original.photos.map(({ id }) => id));
    expect(new Set(first.snapshot.moments.map(({ journeyId }) => journeyId))).toEqual(new Set([first.snapshot.journeys[0].id]));
    expect(first.snapshot.moments.map(({ songReferenceId }) => songReferenceId)).toEqual(first.snapshot.songs.map(({ id }) => id));
    expect(first.snapshot.moments.map(({ photoAssetId }) => photoAssetId)).toEqual(first.snapshot.photos.map(({ id }) => id));
    expect(first.snapshot.journeys[0].coverPhotoAssetId).toBe(first.snapshot.photos[0].id);
    expect(target.importCalls).toBe(0);
    expect(target.snapshot).toEqual(existing);
  });

  it('keeps deterministic collision remaps canonical when every source ID is already 128 characters', async () => {
    const original = populatedSnapshot();
    const ids = {
      journey: `j${'a'.repeat(127)}`,
      moments: [`m${'a'.repeat(127)}`, `m${'b'.repeat(127)}`],
      songs: [`s${'a'.repeat(127)}`, `s${'b'.repeat(127)}`],
      photos: [`p${'a'.repeat(127)}`, `p${'b'.repeat(127)}`],
    };
    original.journeys[0] = {
      ...original.journeys[0],
      id: ids.journey,
      coverPhotoAssetId: ids.photos[0],
    };
    original.moments = original.moments.map((moment, index) => ({
      ...moment,
      id: ids.moments[index],
      journeyId: ids.journey,
      songReferenceId: ids.songs[index],
      photoAssetId: ids.photos[index],
    }));
    original.songs = original.songs.map((song, index) => ({ ...song, id: ids.songs[index] }));
    original.photos = original.photos.map((asset, index) => ({ ...asset, id: ids.photos[index] }));
    const backup = await service(new MemoryPrivateDataPort(original)).exportBackup();
    const existing: PrivateJourneySnapshot = {
      ...emptySnapshot(),
      journeys: [{
        ...journey(ids.journey),
        coverPhotoAssetId: undefined,
        status: 'draft',
      }],
    };
    const targetService = service(new MemoryPrivateDataPort(existing));

    const first = await targetService.planImport(backup);
    const second = await targetService.planImport(backup);
    const remappedIds = [
      ...first.snapshot.journeys.map(({ id }) => id),
      ...first.snapshot.moments.map(({ id }) => id),
      ...first.snapshot.songs.map(({ id }) => id),
      ...first.snapshot.photos.map(({ id }) => id),
    ];

    expect(first.snapshot).toEqual(second.snapshot);
    expect(remappedIds.every((id) => id.length <= 128)).toBe(true);
    expect(remappedIds.every((id) => /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(id))).toBe(true);
    expect(new Set(first.snapshot.moments.map(({ journeyId }) => journeyId))).toEqual(
      new Set([first.snapshot.journeys[0].id]),
    );
    expect(first.snapshot.moments.map(({ songReferenceId }) => songReferenceId)).toEqual(
      first.snapshot.songs.map(({ id }) => id),
    );
    expect(first.snapshot.moments.map(({ photoAssetId }) => photoAssetId)).toEqual(
      first.snapshot.photos.map(({ id }) => id),
    );
    expect(first.snapshot.journeys[0].coverPhotoAssetId).toBe(first.snapshot.photos[0].id);
  });

  it('commits only a plan produced by the same service and calls importSnapshot exactly once', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const target = new MemoryPrivateDataPort(emptySnapshot());
    const targetService = service(target);
    const plan = await targetService.planImport(backup);

    await expect(service(target).commitImport(plan)).rejects.toMatchObject({ code: 'invalid_manifest' });
    await expect(targetService.commitImport({ ...plan } as ImportPlan)).rejects.toMatchObject({ code: 'invalid_manifest' });
    expect(target.importCalls).toBe(0);

    const result = await targetService.commitImport(plan);
    expect(result).toEqual({ summary: plan.summary });
    expect(target.importCalls).toBe(1);
    expect(target.imported).toEqual(plan.snapshot);
    expect(target.importedExpectedKeys).toEqual({ journeys: [], moments: [], songs: [], photos: [] });
    await expect(targetService.commitImport(plan)).rejects.toMatchObject({ code: 'invalid_manifest' });
    expect(target.importCalls).toBe(1);
  });

  it('passes the exact planned target keys to the single import call', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const existing: PrivateJourneySnapshot = {
      ...emptySnapshot(),
      journeys: [{ ...journey('existing-journey'), coverPhotoAssetId: undefined }],
    };
    const target = new MemoryPrivateDataPort(existing);
    const targetService = service(target);
    const plan = await targetService.planImport(backup);

    await targetService.commitImport(plan);

    expect(target.importCalls).toBe(1);
    expect(target.importedExpectedKeys).toEqual({
      journeys: ['existing-journey'],
      moments: [],
      songs: [],
      photos: [],
    });
  });

  it('maps a target-state conflict to the explicit stale_plan error code', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const target = new MemoryPrivateDataPort(emptySnapshot());
    target.importFailure = new PrivateDataStateConflictError();
    const targetService = service(target);
    const plan = await targetService.planImport(backup);

    await expect(targetService.commitImport(plan)).rejects.toMatchObject({ code: 'stale_plan' });
    expect(target.importCalls).toBe(1);
  });

  it('reports a service-local sibling plan invalidated by commit as stale, then consumed', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const target = new MemoryPrivateDataPort(emptySnapshot());
    const targetService = service(target);
    const first = await targetService.planImport(backup);
    const stale = await targetService.planImport(backup);

    await targetService.commitImport(first);
    await expect(targetService.commitImport(stale)).rejects.toMatchObject({ code: 'stale_plan' });
    await expect(targetService.commitImport(stale)).rejects.toMatchObject({ code: 'invalid_manifest' });
    expect(target.importCalls).toBe(1);
  });

  it('reports a service-local plan invalidated by clear as stale without importing', async () => {
    const backup = await service(new MemoryPrivateDataPort(populatedSnapshot())).exportBackup();
    const target = new MemoryPrivateDataPort(emptySnapshot());
    const targetService = service(target);
    const plan = await targetService.planImport(backup);

    await targetService.clearPrivateData();

    await expect(targetService.commitImport(plan)).rejects.toMatchObject({ code: 'stale_plan' });
    expect(target.importCalls).toBe(0);
  });

  it('delegates private-data clearing without exposing an unvalidated import method', async () => {
    const port = new MemoryPrivateDataPort(populatedSnapshot());
    const targetService = service(port);

    await targetService.clearPrivateData();

    expect(port.clearCalls).toBe(1);
    expect('importSnapshot' in targetService).toBe(false);
  });
});
