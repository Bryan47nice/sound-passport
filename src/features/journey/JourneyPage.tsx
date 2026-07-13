import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GuardedLink } from '../../app/navigationGuard';
import {
  useInvalidateRepositoryQueries,
  useJourneyRepository,
  useOptionalJourneyEditorRepository,
  useRepositoryRevision,
} from '../../data/RepositoryContext';
import { formatLocalDateTime } from '../../domain/dateTime';
import type { JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { AccessibleDialog } from '../studio/AccessibleDialog';

export function JourneyPage() {
  const { journeyId = '' } = useParams();
  const navigate = useNavigate();
  const repository = useJourneyRepository();
  const editor = useOptionalJourneyEditorRepository();
  const repositoryRevision = useRepositoryRevision();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const [story, setStory] = useState<JourneyStory>();
  const [loaded, setLoaded] = useState(false);
  const [resolvedJourneyId, setResolvedJourneyId] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deletePendingRef = useRef(false);
  const deleteDescriptionId = useId();

  useEffect(() => {
    let isCurrent = true;
    setStory(undefined);
    setLoaded(false);

    void repository.getJourneyStory(journeyId).then((value) => {
      if (isCurrent) {
        setStory(value);
        setResolvedJourneyId(journeyId);
        setLoaded(true);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [journeyId, repository, repositoryRevision]);

  if (!loaded || resolvedJourneyId !== journeyId) return <section className="page" aria-label="載入旅程" />;
  if (!story) return <section className="page empty-state"><h1>找不到這趟旅程</h1></section>;

  const canManage = story.journey.source === 'private' && editor !== undefined;
  const deleteJourney = async () => {
    if (!canManage || deletePendingRef.current) return;
    deletePendingRef.current = true;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await editor.deleteJourney(story.journey.id);
      invalidateQueries();
      navigate('/studio');
    } catch {
      setDeleteError('無法刪除旅程，資料仍完整保留，請再試一次。');
    } finally {
      deletePendingRef.current = false;
      setDeleteBusy(false);
    }
  };

  return (
    <section className="page">
      <p className="eyebrow">{story.journey.countryName} · {story.journey.startDate}</p>
      <h1 className="page-title">{story.journey.title}</h1>
      <p className="journey-detail-summary">{story.journey.summary || '尚未填寫旅程總文。'}</p>
      <div className="journey-detail-actions">
        <GuardedLink className="primary-command" to={`/journeys/${story.journey.id}/play`}>播放這趟旅程</GuardedLink>
        {canManage && (
          <>
            <GuardedLink className="secondary-command" to={`/studio/journeys/${story.journey.id}`}>
              <Pencil size={17} aria-hidden="true" />編輯旅程
            </GuardedLink>
            <button
              className="destructive-command"
              type="button"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={17} aria-hidden="true" />刪除旅程
            </button>
          </>
        )}
      </div>
      <ol className="moment-list">
        {story.moments.map((moment) => (
          <li className="moment-row" key={moment.id}>
            <span className="moment-number">{String(moment.sortOrder + 1).padStart(2, '0')}</span>
            <JourneyPhoto
              className="moment-thumb"
              photoAssetId={moment.photoAssetId}
              fixtureUrl={moment.photoUrl}
              alt={moment.photoAlt}
            />
            <span className="moment-details">
              <strong>{moment.cityLabel} · {moment.placeLabel}</strong>
              <small>{formatLocalDateTime(moment.localDate, moment.localTime)} · {moment.song.title} · {moment.song.artist}</small>
            </span>
            <div className="moment-narrative">
              <p>{moment.caption || '尚未填寫時刻文案。'}</p>
              <small>{moment.reason || '旅後待補'}</small>
            </div>
          </li>
        ))}
      </ol>
      {canManage && (
        <AccessibleDialog
          className="delete-journey-dialog"
          descriptionId={deleteDescriptionId}
          onDismiss={() => { if (!deleteBusy) setDeleteOpen(false); }}
          open={deleteOpen}
          title={`刪除「${story.journey.title}」？`}
        >
          <p id={deleteDescriptionId}>這趟旅程的所有時刻與照片也會一起刪除，且無法復原。</p>
          {deleteError && <p className="field-error" role="alert">{deleteError}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>取消</button>
            <button
              className="destructive-command"
              type="button"
              disabled={deleteBusy}
              onClick={() => void deleteJourney()}
            >
              {deleteBusy ? '刪除中' : '確認刪除旅程'}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </section>
  );
}
