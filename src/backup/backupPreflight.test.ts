import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivateDataPort, PrivateDataPrimaryKeys } from '../data/ports';
import type { PrivateJourneySnapshot } from '../domain/model';

const unzipMock = vi.hoisted(() => vi.fn());

vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>();
  return {
    ...actual,
    unzip: (bytes: Uint8Array, callback: (error: Error | null, files?: Record<string, Uint8Array>) => void) => {
      unzipMock(bytes);
      callback(new Error('Decompression must not run during rejected preflight.'));
    },
  };
});

import { BACKUP_LIMITS, BackupService } from './backupService';
import { assertExtractedZip, preflightZip } from './zipPreflight';

interface SyntheticZipEntry {
  name: string;
  method?: number;
  crc32?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  data?: Uint8Array;
  comment?: Uint8Array;
}

interface SyntheticZipOptions {
  comment?: Uint8Array;
}

class MarkerCountingBytes extends Uint8Array {
  markerSearches = 0;

  override indexOf(searchElement: number, fromIndex?: number) {
    this.markerSearches += 1;
    return super.indexOf(searchElement, fromIndex);
  }
}

class EmptyPrivateDataPort implements PrivateDataPort {
  async exportSnapshot(): Promise<PrivateJourneySnapshot> {
    return { journeys: [], moments: [], songs: [], photos: [] };
  }

  async importSnapshot(_snapshot: PrivateJourneySnapshot, _expectedKeys: PrivateDataPrimaryKeys) {
    throw new Error('Preflight tests must not import.');
  }

  async clearPrivateData() {
    throw new Error('Preflight tests must not clear.');
  }
}

function pushUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function syntheticZip(entries: SyntheticZipEntry[], options: SyntheticZipOptions = {}) {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const records = entries.map((entry) => ({
    ...entry,
    method: entry.method ?? 0,
    data: entry.data ?? new Uint8Array([0]),
    comment: entry.comment ?? new Uint8Array(),
    nameBytes: encoder.encode(entry.name),
    localOffset: 0,
  }));

  for (const record of records) {
    record.localOffset = bytes.length;
    const compressedSize = record.compressedSize ?? record.data.byteLength;
    const uncompressedSize = record.uncompressedSize ?? record.data.byteLength;
    pushUint32(bytes, 0x04034b50);
    pushUint16(bytes, 20);
    pushUint16(bytes, 0);
    pushUint16(bytes, record.method);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint32(bytes, record.crc32 ?? 0);
    pushUint32(bytes, compressedSize);
    pushUint32(bytes, uncompressedSize);
    pushUint16(bytes, record.nameBytes.byteLength);
    pushUint16(bytes, 0);
    bytes.push(...record.nameBytes, ...record.data);
  }

  const centralOffset = bytes.length;
  for (const record of records) {
    const compressedSize = record.compressedSize ?? record.data.byteLength;
    const uncompressedSize = record.uncompressedSize ?? record.data.byteLength;
    pushUint32(bytes, 0x02014b50);
    pushUint16(bytes, 20);
    pushUint16(bytes, 20);
    pushUint16(bytes, 0);
    pushUint16(bytes, record.method);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint32(bytes, record.crc32 ?? 0);
    pushUint32(bytes, compressedSize);
    pushUint32(bytes, uncompressedSize);
    pushUint16(bytes, record.nameBytes.byteLength);
    pushUint16(bytes, 0);
    pushUint16(bytes, record.comment.byteLength);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint32(bytes, 0);
    pushUint32(bytes, record.localOffset);
    bytes.push(...record.nameBytes, ...record.comment);
  }

  const centralSize = bytes.length - centralOffset;
  pushUint32(bytes, 0x06054b50);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, records.length);
  pushUint16(bytes, records.length);
  pushUint32(bytes, centralSize);
  pushUint32(bytes, centralOffset);
  pushUint16(bytes, options.comment?.byteLength ?? 0);
  if (options.comment) bytes.push(...options.comment);

  return new Blob([new Uint8Array(bytes).buffer]);
}

async function withSecondCentralDirectory(file: Blob) {
  const original = new Uint8Array(await file.arrayBuffer());
  const originalEocdOffset = original.byteLength - 22;
  const originalView = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const centralSize = originalView.getUint32(originalEocdOffset + 12, true);
  const centralOffset = originalView.getUint32(originalEocdOffset + 16, true);
  const centralDirectory = original.slice(centralOffset, centralOffset + centralSize);
  const result = new Uint8Array(original.byteLength + centralDirectory.byteLength + 22);
  result.set(original);
  result.set(centralDirectory, original.byteLength);
  result.set(original.subarray(originalEocdOffset), original.byteLength + centralDirectory.byteLength);
  new DataView(result.buffer).setUint32(
    original.byteLength + centralDirectory.byteLength + 16,
    original.byteLength,
    true,
  );
  return new Blob([result.buffer]);
}

function hybridZip64LocatorZip() {
  const nameLength = new TextEncoder().encode('manifest.json').byteLength;
  const zip64EocdOffset = 30 + nameLength;
  const data = new Uint8Array(56);
  const zip64View = new DataView(data.buffer);
  zip64View.setUint32(0, 0x06064b50, true);
  zip64View.setUint32(32, 1, true);
  zip64View.setUint32(48, 0, true);

  const locator = new Uint8Array(20);
  const locatorView = new DataView(locator.buffer);
  locatorView.setUint32(0, 0x07064b50, true);
  locatorView.setUint32(8, zip64EocdOffset, true);
  locatorView.setUint32(16, 1, true);

  return syntheticZip([{ name: 'manifest.json', data, comment: locator }]);
}

function service() {
  return new BackupService(new EmptyPrivateDataPort(), {
    appVersion: '1.0.0-test',
    photoInspector: async () => ({ width: 1, height: 1 }),
  });
}

async function expectPreflightError(file: Blob, code: string) {
  await expect(service().planImport(file)).rejects.toMatchObject({ code });
  expect(unzipMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  unzipMock.mockClear();
});

describe('backup ZIP central-directory preflight', () => {
  it('exports conservative browser-local backup limits', () => {
    expect(BACKUP_LIMITS).toEqual({
      maxContainerBytes: 256 * 1024 * 1024,
      maxEntryCount: 512,
      maxEntryCompressedBytes: 25 * 1024 * 1024,
      maxEntryUncompressedBytes: 25 * 1024 * 1024,
      maxTotalCompressedBytes: 256 * 1024 * 1024,
      maxTotalUncompressedBytes: 256 * 1024 * 1024,
      maxCompressionRatio: 100,
      maxManifestBytes: 2 * 1024 * 1024,
      maxPhotoBytes: 25 * 1024 * 1024,
      maxPhotoCount: 500,
      maxTotalPhotoBytes: 250 * 1024 * 1024,
      maxPhotoEdge: 2560,
    });
  });

  it('rejects duplicate central-directory names before decompression', async () => {
    await expectPreflightError(syntheticZip([
      { name: 'manifest.json' },
      { name: 'manifest.json' },
    ]), 'invalid_container');
  });

  it('rejects an archive comment before decompression', async () => {
    await expectPreflightError(syntheticZip(
      [{ name: 'manifest.json' }],
      { comment: new TextEncoder().encode('not allowed') },
    ), 'invalid_container');
  });

  it('rejects a central-directory entry comment before decompression', async () => {
    await expectPreflightError(syntheticZip([{
      name: 'manifest.json',
      comment: new TextEncoder().encode('not allowed'),
    }]), 'invalid_container');
  });

  it('rejects a second valid central-directory and EOCD pair before decompression', async () => {
    const dualEocd = await withSecondCentralDirectory(syntheticZip([{ name: 'manifest.json' }]));

    await expectPreflightError(dualEocd, 'invalid_container');
  });

  it('rejects a hybrid ZIP64 locator and EOCD before decompression', async () => {
    await expectPreflightError(hybridZip64LocatorZip(), 'invalid_container');
  });

  it('does not scan dense payload markers while locating the physical-end EOCD', async () => {
    const payload = new MarkerCountingBytes(16 * 1024);
    payload.fill(0x50);
    const archive = new MarkerCountingBytes(await syntheticZip([{
      name: 'manifest.json',
      data: payload,
    }]).arrayBuffer());

    expect(preflightZip(archive)).toHaveLength(1);
    expect(archive.markerSearches).toBe(0);
  });

  it.each(['../manifest.json', '/manifest.json', 'photos\\photo.jpg', 'photos//photo.jpg'])(
    'rejects unsafe or noncanonical entry name %s before decompression',
    async (name) => {
      await expectPreflightError(syntheticZip([{ name }]), 'invalid_container');
    },
  );

  it.each(['notes.txt', 'manifest.json.bak', 'photos/nested/photo.jpg', 'photos/photo.exe'])(
    'rejects unexpected v1 entry name %s before decompression',
    async (name) => {
      await expectPreflightError(syntheticZip([{ name }]), 'invalid_container');
    },
  );

  it('rejects unsupported compression methods before decompression', async () => {
    await expectPreflightError(syntheticZip([{ name: 'manifest.json', method: 12 }]), 'invalid_container');
  });

  it('rejects deflated v1 entries before decompression', async () => {
    await expectPreflightError(syntheticZip([{ name: 'manifest.json', method: 8 }]), 'invalid_container');
  });

  it('rejects many worker-eligible deflated entries before decompression', async () => {
    const compressedBytes = 6 * 1024;
    const entries: SyntheticZipEntry[] = [
      { name: 'manifest.json', data: new TextEncoder().encode('{}') },
      ...Array.from({ length: 64 }, (_, index) => ({
        name: `photos/hostile-${index}.jpg`,
        method: 8,
        data: new Uint8Array(compressedBytes),
        uncompressedSize: 600 * 1024,
      })),
    ];

    await expectPreflightError(syntheticZip(entries), 'invalid_container');
  });

  it('rejects excessive entry counts before parsing entry bodies', async () => {
    const entries = Array.from({ length: BACKUP_LIMITS.maxEntryCount + 1 }, (_, index) => ({
      name: `entry-${index}.bin`,
      data: new Uint8Array(),
    }));
    await expectPreflightError(syntheticZip(entries), 'limit_exceeded');
  });

  it('rejects an excessive declared compressed size without allocating it', async () => {
    await expectPreflightError(syntheticZip([{
      name: 'manifest.json',
      compressedSize: BACKUP_LIMITS.maxEntryCompressedBytes + 1,
      uncompressedSize: 1,
    }]), 'limit_exceeded');
  });

  it('rejects an excessive declared uncompressed size without allocating it', async () => {
    await expectPreflightError(syntheticZip([{
      name: 'photos/photo.jpg',
      compressedSize: 1024 * 1024,
      uncompressedSize: BACKUP_LIMITS.maxEntryUncompressedBytes + 1,
    }]), 'limit_exceeded');
  });

  it('rejects a high declared expansion ratio without allocating output', async () => {
    await expectPreflightError(syntheticZip([{
      name: 'manifest.json',
      compressedSize: 1,
      uncompressedSize: BACKUP_LIMITS.maxCompressionRatio + 1,
    }]), 'limit_exceeded');
  });

  it('rejects an excessive total declared uncompressed size before decompression', async () => {
    const entries = Array.from({ length: 11 }, (_, index) => ({
      name: `photos/photo-${index}.jpg`,
      compressedSize: 256 * 1024,
      uncompressedSize: 25 * 1024 * 1024,
    }));
    await expectPreflightError(syntheticZip(entries), 'limit_exceeded');
  });

  it('rejects an excessive total declared compressed size before decompression', async () => {
    const entries = Array.from({ length: 11 }, (_, index) => ({
      name: `photos/photo-${index}.jpg`,
      compressedSize: 25 * 1024 * 1024,
      uncompressedSize: 25 * 1024 * 1024,
    }));
    await expectPreflightError(syntheticZip(entries), 'limit_exceeded');
  });

  it('rejects an excessive container size before reading its bytes', async () => {
    const arrayBuffer = vi.fn().mockRejectedValue(new Error('arrayBuffer must not be called'));
    const oversized = {
      size: BACKUP_LIMITS.maxContainerBytes + 1,
      arrayBuffer,
    } as unknown as Blob;

    await expectPreflightError(oversized, 'limit_exceeded');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('retains each central CRC-32 and rejects extracted bytes that do not match it', async () => {
    const archive = new Uint8Array(await syntheticZip([{
      name: 'manifest.json',
      data: new TextEncoder().encode('abc'),
      crc32: 0x352441c2,
    }]).arrayBuffer());

    const entries = preflightZip(archive);

    expect(entries[0]).toMatchObject({ name: 'manifest.json', crc32: 0x352441c2 });
    expect(() => assertExtractedZip(entries, {
      'manifest.json': new TextEncoder().encode('abd'),
    })).toThrowError(expect.objectContaining({ code: 'invalid_container' }));
  });
});
