import { useEffect, useState } from 'react';
import { usePhotoAssetRepository } from '../data/RepositoryContext';
import type { PhotoAssetRepository } from '../data/ports';

function useOptionalPhotoAssetRepository(): PhotoAssetRepository | undefined {
  try {
    return usePhotoAssetRepository();
  } catch {
    return undefined;
  }
}

export function usePhotoAssetUrl(photoAssetId?: string, fixtureUrl?: string): string | undefined {
  const photos = useOptionalPhotoAssetRepository();
  const [url, setUrl] = useState<string | undefined>(fixtureUrl);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;

    if (!photoAssetId || !photos) {
      setUrl(fixtureUrl);
      return () => {
        active = false;
      };
    }

    setUrl(undefined);
    void photos.getPhotoAsset(photoAssetId)
      .then((asset) => {
        if (!active || !asset) {
          if (active) setUrl(fixtureUrl);
          return;
        }

        const nextObjectUrl = URL.createObjectURL(asset.blob);
        if (!active) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }

        objectUrl = nextObjectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setUrl(fixtureUrl);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fixtureUrl, photoAssetId, photos]);

  return url;
}
