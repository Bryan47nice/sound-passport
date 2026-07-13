import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useOptionalJourneyEditorRepository } from '../../data/RepositoryContext';
import type { JourneyEditorRepository } from '../../data/ports';
import { validateJourneyForReview } from '../../domain/journeyValidation';
import type { Journey, JourneyPatch, JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { JourneyDetailsForm } from './JourneyDetailsForm';
import { useAutosave } from './useAutosave';
import { useMobileStudio } from './useMobileStudio';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; story: JourneyStory }
  | { kind: 'not-found' }
  | { kind: 'error' };

type JourneyEditorPageProps = { onBootstrapRetry?: () => void };

const patchKeys: (keyof JourneyPatch)[] = [
  'title', 'countryCode', 'countryName', 'countryCoordinates', 'cityLabels',
  'startDate', 'endDate', 'summary', 'coverPhotoAssetId', 'status',
];

function sameValue(left: Journey[keyof Journey], right: Journey[keyof Journey]) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function createJourneyPatch(saved: Journey, draft: Journey): JourneyPatch {
  const patch: JourneyPatch = {};
  for (const key of patchKeys) {
    if (!sameValue(saved[key], draft[key])) {
      Object.assign(patch, { [key]: draft[key] });
    }
  }
  return patch;
}

function formatSavedTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function SaveStatus({ state, savedAt, onRetry }: {
  state: ReturnType<typeof useAutosave<Journey>>['state'];
  savedAt?: Date;
  onRetry: () => void;
}) {
  const text = state === 'saving'
    ? '儲存中'
    : state === 'saved' && savedAt
      ? `已儲存 ${formatSavedTime(savedAt)}`
      : state === 'error'
        ? '儲存失敗'
        : '尚未變更';

  return (
    <div className="journey-save-status">
      <span>{text}</span>
      {state === 'error' && <button type="button" onClick={onRetry}>重試儲存</button>}
    </div>
  );
}

function JourneyEditorWorkspace({ editor, story }: { editor: JourneyEditorRepository; story: JourneyStory }) {
  const [draft, setDraft] = useState(story.journey);
  const [textSaveValue, setTextSaveValue] = useState(story.journey);
  const [dateError, setDateError] = useState('');
  const [demotionNotice, setDemotionNotice] = useState('');
  const draftRef = useRef(story.journey);
  const savedRef = useRef(story.journey);

  const save = useCallback(async (candidate: Journey) => {
    const patch = createJourneyPatch(savedRef.current, candidate);
    if (Object.keys(patch).length === 0) return;

    let demoted = false;
    if (savedRef.current.status === 'complete') {
      const pendingJourney = { ...savedRef.current, ...patch };
      if (!validateJourneyForReview({ journey: pendingJourney, moments: story.moments }).valid) {
        patch.status = 'review';
        demoted = true;
      }
    }

    const updated = await editor.updateJourney(story.journey.id, patch);
    savedRef.current = updated;
    if (demoted) {
      draftRef.current = { ...draftRef.current, status: 'review' };
      setDraft(draftRef.current);
      setDemotionNotice('必要資料已移除，旅程已回到待整理');
    }
  }, [editor, story.journey.id, story.moments]);

  const autosave = useAutosave({ value: textSaveValue, save, delay: 500 });

  const applyDraft = (patch: JourneyPatch) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    return next;
  };

  const handleTextChange = (patch: JourneyPatch) => {
    setTextSaveValue(applyDraft(patch));
  };

  const handleImmediateChange = (patch: JourneyPatch) => {
    const next = applyDraft(patch);
    autosave.saveNow(next);
  };

  const handleDateChange = (field: 'startDate' | 'endDate', value: string) => {
    const candidate = { ...draftRef.current, [field]: value };
    if (candidate.startDate && candidate.endDate && candidate.endDate < candidate.startDate) {
      setDateError('結束日期不得早於開始日期');
      return;
    }
    setDateError('');
    handleImmediateChange({ [field]: value });
  };

  const previewMoment = story.moments[0];

  return (
    <section className="journey-editor-page">
      <header className="journey-editor-header">
        <div>
          <p className="eyebrow">{draft.countryName} · {draft.startDate} 至 {draft.endDate}</p>
          <h1>{draft.title || '未命名旅程'}</h1>
        </div>
        <div className="journey-editor-meta">
          <span className={`journey-status journey-status-${draft.status}`}>{draft.status === 'complete' ? '已完成' : draft.status === 'review' ? '待整理' : '草稿'}</span>
          <SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />
          <span className="visually-hidden" aria-live="assertive">{autosave.errorAnnouncement}</span>
        </div>
      </header>
      {demotionNotice && <p className="journey-demotion-notice" role="status">{demotionNotice}</p>}
      <div className="journey-editor-workspace">
        <section className="journey-moment-list" aria-label="時刻清單">
          <div className="journey-region-heading"><h2>時刻</h2><span>{story.moments.length}</span></div>
          {story.moments.length === 0 ? (
            <p className="muted">尚無時刻</p>
          ) : (
            <ol>
              {story.moments.map((moment, index) => (
                <li key={moment.id} className={index === 0 ? 'is-current' : undefined}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{moment.song.title}</strong><small>{moment.cityLabel || moment.localDate}</small></div>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="journey-moment-preview" aria-label="時刻預覽">
          {previewMoment ? (
            <JourneyPhoto
              alt={previewMoment.photoAlt}
              className="journey-editor-preview-image"
              fixtureUrl={previewMoment.photoUrl}
              photoAssetId={previewMoment.photoAssetId}
            />
          ) : <p>選取時刻後在此預覽</p>}
        </section>
        <section className="journey-details-region" aria-label="旅程資料">
          <div className="journey-region-heading"><h2>旅程資料</h2></div>
          <JourneyDetailsForm
            draft={draft}
            dateError={dateError}
            onTextChange={handleTextChange}
            onImmediateChange={handleImmediateChange}
            onDateChange={handleDateChange}
          />
        </section>
      </div>
    </section>
  );
}

export function JourneyEditorPage({ onBootstrapRetry = () => window.location.reload() }: JourneyEditorPageProps) {
  const { journeyId = '' } = useParams();
  const editor = useOptionalJourneyEditorRepository();
  const isMobile = useMobileStudio();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!editor || isMobile) return;
    let active = true;
    setLoadState({ kind: 'loading' });
    void editor.getPrivateJourneyStory(journeyId)
      .then((nextStory) => {
        if (!active) return;
        setLoadState(nextStory ? { kind: 'ready', story: nextStory } : { kind: 'not-found' });
      })
      .catch(() => {
        if (active) setLoadState({ kind: 'error' });
      });
    return () => { active = false; };
  }, [editor, isMobile, journeyId, loadAttempt]);

  if (isMobile) return <section className="studio-mobile-only"><h1>請使用電腦整理旅程</h1></section>;

  if (!editor) {
    return (
      <section className="page studio-guidance">
        <h1 className="page-title">本機儲存空間暫時無法使用</h1>
        <button className="secondary-command studio-state-action" type="button" onClick={onBootstrapRetry}>重新嘗試</button>
      </section>
    );
  }

  if (loadState.kind === 'loading') return <section className="page studio-editor-state"><p>正在載入旅程…</p></section>;
  if (loadState.kind === 'not-found') return <section className="page studio-editor-state"><h1>找不到這趟私人旅程</h1></section>;
  if (loadState.kind === 'error') {
    return (
      <section className="page studio-editor-state" role="alert">
        <h1>無法載入旅程</h1>
        <button className="secondary-command studio-state-action" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          <RefreshCw size={17} aria-hidden="true" />重新載入
        </button>
      </section>
    );
  }

  return <JourneyEditorWorkspace key={loadState.story.journey.id} editor={editor} story={loadState.story} />;
}
