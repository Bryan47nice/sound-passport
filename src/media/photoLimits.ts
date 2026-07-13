const MEBIBYTE = 1024 * 1024;

export const PHOTO_LIMITS = Object.freeze({
  maxPhotoBytes: 25 * MEBIBYTE,
  maxPhotoCount: 500,
  maxTotalPhotoBytes: 250 * MEBIBYTE,
  maxBatchPhotoCount: 100,
  maxBatchInputBytes: 250 * MEBIBYTE,
  normalizationConcurrency: 3,
  maxPhotoEdge: 2560,
});

export interface PhotoEnvelopeItem {
  readonly byteSize: number;
  readonly blob: Pick<Blob, 'size'>;
}

export type PhotoEnvelopeViolation = 'photo_size' | 'photo_count' | 'aggregate_size';

export function photoEnvelopeViolation(
  photos: readonly PhotoEnvelopeItem[],
): PhotoEnvelopeViolation | undefined {
  if (photos.length > PHOTO_LIMITS.maxPhotoCount) return 'photo_count';
  let totalBytes = 0;
  for (const photo of photos) {
    if (photo.byteSize > PHOTO_LIMITS.maxPhotoBytes || photo.blob.size > PHOTO_LIMITS.maxPhotoBytes) {
      return 'photo_size';
    }
    totalBytes += photo.blob.size;
    if (totalBytes > PHOTO_LIMITS.maxTotalPhotoBytes) return 'aggregate_size';
  }
  return undefined;
}
