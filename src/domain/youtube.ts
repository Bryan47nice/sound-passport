function isApprovedYouTubeHost(hostname: string): boolean {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
}

export function isValidYouTubeVideoId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function videoIdFromPath(pathname: string): string | undefined {
  const videoId = pathname.split('/').filter(Boolean)[0];
  return isValidYouTubeVideoId(videoId) ? videoId : undefined;
}

export function parseYouTubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !isApprovedYouTubeHost(url.hostname)) return undefined;

    if (url.hostname === 'youtu.be') return videoIdFromPath(url.pathname);
    if (url.pathname === '/watch') {
      const videoId = url.searchParams.get('v') ?? undefined;
      return isValidYouTubeVideoId(videoId) ? videoId : undefined;
    }

    const [kind, videoId] = url.pathname.split('/').filter(Boolean);
    return (kind === 'shorts' || kind === 'embed') && isValidYouTubeVideoId(videoId) ? videoId : undefined;
  } catch {
    return undefined;
  }
}

export function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=0&playsinline=1`;
}
