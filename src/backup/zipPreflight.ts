import { BackupError } from './backupManifest';
import { BACKUP_LIMITS } from './backupLimits';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_UINT16 = 0xffff;
const ZIP64_UINT32 = 0xffffffff;
const MINIMUM_EOCD_BYTES = 22;
const UTF8_FLAG = 0x0800;
const ALLOWED_FLAGS = UTF8_FLAG;
const PHOTO_PATH = /^photos\/(.+)\.(jpg|png|webp|gif|avif)$/;
const dangerousSegments = new Set(['__proto__', 'prototype', 'constructor']);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export interface ZipEntryMetadata {
  readonly name: string;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

interface ParsedZipEntry extends ZipEntryMetadata {
  readonly flags: number;
  readonly localHeaderOffset: number;
  readonly nameBytes: Uint8Array;
}

const crc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function invalidContainer(detail: string): never {
  throw new BackupError('invalid_container', `Invalid backup ZIP: ${detail}.`);
}

function limitExceeded(detail: string): never {
  throw new BackupError('limit_exceeded', `Backup ZIP limit exceeded: ${detail}.`);
}

function assertRange(offset: number, length: number, boundary: number) {
  if (
    !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
    offset < 0 || length < 0 || offset > boundary - length
  ) {
    invalidContainer('a record extends outside the container');
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function assertNoZip64EndRecords(bytes: Uint8Array, view: DataView, eocdOffset: number) {
  const locatorOffset = eocdOffset - 20;
  if (
    locatorOffset < 0 ||
    view.getUint32(locatorOffset, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
  ) {
    return;
  }

  const zip64EocdOffset = view.getUint32(locatorOffset + 8, true);
  if (
    zip64EocdOffset <= bytes.byteLength - 4 &&
    view.getUint32(zip64EocdOffset, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE
  ) {
    invalidContainer('ZIP64 end-of-central-directory records are not supported');
  }
  invalidContainer('ZIP64 end-of-central-directory locators are not supported');
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView) {
  const offset = bytes.byteLength - MINIMUM_EOCD_BYTES;
  if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    invalidContainer('the end-of-central-directory record is not at the physical end');
  }
  if (view.getUint16(offset + 20, true) !== 0) invalidContainer('ZIP comments are not supported');
  assertNoZip64EndRecords(bytes, view, offset);
  return offset;
}

function decodeEntryName(nameBytes: Uint8Array, flags: number) {
  if (!(flags & UTF8_FLAG) && nameBytes.some((byte) => byte > 0x7f)) {
    invalidContainer('a non-UTF-8 entry name is ambiguous');
  }

  let name: string;
  try {
    name = utf8Decoder.decode(nameBytes);
  } catch {
    invalidContainer('an entry name is not valid UTF-8');
  }

  const segments = name.split('/');
  const isCanonical =
    name.length > 0 &&
    name === name.normalize('NFC') &&
    !/[^\x20-\x7e]/.test(name) &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.includes('\\') &&
    !/^[A-Za-z]:/.test(name) &&
    segments.every((segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      segment === segment.trim() &&
      !dangerousSegments.has(segment),
    );
  if (!isCanonical) invalidContainer('an entry name is unsafe or noncanonical');
  return name;
}

function isCanonicalPhotoPath(name: string) {
  const match = PHOTO_PATH.exec(name);
  if (!match) return false;
  try {
    const id = decodeURIComponent(match[1]);
    return id.length > 0 && encodeURIComponent(id) === match[1];
  } catch {
    return false;
  }
}

function assertV1EntryName(name: string) {
  if (name !== 'manifest.json' && !isCanonicalPhotoPath(name)) {
    invalidContainer('an entry name is not part of the version 1 backup format');
  }
}

function validateCentralLimits(entry: ParsedZipEntry, totals: { compressed: number; uncompressed: number }) {
  const entryLimit = entry.name === 'manifest.json'
    ? BACKUP_LIMITS.maxManifestBytes
    : BACKUP_LIMITS.maxEntryUncompressedBytes;
  const compressedLimit = entry.name === 'manifest.json'
    ? BACKUP_LIMITS.maxManifestBytes
    : BACKUP_LIMITS.maxEntryCompressedBytes;

  if (entry.compressedSize > compressedLimit) limitExceeded('an entry compressed size is too large');
  if (entry.uncompressedSize > entryLimit) limitExceeded('an entry uncompressed size is too large');
  if (
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 ||
      entry.uncompressedSize > entry.compressedSize * BACKUP_LIMITS.maxCompressionRatio)
  ) {
    limitExceeded('an entry expansion ratio is too high');
  }

  totals.compressed += entry.compressedSize;
  totals.uncompressed += entry.uncompressedSize;
  if (totals.compressed > BACKUP_LIMITS.maxTotalCompressedBytes) {
    limitExceeded('the total compressed size is too large');
  }
  if (totals.uncompressed > BACKUP_LIMITS.maxTotalUncompressedBytes) {
    limitExceeded('the total uncompressed size is too large');
  }
}

function validateLocalHeaders(
  bytes: Uint8Array,
  view: DataView,
  centralOffset: number,
  entries: ParsedZipEntry[],
) {
  const ranges: Array<{ start: number; end: number }> = [];
  const localOffsets = new Set<number>();

  for (const entry of entries) {
    if (entry.flags & ~ALLOWED_FLAGS) invalidContainer('an entry uses unsupported ZIP flags');
    if (entry.compressedSize !== entry.uncompressedSize) {
      invalidContainer('a stored entry declares inconsistent sizes');
    }
    if (localOffsets.has(entry.localHeaderOffset)) invalidContainer('local header offsets are duplicated');
    localOffsets.add(entry.localHeaderOffset);

    assertRange(entry.localHeaderOffset, 30, centralOffset);
    if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE) {
      invalidContainer('a local header signature is invalid');
    }
    const localFlags = view.getUint16(entry.localHeaderOffset + 6, true);
    const localMethod = view.getUint16(entry.localHeaderOffset + 8, true);
    const localCrc32 = view.getUint32(entry.localHeaderOffset + 14, true);
    const localCompressedSize = view.getUint32(entry.localHeaderOffset + 18, true);
    const localUncompressedSize = view.getUint32(entry.localHeaderOffset + 22, true);
    const localNameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(entry.localHeaderOffset + 28, true);
    const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
    assertRange(entry.localHeaderOffset + 30, localNameLength + localExtraLength, centralOffset);
    assertRange(dataOffset, entry.compressedSize, centralOffset);

    const localNameBytes = bytes.subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + localNameLength);
    if (!bytesEqual(localNameBytes, entry.nameBytes)) invalidContainer('local and central entry names differ');
    if (localFlags !== entry.flags || localMethod !== entry.compressionMethod) {
      invalidContainer('local and central entry metadata differ');
    }
    if (
      localCrc32 !== entry.crc32 ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize
    ) {
      invalidContainer('local and central entry sizes differ');
    }
    ranges.push({ start: entry.localHeaderOffset, end: dataOffset + entry.compressedSize });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) invalidContainer('local entries overlap');
  }
  let expectedOffset = 0;
  for (const range of ranges) {
    if (range.start !== expectedOffset) invalidContainer('local entries are not contiguous');
    expectedOffset = range.end;
  }
  if (expectedOffset !== centralOffset) invalidContainer('unreferenced records precede the central directory');
}

export function assertBackupContainerSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 0) invalidContainer('the container size is invalid');
  if (size > BACKUP_LIMITS.maxContainerBytes) limitExceeded('the container is too large');
}

export function preflightZip(bytes: Uint8Array): ZipEntryMetadata[] {
  assertBackupContainerSize(bytes.byteLength);
  if (bytes.byteLength < MINIMUM_EOCD_BYTES) invalidContainer('the container is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes, view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntryCount = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== entryCount) {
    invalidContainer('multi-disk ZIP archives are not supported');
  }
  if (entryCount === ZIP64_UINT16 || centralSize === ZIP64_UINT32 || centralOffset === ZIP64_UINT32) {
    invalidContainer('ZIP64 archives are not supported');
  }
  if (entryCount > BACKUP_LIMITS.maxEntryCount) limitExceeded('there are too many entries');
  assertRange(centralOffset, centralSize, eocdOffset);
  if (centralOffset + centralSize !== eocdOffset) {
    invalidContainer('the central-directory boundary is inconsistent');
  }

  const entries: ParsedZipEntry[] = [];
  const names = new Set<string>();
  const totals = { compressed: 0, uncompressed: 0 };
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;

  for (let index = 0; index < entryCount; index += 1) {
    assertRange(cursor, 46, centralEnd);
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) {
      invalidContainer('a central-directory signature is invalid');
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    assertRange(cursor, recordLength, centralEnd);
    if (
      diskStart !== 0 ||
      compressedSize === ZIP64_UINT32 ||
      uncompressedSize === ZIP64_UINT32 ||
      localHeaderOffset === ZIP64_UINT32
    ) {
      invalidContainer('ZIP64 or multi-disk entry metadata is not supported');
    }
    if (commentLength !== 0) invalidContainer('ZIP comments are not supported');
    if (compressionMethod !== 0) invalidContainer('version 1 entries must use stored compression');
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
    const name = decodeEntryName(nameBytes, flags);
    assertV1EntryName(name);
    if (names.has(name)) invalidContainer('entry names must be unique');
    names.add(name);

    const entry: ParsedZipEntry = {
      name,
      flags,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      nameBytes,
    };
    validateCentralLimits(entry, totals);
    entries.push(entry);
    cursor += recordLength;
  }

  if (cursor !== centralEnd) invalidContainer('the central-directory size is inconsistent');
  if (!names.has('manifest.json')) invalidContainer('manifest.json is missing');
  validateLocalHeaders(bytes, view, centralOffset, entries);
  return entries.map(({ name, compressionMethod, crc32, compressedSize, uncompressedSize }) => ({
    name,
    compressionMethod,
    crc32,
    compressedSize,
    uncompressedSize,
  }));
}

export function assertExtractedZip(
  entries: ZipEntryMetadata[],
  files: Record<string, Uint8Array>,
) {
  const extractedNames = Object.keys(files);
  if (extractedNames.length !== entries.length) invalidContainer('the extracted entry set is inconsistent');
  for (const entry of entries) {
    const bytes = Object.prototype.hasOwnProperty.call(files, entry.name) ? files[entry.name] : undefined;
    if (!bytes || bytes.byteLength !== entry.uncompressedSize) {
      invalidContainer('an extracted entry size is inconsistent');
    }
    if (crc32(bytes) !== entry.crc32) invalidContainer('an extracted entry CRC-32 is inconsistent');
  }
}
