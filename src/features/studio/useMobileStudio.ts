import { useEffect, useState } from 'react';

const mobileStudioQuery = '(max-width: 640px)';

export function useMobileStudio() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia?.(mobileStudioQuery).matches ?? false,
  );

  useEffect(() => {
    const media = window.matchMedia?.(mobileStudioQuery);
    if (!media) return;

    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}
