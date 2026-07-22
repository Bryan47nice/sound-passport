import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectPhoto } from './photoInspector';

describe('inspectPhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses orientation-aware browser decoding and always closes the bitmap', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn().mockResolvedValue({ width: 1200, height: 800, close });
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

    await expect(inspectPhoto(blob)).resolves.toEqual({ width: 1200, height: 800 });
    expect(createImageBitmap).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports a decode failure without manufacturing dimensions', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('synthetic decode failure')));

    await expect(inspectPhoto(new Blob(['bad'], { type: 'image/jpeg' }))).rejects.toThrow('decode');
  });
});
