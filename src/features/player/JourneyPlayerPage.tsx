import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { GuardedLink } from '../../app/navigationGuard';
import { useJourneyRepository } from '../../data/RepositoryContext';
import { formatLocalDateTime } from '../../domain/dateTime';
import type { JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { YouTubeEmbed } from './YouTubeEmbed';

export function JourneyPlayerPage() {
  const { journeyId = '' } = useParams();
  const repository = useJourneyRepository();
  const [story, setStory] = useState<JourneyStory>();
  const [loaded, setLoaded] = useState(false);
  const [resolvedJourneyId, setResolvedJourneyId] = useState<string>();
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    setStory(undefined);
    setLoaded(false);
    setCurrentIndex(0);

    void repository.getJourneyStory(journeyId)
      .catch(() => undefined)
      .then((value) => {
        if (!isCurrent) return;
        setStory(value);
        setResolvedJourneyId(journeyId);
        setLoaded(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [journeyId, repository]);

  if (!loaded || resolvedJourneyId !== journeyId) return <section className="page" aria-label="載入播放器" />;
  if (!story) {
    return (
      <section className="page empty-state">
        <h1>找不到這趟旅程</h1>
        <GuardedLink className="primary-command" to="/">返回旅行地圖</GuardedLink>
      </section>
    );
  }

  const moment = story.moments[currentIndex];
  if (!moment) return <section className="page empty-state"><h1>這趟旅程沒有音樂時刻</h1></section>;

  const isFirstMoment = currentIndex === 0;
  const isLastMoment = currentIndex === story.moments.length - 1;

  return (
    <section className="page player-page">
      <p className="eyebrow">{story.journey.title}</p>
      <div className="player-stage">
        <figure className="player-visual">
          <JourneyPhoto
            className="player-photo"
            photoAssetId={moment.photoAssetId}
            fixtureUrl={moment.photoUrl}
            alt={moment.photoAlt}
          />
          <figcaption>{moment.cityLabel} · {moment.placeLabel}</figcaption>
        </figure>
        <div className="player-copy">
          <span className="player-counter">{currentIndex + 1} / {story.moments.length}</span>
          <time dateTime={moment.localDate}>{formatLocalDateTime(moment.localDate, moment.localTime)}</time>
          <h1>{moment.song.title}</h1>
          <p className="song-artist">{moment.song.artist}</p>
          <div className="player-song"><YouTubeEmbed song={moment.song} /></div>
          <p>{moment.reason || '旅後待補'}</p>
        </div>
      </div>
      <div className="player-controls">
        <button type="button" disabled={isFirstMoment} onClick={() => setCurrentIndex((value) => value - 1)}>上一個時刻</button>
        <button type="button" disabled={isLastMoment} onClick={() => setCurrentIndex((value) => value + 1)}>下一個時刻</button>
      </div>
    </section>
  );
}
