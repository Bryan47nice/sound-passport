import { CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { experiencePath, useJourneyExperience } from '../../app/JourneyExperienceContext';
import { GuardedLink, useGuardedNavigate, useRouteCommandGuard } from '../../app/navigationGuard';
import {
  useInvalidateRepositoryQueries,
  useOptionalJourneyEditorRepository,
  useRepositoryRevision,
} from '../../data/RepositoryContext';
import { storageWriteFailureMessage } from '../../data/storageErrors';
import { formatLocalDateTime } from '../../domain/dateTime';
import type { JourneyStory, NormalizedPhotoInput } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { normalizePhoto } from '../../media/photoNormalizer';
import { AccessibleDialog } from '../studio/AccessibleDialog';
import { useMobileStudio } from '../studio/useMobileStudio';

type JourneyLoadState =
  | { kind: 'loading'; journeyId: string }
  | { kind: 'ready'; journeyId: string; story: JourneyStory | undefined }
  | { kind: 'error'; journeyId: string };

type FixturePhotoPreparer = (photoUrl: string, fileStem: string) => Promise<NormalizedPhotoInput>;

interface JourneyPageProps {
  prepareFixturePhoto?: FixturePhotoPreparer;
}

async function prepareRemoteFixturePhoto(photoUrl: string, fileStem: string) {
  const response = await fetch(photoUrl);
  if (!response.ok) throw new Error(`Fixture photo request failed with ${response.status}.`);

  const blob = await response.blob();
  const contentType = blob.type || response.headers.get('content-type')?.split(';')[0] || '';
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return normalizePhoto(new File([blob], `${fileStem}.${extension}`, { type: contentType }));
}

export function JourneyPage({ prepareFixturePhoto = prepareRemoteFixturePhoto }: JourneyPageProps = {}) {
  const { journeyId = '' } = useParams();
  const navigate = useGuardedNavigate();
  const routeCommand = useRouteCommandGuard();
  const { kind, repository, routePrefix } = useJourneyExperience();
  const editor = useOptionalJourneyEditorRepository();
  const isMobile = useMobileStudio();
  const repositoryRevision = useRepositoryRevision();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const [loadState, setLoadState] = useState<JourneyLoadState>(() => ({
    kind: 'loading',
    journeyId,
  }));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState('');
  const deletePendingRef = useRef(false);
  const copyPendingRef = useRef(false);
  const deleteDescriptionId = useId();

  useEffect(() => {
    let isCurrent = true;
    setLoadState({ kind: 'loading', journeyId });

    void repository.getJourneyStory(journeyId)
      .then((story) => {
        if (isCurrent) setLoadState({ kind: 'ready', journeyId, story });
      })
      .catch(() => {
        if (isCurrent) setLoadState({ kind: 'error', journeyId });
      });

    return () => {
      isCurrent = false;
    };
  }, [journeyId, repository, repositoryRevision]);

  const currentState = loadState.journeyId === journeyId
    ? loadState
    : { kind: 'loading', journeyId } as const;
  if (currentState.kind === 'loading') return <section className="page" aria-label="載入旅程" />;
  if (currentState.kind === 'error') {
    return (
      <section className="page empty-state" role="alert">
        <h1>{kind === 'private' ? '無法讀取私人資料' : '無法讀取旅程'}</h1>
        <p>私人旅程資料暫時無法讀取，請重新讀取。</p>
        <button className="secondary-command" type="button" onClick={invalidateQueries}>重新讀取</button>
      </section>
    );
  }

  const { story } = currentState;
  if (!story) return <section className="page empty-state"><h1>找不到這趟旅程</h1></section>;

  const canManage = story.journey.source === 'private' && editor !== undefined;
  const createJourneyCopy = editor?.createJourneyCopy;
  const canCopy = story.journey.source === 'fixture' && createJourneyCopy !== undefined && !isMobile;
  const copyFixtureJourney = async () => {
    if (!canCopy || !createJourneyCopy || copyPendingRef.current) return;

    const command = routeCommand.capture();
    copyPendingRef.current = true;
    setCopyBusy(true);
    setCopyError('');

    try {
      const preparedPhotos = await Promise.all(story.moments.map((moment, index) => {
        if (!moment.photoUrl) throw new Error(`Fixture moment ${moment.id} has no photo URL.`);
        return prepareFixturePhoto(
          moment.photoUrl,
          `${story.journey.id}-${String(index + 1).padStart(2, '0')}`,
        );
      }));
      const createdJourney = await createJourneyCopy({
        title: `${story.journey.title}（副本）`,
        countryCode: story.journey.countryCode,
        countryName: story.journey.countryName,
        countryCoordinates: [...story.journey.countryCoordinates] as [number, number],
        cityLabels: [...story.journey.cityLabels],
        startDate: story.journey.startDate,
        endDate: story.journey.endDate,
        summary: story.journey.summary,
      }, story.moments, preparedPhotos);

      invalidateQueries();
      if (routeCommand.isCurrent(command)) navigate(`/studio/journeys/${createdJourney.id}`);
    } catch (error) {
      if (routeCommand.isCurrent(command)) {
        setCopyError(storageWriteFailureMessage(error, '無法複製示範旅程，請稍後再試。'));
      }
    } finally {
      copyPendingRef.current = false;
      setCopyBusy(false);
    }
  };
  const deleteJourney = async () => {
    if (!canManage || deletePendingRef.current) return;
    const command = routeCommand.capture();
    deletePendingRef.current = true;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await editor.deleteJourney(story.journey.id);
      invalidateQueries();
      if (routeCommand.isCurrent(command)) navigate('/studio');
    } catch {
      if (routeCommand.isCurrent(command)) {
        setDeleteError('無法刪除旅程，資料仍完整保留，請再試一次。');
      }
    } finally {
      deletePendingRef.current = false;
      setDeleteBusy(false);
    }
  };

  return (
    <section className="page">
      <div className="journey-detail-kicker">
        <p className="eyebrow">{story.journey.countryName} · {story.journey.startDate}</p>
        {story.journey.source === 'fixture' && <span className="journey-kind-badge">示範旅程</span>}
      </div>
      <h1 className="page-title">{story.journey.title}</h1>
      <p className="journey-detail-summary">{story.journey.summary || '尚未填寫旅程總文。'}</p>
      <div className="journey-detail-actions">
        <GuardedLink className="primary-command" to={experiencePath(routePrefix, `/journeys/${story.journey.id}/play`)}>播放這趟旅程</GuardedLink>
        {canCopy && (
          <button
            className="secondary-command"
            type="button"
            disabled={copyBusy}
            onClick={() => void copyFixtureJourney()}
          >
            <CopyPlus size={17} aria-hidden="true" />{copyBusy ? '複製中…' : '複製成我的旅程'}
          </button>
        )}
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
      {copyError && <p className="journey-copy-error field-error" role="alert">{copyError}</p>}
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
