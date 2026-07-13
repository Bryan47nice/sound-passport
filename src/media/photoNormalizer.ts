import type { NormalizedPhotoInput } from '../domain/model';

export const MAX_PHOTO_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_PHOTO_EDGE = 2560;

export type PhotoNormalizationErrorCode =
  | 'too_large'
  | 'unsupported_type'
  | 'decode_failed'
  | 'encode_failed';

export class PhotoNormalizationError extends Error {
  readonly code: PhotoNormalizationErrorCode;

  constructor(code: PhotoNormalizationErrorCode) {
    const messages: Record<PhotoNormalizationErrorCode, string> = {
      too_large: '照片檔案超過 25 MiB 上限。',
      unsupported_type: '請選擇可支援的圖片檔案。',
      decode_failed: '無法讀取這張照片，請改用其他圖片檔案。',
      encode_failed: '無法處理這張照片，請稍後再試。',
    };
    super(messages[code]);
    this.name = 'PhotoNormalizationError';
    this.code = code;
  }
}

export function validatePhotoFile(file: File): void {
  if (file.size === 0) throw new PhotoNormalizationError('decode_failed');
  if (file.size > MAX_PHOTO_INPUT_BYTES) throw new PhotoNormalizationError('too_large');
  if (!file.type.startsWith('image/')) throw new PhotoNormalizationError('unsupported_type');
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

function encodeCanvas(canvas: HTMLCanvasElement, contentType: 'image/png' | 'image/webp'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const callback: BlobCallback = (blob) => {
        if (blob) resolve(blob);
        else reject(new PhotoNormalizationError('encode_failed'));
      };
      if (contentType === 'image/webp') canvas.toBlob(callback, contentType, 0.9);
      else canvas.toBlob(callback, contentType);
    } catch {
      reject(new PhotoNormalizationError('encode_failed'));
    }
  });
}

export async function normalizePhoto(file: File): Promise<NormalizedPhotoInput> {
  validatePhotoFile(file);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoNormalizationError('decode_failed');
  }

  try {
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoNormalizationError('encode_failed');

    context.drawImage(bitmap, 0, 0, width, height);
    const contentType = hasTransparency(context, width, height) ? 'image/png' : 'image/webp';
    const blob = await encodeCanvas(canvas, contentType);

    return {
      blob,
      contentType,
      originalFileName: file.name,
      width,
      height,
      byteSize: blob.size,
    };
  } catch (error) {
    if (error instanceof PhotoNormalizationError) throw error;
    throw new PhotoNormalizationError('encode_failed');
  } finally {
    bitmap.close();
  }
}
