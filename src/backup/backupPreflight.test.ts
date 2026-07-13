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

function syntheticZip(entries: SyntheticZipEntry[]) {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const records = entries.map((entry) => ({
    ...entry,
    method: entry.method ?? 0,
    data: entry.data ?? new Uint8Array([0]),
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
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint32(bytes, 0);
    pushUint32(bytes, record.localOffset);
    bytes.push(...record.nameBytes);
  }

  const centralSize = bytes.length - centralOffset;
  pushUint32(bytes, 0x06054b50);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, records.length);
  pushUint16(bytes, records.length);
  pushUint32(bytes, centralSize);
  pushUint32(bytes, centralOffset);
  pushUint16(bytes, 0);

  return new Blob([new Uint8Array(bytes).buffer]);
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
      maxPhotoEdge: 2560,
    });
  });

  it('rejects duplicate central-directory names before decompression', async () => {
    await expectPreflightError(syntheticZip([
      { name: 'manifest.json' },
      { name: 'manifest.json' },
    ]), 'invalid_container');
  });

  it.each(['../manifest.json', '/manifest.json', 'photos\\photo.jpg', 'photos//photo.jpg'])(
    'rejects unsafe or noncanonical entry name %s before decompression',
    async (name) => {
      await expectPreflightError(syntheticZip([{ name }]), 'invalid_container');
    },
  );

  it('rejects unsupported compression methods before decompression', async () => {
    await expectPreflightError(syntheticZip([{ name: 'manifest.json', method: 12 }]), 'invalid_container');
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
      name: 'photo.bin',
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
      name: `entry-${index}.bin`,
      compressedSize: 256 * 1024,
      uncompressedSize: 25 * 1024 * 1024,
    }));
    await expectPreflightError(syntheticZip(entries), 'limit_exceeded');
  });

  it('rejects an excessive total declared compressed size before decompression', async () => {
    const entries = Array.from({ length: 11 }, (_, index) => ({
      name: `entry-${index}.bin`,
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
