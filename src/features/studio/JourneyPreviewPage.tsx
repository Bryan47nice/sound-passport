import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GuardedLink } from '../../app/navigationGuard';
import {
  useInvalidateRepositoryQueries,
  useOptionalJourneyEditorRepository,
  usePrivateStorageError,
  useRepositoryRevision,
} from '../../data/RepositoryContext';
import {
  JourneyStatusTransitionError,
  JourneyValidationError,
  JourneyVersionConflictError,
} from '../../data/ports';
import { formatLocalDateTime } from '../../domain/dateTime';
import { validateJourneyForReview } from '../../domain/journeyValidation';
import type { JourneyStory, SongReference } from '../../domain/model';
import { isValidYouTubeVideoId, parseYouTubeVideoId } from '../../domain/youtube';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { YouTubeEmbed } from '../player/YouTubeEmbed';
import { CompletionDialog } from './CompletionDialog';
import { formatJourneyValidationIssue } from './journeyValidationPresentation';
import { useMobileStudio } from './useMobileStudio';

type LoadState =
  | { kind: 'loading'; journeyId: string }
  | { kind: 'ready'; journeyId: string; story: JourneyStory }
  | { kind: 'not-found'; journeyId: string }
  | { kind: 'error'; journeyId: string };

function canEmbed(song: SongReference) {
  if (song.provider !== 'youtube') return false;
  return isValidYouTubeVideoId(song.providerItemId) || Boolean(song.sourceUrl && parseYouTubeVideoId(song.sourceUrl));
}

export function JourneyPreviewPage() {
  const { journeyId = '' } = useParams();
  const navigate = useNavigate();
  const editor = useOptionalJourneyEditorRepository();
  const privateStorageError = usePrivateStorageError();
  const repositoryRevision = useRepositoryRevision();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const isMobile = useMobileStudio();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>(() => ({ kind: 'loading', journeyId }));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [completionBusy, setCompletionBusy] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const journeyIdRef = useRef(journeyId);
  journeyIdRef.current = journeyId;

  useEffect(() => {
    if (!editor) return;
    let active = true;
    setLoadState({ kind: 'loading', journeyId });
    void editor.getPrivateJourneyStory(journeyId).then(
      (story) => {
        if (!active) return;
        setLoadState(story
          ? { kind: 'ready', journeyId, story }
          : { kind: 'not-found', journeyId });
      },
      () => {
        if (active) setLoadState({ kind: 'error', journeyId });
      },
    );
    return () => { active = false; };
  }, [editor, journeyId, loadAttempt, repositoryRevision]);

  const currentState: LoadState = loadState.journeyId === journeyId
    ? loadState
    : { kind: 'loading', journeyId };
  const validation = useMemo(() => currentState.kind === 'ready'
    ? validateJourneyForReview(currentState.story)
    : undefined, [currentState]);

  if (isMobile) {
    return <section className="page studio-guidance"><h1 className="page-title">請使用電腦整理旅程</h1></section>;
  }
  if (!editor) {
    return (
      <section className="page studio-editor-state">
        <h1>本機儲存空間暫時無法使用</h1>
        <p>{privateStorageError ?? '請確認瀏覽器允許本機儲存後重新開啟。'}</p>
      </section>
    );
  }
  if (currentState.kind === 'loading') {
    return <section className="page studio-editor-state" aria-label="載入旅程預覽" />;
  }
  if (currentState.kind === 'not-found') {
    return <section className="page empty-state"><h1>找不到這趟私人旅程</h1></section>;
  }
  if (currentState.kind === 'error') {
    return (
      <section className="page studio-editor-state" role="alert">
        <h1>無法載入旅程預覽</h1>
        <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重新載入</button>
      </section>
    );
  }

  const { story } = currentState;
  const completeJourney = async () => {
    if (completionBusy || story.journey.status !== 'review' || !validation?.valid) return;
    const targetJourneyId = story.journey.id;
    setCompletionBusy(true);
    setCompletionError('');
    try {
      await editor.setJourneyStatus(targetJourneyId, 'complete', {
        expectedUpdatedAt: story.journey.updatedAt,
      });
      invalidateQueries();
      if (journeyIdRef.current === targetJourneyId) navigate(`/journeys/${targetJourneyId}`);
    } catch (error) {
      if (journeyIdRef.current !== targetJourneyId) return;
      if (error instanceof JourneyVersionConflictError) {
        setCompletionError('旅程內容已更新，請重新載入後再完成。');
      } else if (error instanceof JourneyValidationError) {
        setCompletionError('旅程已不符合完成條件，請返回編輯器修正必填欄位。');
      } else if (error instanceof JourneyStatusTransitionError) {
        setCompletionError('旅程狀態已變更，請重新載入後再完成。');
      } else {
        setCompletionError('無法完成旅程，請再試一次。');
      }
    } finally {
      if (journeyIdRef.current === targetJourneyId) setCompletionBusy(false);
    }
  };

  return (
    <section className="page journey-preview-page">
      <header className="journey-preview-header">
        <div>
          <p className="eyebrow">{story.journey.countryName} · 旅程預覽</p>
          <h1 className="page-title">{story.journey.title}</h1>
          <p className="muted">{story.journey.startDate} 至 {story.journey.endDate}</p>
        </div>
        <div className="journey-preview-actions">
          <GuardedLink className="secondary-command" to={`/studio/journeys/${story.journey.id}`}>返回編輯</GuardedLink>
          {story.journey.status === 'review' && validation?.valid && (
            <button className="primary-command" type="button" onClick={() => setDialogOpen(true)}>完成旅程</button>
          )}
          {story.journey.status === 'complete' && (
            <GuardedLink className="primary-command" to={`/journeys/${story.journey.id}`}>查看已完成旅程</GuardedLink>
          )}
        </div>
      </header>

      <section className="journey-preview-summary" aria-labelledby="journey-preview-summary-heading">
        <h2 id="journey-preview-summary-heading">旅程總文</h2>
        <p>{story.journey.summary || '尚未填寫旅程總文。'}</p>
      </section>

      {!validation?.valid && (
        <section className="journey-validation-summary" aria-labelledby="preview-validation-heading">
          <h2 id="preview-validation-heading">完成前需要修正</h2>
          <ul>{validation?.issues.map((issue) => (
            <li key={`${issue.field}:${issue.code}`}>{formatJourneyValidationIssue(issue)}</li>
          ))}</ul>
        </section>
      )}

      <ol className="journey-preview-moments" aria-label="旅程時刻">
        {story.moments.map((moment, index) => (
          <li key={moment.id} className="journey-preview-moment">
            <figure className="journey-preview-visual">
              <JourneyPhoto
                alt={moment.photoAlt}
                className="journey-preview-photo"
                fixtureUrl={moment.photoUrl}
                photoAssetId={moment.photoAssetId}
              />
              <figcaption>{moment.cityLabel}{moment.placeLabel ? ` · ${moment.placeLabel}` : ''}</figcaption>
            </figure>
            <div className="journey-preview-copy">
              <span className="player-counter">{String(index + 1).padStart(2, '0')}</span>
              <time dateTime={moment.localDate}>{formatLocalDateTime(moment.localDate, moment.localTime)}</time>
              <p className="journey-preview-caption">{moment.caption || '尚未填寫時刻文案。'}</p>
              <div className="journey-preview-song">
                <strong>{moment.song.title}</strong>
                <span>{moment.song.artist}</span>
                {canEmbed(moment.song) ? (
                  <YouTubeEmbed song={moment.song} />
                ) : (
                  <p className="song-link-status">
                    {moment.song.sourceUrl?.trim() ? 'YouTube 連結無效' : '尚未連結 YouTube'}
                  </p>
                )}
              </div>
              <p className="journey-preview-reason">{moment.reason || '選歌原因待補。'}</p>
            </div>
          </li>
        ))}
      </ol>

      <CompletionDialog
        busy={completionBusy}
        error={completionError}
        journeyTitle={story.journey.title}
        open={dialogOpen}
        onCancel={() => {
          setDialogOpen(false);
          setCompletionError('');
        }}
        onConfirm={completeJourney}
      />
    </section>
  );
}
