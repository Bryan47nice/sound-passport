import type { SongReference } from '../../domain/model';
import { buildYouTubeEmbedUrl, isValidYouTubeVideoId, parseYouTubeVideoId } from '../../domain/youtube';

interface YouTubeEmbedProps {
  song: SongReference;
}

export function YouTubeEmbed({ song }: YouTubeEmbedProps) {
  const providerVideoId = isValidYouTubeVideoId(song.providerItemId) ? song.providerItemId : undefined;
  const sourceVideoId = song.sourceUrl ? parseYouTubeVideoId(song.sourceUrl) : undefined;
  const videoId = song.provider === 'youtube' ? providerVideoId ?? sourceVideoId : undefined;

  if (videoId) {
    return (
      <iframe
        title="YouTube player"
        src={buildYouTubeEmbedUrl(videoId)}
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
      />
    );
  }

  return (
    <div className="song-fallback">
      <strong>{song.title}</strong>
      <span>{song.artist}</span>
      {song.sourceUrl && <a href={song.sourceUrl} target="_blank" rel="noreferrer">開啟歌曲來源</a>}
    </div>
  );
}
