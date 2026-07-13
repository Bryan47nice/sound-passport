import { RefreshCw } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router';
import { useOptionalJourneyEditorRepository } from '../../data/RepositoryContext';
import { JourneyVersionConflictError, type JourneyEditorRepository } from '../../data/ports';
import { validateJourneyForReview } from '../../domain/journeyValidation';
import type { Journey, JourneyPatch, JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { JourneyDetailsForm } from './JourneyDetailsForm';
import {
  createJourneyPatchEnvelope,
  JourneyPatchConflictError,
  journeyPatchBaseMatches,
  mergeJourneyPatchEnvelopes,
  type JourneyPatchEnvelope,
  type JourneyUserPatch,
} from './journeyPatch';
import { useAutosave } from './useAutosave';
import { useDirtyNavigationGuard } from './useDirtyNavigationGuard';
import { useMobileStudio } from './useMobileStudio';

type LoadState =
  | { kind: 'loading'; journeyId: string }
  | { kind: 'ready'; journeyId: string; story: JourneyStory }
  | { kind: 'not-found'; journeyId: string }
  | { kind: 'error'; journeyId: string };

type JourneyEditorPageProps = { onBootstrapRetry?: () => void };
type AdjustablePanel = 'list' | 'details';

const panelLimits = {
  list: { min: 180, max: 340 },
  details: { min: 300, max: 480 },
} as const;
const panelStep = 16;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatSavedTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function SaveStatus({ autosave }: {
  autosave: ReturnType<typeof useAutosave<JourneyPatchEnvelope>>;
}) {
  const isConflict = autosave.error instanceof JourneyPatchConflictError;
  const text = autosave.state === 'saving'
    ? '儲存中'
    : autosave.state === 'saved' && autosave.savedAt
      ? `已儲存 ${formatSavedTime(autosave.savedAt)}`
      : autosave.state === 'error'
        ? isConflict ? '內容衝突' : '儲存失敗'
        : autosave.dirty ? '尚未儲存' : '尚未變更';

  return (
    <div className="journey-save-status">
      <span>{text}</span>
      {autosave.state === 'error' && (
        <button type="button" onClick={autosave.retry}>
          {isConflict ? '重試並套用' : '重試儲存'}
        </button>
      )}
    </div>
  );
}

function JourneyEditorWorkspace({ editor, story }: { editor: JourneyEditorRepository; story: JourneyStory }) {
  const [draft, setDraft] = useState(story.journey);
  const [dateError, setDateError] = useState('');
  const [demotionNotice, setDemotionNotice] = useState('');
  const [panelWidths, setPanelWidths] = useState({ list: 220, details: 340 });
  const draftRef = useRef(story.journey);
  const mountedRef = useRef(false);
  const dragRef = useRef<{
    panel: AdjustablePanel;
    pointerId: number;
    startX: number;
    startWidth: number;
  } | undefined>(undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const save = useCallback(async (
    envelope: JourneyPatchEnvelope,
    { isRetry }: { isRetry: boolean },
  ) => {
    const currentStory = await editor.getPrivateJourneyStory(story.journey.id);
    if (!currentStory) throw new Error('Journey is no longer available.');

    if (!isRetry && !journeyPatchBaseMatches(envelope, currentStory.journey)) {
      throw new JourneyPatchConflictError();
    }

    const repositoryPatch: JourneyPatch = { ...envelope.patch };
    let demoted = false;
    if (currentStory.journey.status === 'complete') {
      const candidate = { ...currentStory.journey, ...envelope.patch };
      if (!validateJourneyForReview({ journey: candidate, moments: currentStory.moments }).valid) {
        repositoryPatch.status = 'review';
        demoted = true;
      }
    }

    try {
      const updated = await editor.updateJourney(
        story.journey.id,
        repositoryPatch,
        { expectedUpdatedAt: currentStory.journey.updatedAt },
      );

      if (mountedRef.current && draftRef.current.status !== updated.status) {
        const nextDraft = { ...draftRef.current, status: updated.status };
        draftRef.current = nextDraft;
        setDraft(nextDraft);
      }
      if (demoted && mountedRef.current) {
        setDemotionNotice('必要資料已移除，旅程已回到待整理');
      }
    } catch (error) {
      if (!(error instanceof JourneyVersionConflictError)) throw error;
      try {
        const refreshed = await editor.getPrivateJourneyStory(story.journey.id);
        if (refreshed && mountedRef.current && draftRef.current.status !== refreshed.journey.status) {
          const nextDraft = { ...draftRef.current, status: refreshed.journey.status };
          draftRef.current = nextDraft;
          setDraft(nextDraft);
        }
      } catch {
        // Keep the field patch retryable even if the conflict refresh also fails.
      }
      throw new JourneyPatchConflictError();
    }
  }, [editor, story.journey.id]);

  const autosave = useAutosave({
    save,
    delay: 500,
    merge: mergeJourneyPatchEnvelopes,
  });
  useDirtyNavigationGuard({ dirty: autosave.dirty, flush: autosave.flush });

  const applyUserPatch = (patch: JourneyUserPatch, immediate: boolean) => {
    const envelope = createJourneyPatchEnvelope(draftRef.current, patch);
    const nextDraft: Journey = { ...draftRef.current, ...envelope.patch };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    if (immediate) autosave.saveNow(envelope);
    else autosave.enqueue(envelope);
  };

  const handleDateChange = (field: 'startDate' | 'endDate', value: string) => {
    const candidate = { ...draftRef.current, [field]: value };
    if (candidate.startDate && candidate.endDate && candidate.endDate < candidate.startDate) {
      setDateError('結束日期不得早於開始日期');
      return;
    }
    setDateError('');
    applyUserPatch({ [field]: value }, true);
  };

  const setPanelWidth = (panel: AdjustablePanel, value: number) => {
    const limits = panelLimits[panel];
    setPanelWidths((current) => ({
      ...current,
      [panel]: clamp(value, limits.min, limits.max),
    }));
  };

  const handleSeparatorKeyDown = (panel: AdjustablePanel, event: KeyboardEvent<HTMLDivElement>) => {
    const limits = panelLimits[panel];
    let nextWidth: number | undefined;
    if (event.key === 'Home') nextWidth = limits.min;
    if (event.key === 'End') nextWidth = limits.max;
    if (event.key === 'ArrowLeft') {
      nextWidth = panelWidths[panel] + (panel === 'details' ? panelStep : -panelStep);
    }
    if (event.key === 'ArrowRight') {
      nextWidth = panelWidths[panel] + (panel === 'details' ? -panelStep : panelStep);
    }
    if (nextWidth === undefined) return;
    event.preventDefault();
    setPanelWidth(panel, nextWidth);
  };

  const handleSeparatorPointerDown = (
    panel: AdjustablePanel,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    dragRef.current = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidths[panel],
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleSeparatorPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    setPanelWidth(drag.panel, drag.startWidth + (drag.panel === 'details' ? -delta : delta));
  };

  const handleSeparatorPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const previewMoment = story.moments[0];
  const workspaceStyle = {
    '--journey-list-width': `${panelWidths.list}px`,
    '--journey-details-width': `${panelWidths.details}px`,
  } as CSSProperties;
  const liveMessage = autosave.state === 'error'
    ? autosave.error instanceof JourneyPatchConflictError
      ? '其他位置已有更新。若要保留目前編輯，請重試並套用。'
      : autosave.errorAnnouncement
    : '';

  return (
    <section className="journey-editor-page">
      <header className="journey-editor-header">
        <div className="journey-editor-title">
          <p className="eyebrow">{draft.countryName} · {draft.startDate} 至 {draft.endDate}</p>
          <h1 title={draft.title || '未命名旅程'}>{draft.title || '未命名旅程'}</h1>
        </div>
        <div className="journey-editor-meta">
          <span className={`journey-status journey-status-${draft.status}`}>
            {draft.status === 'complete' ? '已完成' : draft.status === 'review' ? '待整理' : '草稿'}
          </span>
          <SaveStatus autosave={autosave} />
          <span className="visually-hidden" aria-live="assertive">{liveMessage}</span>
        </div>
      </header>
      {demotionNotice && <p className="journey-demotion-notice" role="status">{demotionNotice}</p>}
      <div className="journey-editor-workspace" style={workspaceStyle}>
        <section id="journey-moment-list" className="journey-moment-list" aria-label="時刻清單">
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
        <div
          className="journey-panel-separator"
          role="separator"
          tabIndex={0}
          aria-label="調整時刻清單寬度"
          aria-controls="journey-moment-list"
          aria-orientation="vertical"
          aria-valuemin={panelLimits.list.min}
          aria-valuemax={panelLimits.list.max}
          aria-valuenow={panelWidths.list}
          onKeyDown={(event) => handleSeparatorKeyDown('list', event)}
          onPointerDown={(event) => handleSeparatorPointerDown('list', event)}
          onPointerMove={handleSeparatorPointerMove}
          onPointerUp={handleSeparatorPointerEnd}
          onPointerCancel={handleSeparatorPointerEnd}
        />
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
        <div
          className="journey-panel-separator"
          role="separator"
          tabIndex={0}
          aria-label="調整旅程資料寬度"
          aria-controls="journey-details-region"
          aria-orientation="vertical"
          aria-valuemin={panelLimits.details.min}
          aria-valuemax={panelLimits.details.max}
          aria-valuenow={panelWidths.details}
          onKeyDown={(event) => handleSeparatorKeyDown('details', event)}
          onPointerDown={(event) => handleSeparatorPointerDown('details', event)}
          onPointerMove={handleSeparatorPointerMove}
          onPointerUp={handleSeparatorPointerEnd}
          onPointerCancel={handleSeparatorPointerEnd}
        />
        <section id="journey-details-region" className="journey-details-region" aria-label="旅程資料">
          <div className="journey-region-heading"><h2>旅程資料</h2></div>
          <JourneyDetailsForm
            draft={draft}
            dateError={dateError}
            onTextChange={(patch) => applyUserPatch(patch, false)}
            onImmediateChange={(patch) => applyUserPatch(patch, true)}
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
  const [loadState, setLoadState] = useState<LoadState>(() => ({ kind: 'loading', journeyId }));

  useEffect(() => {
    if (!editor || isMobile) return;
    let active = true;
    setLoadState({ kind: 'loading', journeyId });
    void editor.getPrivateJourneyStory(journeyId)
      .then((nextStory) => {
        if (!active) return;
        setLoadState(nextStory
          ? { kind: 'ready', journeyId, story: nextStory }
          : { kind: 'not-found', journeyId });
      })
      .catch(() => {
        if (active) setLoadState({ kind: 'error', journeyId });
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

  const currentLoadState: LoadState = loadState.journeyId === journeyId
    ? loadState
    : { kind: 'loading', journeyId };

  if (currentLoadState.kind === 'loading') {
    return <section className="page studio-editor-state"><p>正在載入旅程…</p></section>;
  }
  if (currentLoadState.kind === 'not-found') {
    return <section className="page studio-editor-state"><h1>找不到這趟私人旅程</h1></section>;
  }
  if (currentLoadState.kind === 'error') {
    return (
      <section className="page studio-editor-state" role="alert">
        <h1>無法載入旅程</h1>
        <button className="secondary-command studio-state-action" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          <RefreshCw size={17} aria-hidden="true" />重新載入
        </button>
      </section>
    );
  }

  return <JourneyEditorWorkspace key={currentLoadState.journeyId} editor={editor} story={currentLoadState.story} />;
}
