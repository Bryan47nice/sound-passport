import type { PhotoAsset } from '../domain/model';
import type { PhotoInspector } from '../media/photoInspector';
import { BACKUP_LIMITS } from './backupLimits';
import { BackupError, type BackupErrorCode } from './backupManifest';

type PhotoMetadata = Pick<PhotoAsset, 'byteSize' | 'contentType' | 'height' | 'width'>;

interface BackupPhotoValidationInput {
  readonly blob: Blob;
  readonly bytes: Uint8Array;
  readonly metadata: PhotoMetadata;
  readonly photoInspector: PhotoInspector;
  readonly sizeMismatchCode?: BackupErrorCode;
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

export function assertBackupPhotoEnvelopeLimits(metadata: PhotoMetadata, blobSize: number) {
  if (metadata.byteSize > BACKUP_LIMITS.maxPhotoBytes || blobSize > BACKUP_LIMITS.maxPhotoBytes) {
    throw new BackupError('limit_exceeded', 'A photo byte size exceeds the backup limit.');
  }
  if (metadata.width > BACKUP_LIMITS.maxPhotoEdge || metadata.height > BACKUP_LIMITS.maxPhotoEdge) {
    throw new BackupError('limit_exceeded', 'A photo dimension exceeds the backup limit.');
  }
}

export async function validateBackupPhoto({
  blob,
  bytes,
  metadata,
  photoInspector,
  sizeMismatchCode = 'invalid_manifest',
}: BackupPhotoValidationInput) {
  assertBackupPhotoEnvelopeLimits(metadata, blob.size);
  if (bytes.byteLength > BACKUP_LIMITS.maxPhotoBytes) {
    throw new BackupError('limit_exceeded', 'A photo byte size exceeds the backup limit.');
  }
  if (bytes.byteLength !== metadata.byteSize || blob.size !== metadata.byteSize) {
    throw new BackupError(sizeMismatchCode, 'A photo byte size does not match its metadata.');
  }
  if (blob.type !== metadata.contentType || sniffContentType(bytes) !== metadata.contentType) {
    throw new BackupError('invalid_manifest', 'A photo content type does not match its bytes.');
  }

  let dimensions: Awaited<ReturnType<PhotoInspector>>;
  try {
    dimensions = await photoInspector(blob);
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
}
