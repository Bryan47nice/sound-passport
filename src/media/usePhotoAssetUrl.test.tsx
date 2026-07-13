import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { PhotoAssetRepository } from '../data/ports';
import { usePhotoAssetUrl } from './usePhotoAssetUrl';

const asset = {
  id: 'photo-1',
  blob: new Blob(['photo'], { type: 'image/webp' }),
  contentType: 'image/webp',
  originalFileName: 'photo.webp',
  width: 100,
  height: 50,
  byteSize: 5,
  createdAt: '2026-07-13T00:00:00Z',
};

function wrapper(photos?: PhotoAssetRepository) {
  return function RepositoryWrapper({ children }: PropsWithChildren) {
    return <RepositoryProvider services={{ query: {} as never, photos }}>{children}</RepositoryProvider>;
  };
}

describe('usePhotoAssetUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses fixture URLs when the private photo service is absent', () => {
    const { result } = renderHook(() => usePhotoAssetUrl(undefined, 'https://example.com/fixture.jpg'), { wrapper: wrapper() });

    expect(result.current).toBe('https://example.com/fixture.jpg');
  });

  it('revokes each private object URL when the asset changes and on unmount', async () => {
    const photos: PhotoAssetRepository = { getPhotoAsset: vi.fn().mockResolvedValue(asset) };
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const { result, rerender, unmount } = renderHook(
      ({ photoAssetId }) => usePhotoAssetUrl(photoAssetId),
      { initialProps: { photoAssetId: 'photo-1' }, wrapper: wrapper(photos) },
    );

    await waitFor(() => expect(result.current).toBe('blob:one'));
    rerender({ photoAssetId: 'photo-2' });
    await waitFor(() => expect(result.current).toBe('blob:two'));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one');

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:two');
  });

  it('does not create an object URL for a stale asset resolution', async () => {
    let resolveAsset!: (value: typeof asset | undefined) => void;
    const photos: PhotoAssetRepository = {
      getPhotoAsset: vi.fn(() => new Promise<typeof asset | undefined>((resolve) => { resolveAsset = resolve; })),
    };
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const { rerender } = renderHook<string | undefined, { photoAssetId?: string }>(
      ({ photoAssetId }: { photoAssetId?: string }) => usePhotoAssetUrl(photoAssetId, 'https://example.com/fixture.jpg'),
      { initialProps: { photoAssetId: 'photo-1' }, wrapper: wrapper(photos) },
    );

    rerender({ photoAssetId: undefined });
    await act(async () => resolveAsset(asset));

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
