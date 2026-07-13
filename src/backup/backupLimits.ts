import { PHOTO_LIMITS } from '../media/photoLimits';

const MEBIBYTE = 1024 * 1024;

// Conservative ceilings for a personal, browser-local archive keep validation memory-bounded.
export const BACKUP_LIMITS = Object.freeze({
  maxContainerBytes: 256 * MEBIBYTE,
  maxEntryCount: 512,
  maxEntryCompressedBytes: 25 * MEBIBYTE,
  maxEntryUncompressedBytes: 25 * MEBIBYTE,
  maxTotalCompressedBytes: 256 * MEBIBYTE,
  maxTotalUncompressedBytes: 256 * MEBIBYTE,
  maxCompressionRatio: 100,
  maxManifestBytes: 2 * MEBIBYTE,
  maxPhotoBytes: PHOTO_LIMITS.maxPhotoBytes,
  maxPhotoCount: PHOTO_LIMITS.maxPhotoCount,
  maxTotalPhotoBytes: PHOTO_LIMITS.maxTotalPhotoBytes,
  maxPhotoEdge: PHOTO_LIMITS.maxPhotoEdge,
});
