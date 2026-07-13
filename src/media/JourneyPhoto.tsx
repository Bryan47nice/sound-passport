import { usePhotoAssetUrl } from './usePhotoAssetUrl';

interface JourneyPhotoProps {
  alt: string;
  className?: string;
  fixtureUrl?: string;
  photoAssetId?: string;
}

export function JourneyPhoto({ alt, className, fixtureUrl, photoAssetId }: JourneyPhotoProps) {
  const url = usePhotoAssetUrl(photoAssetId, fixtureUrl);

  return <img className={['journey-photo', className].filter(Boolean).join(' ')} src={url} alt={alt} />;
}
