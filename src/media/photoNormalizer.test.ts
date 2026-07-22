import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PhotoNormalizationError,
  normalizePhoto,
  validatePhotoFile,
} from './photoNormalizer';

function fileOfSize(size: number, type = 'image/jpeg') {
  return new File([new Uint8Array(size)], 'photo.jpg', { type });
}

function mockCanvas({
  hasTransparency = false,
  encodedBlob = new Blob(['image'], { type: 'image/webp' }),
}: { hasTransparency?: boolean; encodedBlob?: Blob | null } = {}) {
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(hasTransparency ? [0, 0, 0, 0] : [0, 0, 0, 255]) })),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(encodedBlob));
}

describe('validatePhotoFile', () => {
  it('rejects empty files as decode failures', () => {
    expect(() => validatePhotoFile(new File([], 'empty.jpg', { type: 'image/jpeg' })))
      .toThrowError(expect.objectContaining({ code: 'decode_failed' }));
  });

  it('rejects files exceeding 25 MiB', () => {
    expect(() => validatePhotoFile(fileOfSize(25 * 1024 * 1024 + 1)))
      .toThrowError(expect.objectContaining({ code: 'too_large' }));
  });

  it('accepts files at the 25 MiB boundary', () => {
    expect(() => validatePhotoFile(fileOfSize(25 * 1024 * 1024))).not.toThrow();
  });

  it('rejects non-image files', () => {
    expect(() => validatePhotoFile(new File(['x'], 'notes.txt', { type: 'text/plain' })))
      .toThrowError(expect.objectContaining({ code: 'unsupported_type' }));
  });

  it.each([
    ['capture.heic', 'image/heic'],
    ['capture.heif', 'image/heif'],
    ['capture.HEIC', 'image/jpeg'],
  ])('gives explicit JPEG or PNG conversion guidance for %s', (name, type) => {
    expect(() => validatePhotoFile(new File(['heic'], name, { type })))
      .toThrowError(expect.objectContaining({
        code: 'heic_unsupported',
        message: '目前不支援 HEIC 或 HEIF，請先轉換成 JPEG 或 PNG 再加入。',
      }));
  });
});

describe('normalizePhoto', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses EXIF-aware decoding, caps the long edge, and encodes opaque photos as WebP', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn().mockResolvedValue({ width: 4000, height: 2000, close });
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    mockCanvas();

    const normalized = await normalizePhoto(fileOfSize(1));

    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' });
    expect(normalized).toMatchObject({ contentType: 'image/webp', width: 2560, height: 1280 });
    expect(close).toHaveBeenCalledOnce();
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9);
  });

  it('does not upscale smaller photos', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1600, height: 1000, close: vi.fn() }));
    mockCanvas();

    const normalized = await normalizePhoto(fileOfSize(1));

    expect(normalized).toMatchObject({ width: 1600, height: 1000 });
  });

  it('preserves portrait orientation while resizing the long edge', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2000, height: 4000, close: vi.fn() }));
    mockCanvas();

    const normalized = await normalizePhoto(fileOfSize(1));

    expect(normalized).toMatchObject({ width: 1280, height: 2560 });
  });

  it('converts opaque PNG photos to WebP', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 50, close: vi.fn() }));
    mockCanvas();

    const normalized = await normalizePhoto(fileOfSize(1, 'image/png'));

    expect(normalized.contentType).toBe('image/webp');
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9);
  });

  it('retains PNG for transparent photos', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 50, close: vi.fn() }));
    mockCanvas({ hasTransparency: true, encodedBlob: new Blob(['image'], { type: 'image/png' }) });

    const normalized = await normalizePhoto(fileOfSize(1, 'image/png'));

    expect(normalized.contentType).toBe('image/png');
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('reports typed decode and encode errors and always closes decoded bitmaps', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad image')));
    await expect(normalizePhoto(fileOfSize(1))).rejects.toBeInstanceOf(PhotoNormalizationError);
    await expect(normalizePhoto(fileOfSize(1))).rejects.toMatchObject({ code: 'decode_failed' });

    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 50, close }));
    mockCanvas({ encodedBlob: null });
    await expect(normalizePhoto(fileOfSize(1))).rejects.toMatchObject({ code: 'encode_failed' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects mismatched encoded MIME types and closes the bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 50, close }));
    mockCanvas({ encodedBlob: new Blob(['image'], { type: 'image/png' }) });

    await expect(normalizePhoto(fileOfSize(1))).rejects.toMatchObject({ code: 'encode_failed' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('enforces the 25 MiB limit again after normalization', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 50, close }));
    const oversized = {
      size: 25 * 1024 * 1024 + 1,
      type: 'image/webp',
    } as Blob;
    mockCanvas({ encodedBlob: oversized });

    await expect(normalizePhoto(fileOfSize(1))).rejects.toMatchObject({ code: 'too_large' });
    expect(close).toHaveBeenCalledOnce();
  });
});
