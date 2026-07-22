import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { experiencePath, useJourneyExperience, type JourneyExperienceValue } from '../../app/JourneyExperienceContext';
import { GuardedLink } from '../../app/navigationGuard';
import { usePrivateStorageError, useRepositoryRevision } from '../../data/RepositoryContext';
import { formatLocalDateTime } from '../../domain/dateTime';
import type { JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { YouTubeEmbed } from './YouTubeEmbed';

type PlayerLoadState =
  | { kind: 'loading'; journeyId: string; experience: JourneyExperienceValue; repositoryRevision: number; retryGeneration: number }
  | { kind: 'ready'; journeyId: string; experience: JourneyExperienceValue; repositoryRevision: number; retryGeneration: number; story: JourneyStory | undefined }
  | { kind: 'error'; journeyId: string; experience: JourneyExperienceValue; repositoryRevision: number; retryGeneration: number };

export function JourneyPlayerPage() {
  const { journeyId = '' } = useParams();
  const experience = useJourneyExperience();
  const { kind, repository, routePrefix } = experience;
  const repositoryRevision = useRepositoryRevision();
  const privateStorageError = usePrivateStorageError();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [loadState, setLoadState] = useState<PlayerLoadState>(() => ({
    kind: 'loading',
    journeyId,
    experience,
    repositoryRevision,
    retryGeneration,
  }));

  useEffect(() => {
    let isCurrent = true;
    setLoadState({ kind: 'loading', journeyId, experience, repositoryRevision, retryGeneration });
    setCurrentIndex(0);

    void repository.getJourneyStory(journeyId)
      .then((value) => {
        if (!isCurrent) return;
        setLoadState({
          kind: 'ready',
          journeyId,
          experience,
          repositoryRevision,
          retryGeneration,
          story: value,
        });
      })
      .catch(() => {
        if (!isCurrent) return;
        setLoadState({ kind: 'error', journeyId, experience, repositoryRevision, retryGeneration });
      });

    return () => { isCurrent = false; };
  }, [experience, journeyId, repository, repositoryRevision, retryGeneration]);

  if (kind === 'private' && privateStorageError) {
    return (
      <section className="page empty-state" role="alert">
        <h1>無法讀取私人資料</h1>
        <p>{privateStorageError}</p>
        <p>請重新整理頁面後再試一次。</p>
      </section>
    );
  }

  const currentState = loadState.journeyId === journeyId
    && loadState.experience === experience
    && loadState.repositoryRevision === repositoryRevision
    && loadState.retryGeneration === retryGeneration
    ? loadState
    : { kind: 'loading' } as const;

  if (currentState.kind === 'loading') return <section className="page" aria-label="載入播放器" />;
  if (currentState.kind === 'error') {
    return (
      <section className="page empty-state">
        <h1>{kind === 'private' ? '無法讀取私人資料' : '無法讀取旅程'}</h1>
        <button type="button" className="secondary-command" onClick={() => setRetryGeneration((value) => value + 1)}>重新讀取</button>
      </section>
    );
  }
  const { story } = currentState;
  if (!story) {
    return (
      <section className="page empty-state">
        <h1>找不到這趟旅程</h1>
        <GuardedLink className="primary-command" to={experiencePath(routePrefix, '')}>返回旅行地圖</GuardedLink>
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
          <JourneyPhoto className="player-photo" photoAssetId={moment.photoAssetId} fixtureUrl={moment.photoUrl} alt={moment.photoAlt} />
          <figcaption>{moment.cityLabel} · {moment.placeLabel}</figcaption>
        </figure>
        <div className="player-copy">
          <span className="player-counter">{currentIndex + 1} / {story.moments.length}</span>
          <time dateTime={moment.localDate}>{formatLocalDateTime(moment.localDate, moment.localTime)}</time>
          <h1>{moment.song.title}</h1>
          <p className="song-artist">{moment.song.artist}</p>
          <div className="player-song"><YouTubeEmbed song={moment.song} /></div>
          <p>{moment.reason || '暫無說明'}</p>
        </div>
      </div>
      <div className="player-controls">
        <button type="button" disabled={isFirstMoment} onClick={() => setCurrentIndex((value) => value - 1)}>上一個時刻</button>
        <button type="button" disabled={isLastMoment} onClick={() => setCurrentIndex((value) => value + 1)}>下一個時刻</button>
      </div>
    </section>
  );
}
