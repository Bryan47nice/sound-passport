function isApprovedYouTubeHost(hostname: string): boolean {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
}

function videoIdFromPath(pathname: string): string | undefined {
  return pathname.split('/').filter(Boolean)[0] || undefined;
}

export function parseYouTubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !isApprovedYouTubeHost(url.hostname)) return undefined;

    if (url.hostname === 'youtu.be') return videoIdFromPath(url.pathname);
    if (url.pathname === '/watch') return url.searchParams.get('v') || undefined;

    const [kind, videoId] = url.pathname.split('/').filter(Boolean);
    return kind === 'shorts' || kind === 'embed' ? videoId || undefined : undefined;
  } catch {
    return undefined;
  }
}

export function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=0&playsinline=1`;
}
