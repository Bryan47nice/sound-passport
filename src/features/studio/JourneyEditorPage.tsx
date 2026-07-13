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
import {
  useOptionalJourneyAutosaveOutbox,
  useOptionalJourneyEditorRepository,
} from '../../data/RepositoryContext';
import {
  JourneyVersionConflictError,
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
  type JourneyEditorRepository,
} from '../../data/ports';
import { validateJourneyForReview } from '../../domain/journeyValidation';
import type { Journey, JourneyPatch, JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { JourneyDetailsForm } from './JourneyDetailsForm';
import {
  createJourneyPatchEnvelope,
  JourneyPatchConflictError,
  journeyUserPatchKeys,
  journeyPatchBaseMatches,
  journeyPatchMatchesPersisted,
  mergeJourneyPatchEnvelopes,
  type JourneyPatchEnvelope,
  type JourneyUserPatchKey,
  type JourneyUserPatch,
} from './journeyPatch';
import {
  adoptJourneyOutboxCandidate,
  claimJourneyOutboxOwner,
  clearJourneyOutbox,
  readJourneyOutbox,
  type JourneyOutboxRecoveryCandidate,
  type JourneyOutboxOwnerClaim,
  writeJourneyOutbox,
} from './journeyOutbox';
import { useAutosave } from './useAutosave';
import { useDirtyNavigationGuard } from './useDirtyNavigationGuard';
import { useMobileStudio } from './useMobileStudio';

type LoadState =
  | { kind: 'loading'; journeyId: string }
  | {
      kind: 'ready';
      journeyId: string;
      story: JourneyStory;
      recoveredOutbox?: JourneyAutosaveOutboxRecord;
    }
  | { kind: 'not-found'; journeyId: string }
  | {
      kind: 'recovery-choice';
      journeyId: string;
      story: JourneyStory;
      candidates: JourneyOutboxRecoveryCandidate[];
      selectingOwnerId?: string;
    }
  | { kind: 'error'; journeyId: string };

type JourneyEditorPageProps = { onBootstrapRetry?: () => void };
type AdjustablePanel = 'list' | 'details';
type OwnerClaimState =
  | {
      kind: 'ready';
      editor: JourneyEditorRepository;
      outbox: JourneyAutosaveOutboxPort;
      claim: JourneyOutboxOwnerClaim;
    }
  | {
      kind: 'error';
      editor: JourneyEditorRepository;
      outbox: JourneyAutosaveOutboxPort;
    };

const panelLimits = {
  list: { min: 180, max: 340 },
  details: { min: 300, max: 480 },
} as const;
const panelStep = 16;
const recoveryTimeFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatSavedTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function useJourneyOutboxOwnerClaim(
  editor: JourneyEditorRepository | undefined,
  outbox: JourneyAutosaveOutboxPort | undefined,
) {
  const [state, setState] = useState<OwnerClaimState>();
  const lifecycleRef = useRef(0);
  const requestRef = useRef<{
    editor: JourneyEditorRepository;
    outbox: JourneyAutosaveOutboxPort;
    promise: Promise<JourneyOutboxOwnerClaim>;
  } | undefined>(undefined);

  useEffect(() => {
    lifecycleRef.current += 1;
    if (!editor || !outbox) return;

    let request = requestRef.current;
    if (request && (request.editor !== editor || request.outbox !== outbox)) {
      void request.promise.then((claim) => claim.release(), () => undefined);
      request = undefined;
    }
    if (!request) {
      request = { editor, outbox, promise: claimJourneyOutboxOwner() };
      requestRef.current = request;
    }

    let active = true;
    void request.promise.then(
      (claim) => {
        if (active && requestRef.current === request) {
          setState({ kind: 'ready', editor, outbox, claim });
        }
      },
      () => {
        if (active && requestRef.current === request) {
          setState({ kind: 'error', editor, outbox });
        }
      },
    );

    return () => {
      active = false;
      lifecycleRef.current += 1;
      const cleanupLifecycle = lifecycleRef.current;
      queueMicrotask(() => {
        if (lifecycleRef.current !== cleanupLifecycle) return;
        if (requestRef.current === request) requestRef.current = undefined;
        void request.promise.then((claim) => claim.release(), () => undefined);
      });
    };
  }, [editor, outbox]);

  if (!editor || !outbox || state?.editor !== editor || state.outbox !== outbox) return undefined;
  return state;
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
        <span className="journey-save-actions">
          <button type="button" onClick={autosave.retry}>重試儲存</button>
          {isConflict && <button type="button" onClick={autosave.forceRetry}>重試並套用</button>}
        </span>
      )}
    </div>
  );
}

function JourneyEditorWorkspace({
  editor,
  isMobile,
  outbox,
  outboxOwnerId,
  recoveredOutbox,
  story,
}: {
  editor: JourneyEditorRepository;
  isMobile: boolean;
  outbox: JourneyAutosaveOutboxPort;
  outboxOwnerId: string;
  recoveredOutbox?: JourneyAutosaveOutboxRecord;
  story: JourneyStory;
}) {
  const recoveredEnvelope = recoveredOutbox?.envelope;
  const initialDraft = recoveredEnvelope
    ? { ...story.journey, ...recoveredEnvelope.patch }
    : story.journey;
  const [draft, setDraft] = useState(initialDraft);
  const [dateError, setDateError] = useState('');
  const [demotionNotice, setDemotionNotice] = useState('');
  const [panelWidths, setPanelWidths] = useState({ list: 220, details: 340 });
  const draftRef = useRef(initialDraft);
  const fieldRevisionsRef = useRef<Partial<Record<JourneyUserPatchKey, number>>>({});
  const recoveredQueuedRef = useRef(false);
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

  const rebaseDraft = useCallback((
    persisted: Journey,
    savedRevision: number,
    protectedPatch?: JourneyUserPatch,
  ) => {
    if (!mountedRef.current) return;
    const nextDraft: Journey = {
      ...draftRef.current,
      status: persisted.status,
      updatedAt: persisted.updatedAt,
    };
    journeyUserPatchKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(protectedPatch ?? {}, key)) return;
      if ((fieldRevisionsRef.current[key] ?? 0) > savedRevision) return;
      const value = persisted[key];
      Object.assign(nextDraft, { [key]: Array.isArray(value) ? [...value] : value });
    });
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  const persistEnvelope = useCallback(async (
    envelope: JourneyPatchEnvelope,
    currentStory: JourneyStory,
    revision: number,
  ) => {
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
      rebaseDraft(updated, revision);
      if (demoted && mountedRef.current) {
        setDemotionNotice('必要資料已移除，旅程已回到待整理');
      }
    } catch (error) {
      if (!(error instanceof JourneyVersionConflictError)) throw error;
      try {
        const refreshed = await editor.getPrivateJourneyStory(story.journey.id);
        if (refreshed) rebaseDraft(refreshed.journey, revision, envelope.patch);
      } catch {
        // Keep the field patch retryable even if the conflict refresh also fails.
      }
      throw new JourneyPatchConflictError();
    }
  }, [editor, rebaseDraft, story.journey.id]);

  const save = useCallback(async (
    envelope: JourneyPatchEnvelope,
    { revision }: { revision: number },
  ) => {
    const currentStory = await editor.getPrivateJourneyStory(story.journey.id);
    if (!currentStory) throw new Error('Journey is no longer available.');

    if (!journeyPatchBaseMatches(envelope, currentStory.journey)) {
      if (journeyPatchMatchesPersisted(envelope, currentStory.journey)) {
        rebaseDraft(currentStory.journey, revision);
        return;
      }
      rebaseDraft(currentStory.journey, revision, envelope.patch);
      throw new JourneyPatchConflictError();
    }
    await persistEnvelope(envelope, currentStory, revision);
  }, [editor, persistEnvelope, rebaseDraft, story.journey.id]);

  const forceSave = useCallback(async (
    envelope: JourneyPatchEnvelope,
    { revision }: { revision: number },
  ) => {
    const currentStory = await editor.getPrivateJourneyStory(story.journey.id);
    if (!currentStory) throw new Error('Journey is no longer available.');
    await persistEnvelope(envelope, currentStory, revision);
  }, [editor, persistEnvelope, story.journey.id]);

  const persistRecovery = useCallback((
    envelope: JourneyPatchEnvelope,
    { generation }: { generation: string },
  ) => writeJourneyOutbox(outbox, {
    journeyId: story.journey.id,
    ownerId: outboxOwnerId,
    generation,
    envelope,
    updatedAt: new Date().toISOString(),
  }), [outbox, outboxOwnerId, story.journey.id]);

  const clearRecovery = useCallback((generation: string) => (
    clearJourneyOutbox(outbox, story.journey.id, outboxOwnerId, generation)
  ), [outbox, outboxOwnerId, story.journey.id]);

  const autosave = useAutosave({
    save,
    forceSave,
    delay: 500,
    merge: mergeJourneyPatchEnvelopes,
    recovery: {
      put: persistRecovery,
      compareAndDelete: clearRecovery,
    },
  });
  useDirtyNavigationGuard({ dirty: autosave.dirty, flush: autosave.flush });

  const markFieldRevisions = useCallback((patch: JourneyUserPatch, revision: number) => {
    journeyUserPatchKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) fieldRevisionsRef.current[key] = revision;
    });
  }, []);

  useEffect(() => {
    if (!recoveredEnvelope || recoveredQueuedRef.current) return;
    recoveredQueuedRef.current = true;
    const revision = autosave.enqueue(recoveredEnvelope);
    markFieldRevisions(recoveredEnvelope.patch, revision);
  }, [autosave.enqueue, markFieldRevisions, recoveredEnvelope]);

  const applyUserPatch = (patch: JourneyUserPatch, immediate: boolean) => {
    const envelope = createJourneyPatchEnvelope(draftRef.current, patch);
    const nextDraft: Journey = { ...draftRef.current, ...envelope.patch };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    const revision = immediate ? autosave.saveNow(envelope) : autosave.enqueue(envelope);
    if (revision !== undefined) markFieldRevisions(envelope.patch, revision);
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
      ? '其他位置已有更新。可先重試儲存；確認覆蓋衝突欄位時，才使用重試並套用。'
      : autosave.errorAnnouncement
    : '';

  if (isMobile) {
    return <section className="studio-mobile-only"><h1>請使用電腦整理旅程</h1></section>;
  }

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
  const outbox = useOptionalJourneyAutosaveOutbox();
  const isMobile = useMobileStudio();
  const ownerClaimState = useJourneyOutboxOwnerClaim(editor, outbox);
  const outboxOwnerId = ownerClaimState?.kind === 'ready' ? ownerClaimState.claim.ownerId : undefined;
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>(() => ({ kind: 'loading', journeyId }));
  const pageMountedRef = useRef(false);
  const journeyIdRef = useRef(journeyId);
  journeyIdRef.current = journeyId;

  useEffect(() => {
    pageMountedRef.current = true;
    return () => { pageMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!editor || !outbox || !outboxOwnerId) return;
    let active = true;
    setLoadState({ kind: 'loading', journeyId });
    void Promise.all([
      editor.getPrivateJourneyStory(journeyId),
      readJourneyOutbox(outbox, journeyId, outboxOwnerId),
    ])
      .then(([nextStory, recovery]) => {
        if (!active) return;
        if (!nextStory) {
          setLoadState({ kind: 'not-found', journeyId });
        } else if (recovery.kind === 'candidates') {
          setLoadState({
            kind: 'recovery-choice',
            journeyId,
            story: nextStory,
            candidates: recovery.candidates,
          });
        } else {
          setLoadState({
            kind: 'ready',
            journeyId,
            story: nextStory,
            recoveredOutbox: recovery.kind === 'recovered' ? recovery.record : undefined,
          });
        }
      })
      .catch(() => {
        if (!active) return;
        setLoadState({ kind: 'error', journeyId });
      });
    return () => { active = false; };
  }, [editor, journeyId, loadAttempt, outbox, outboxOwnerId]);

  const currentLoadState: LoadState = loadState.journeyId === journeyId
    ? loadState
    : { kind: 'loading', journeyId };

  const selectRecoveryCandidate = (candidate: JourneyOutboxRecoveryCandidate) => {
    if (
      currentLoadState.kind !== 'recovery-choice' ||
      !outbox ||
      !outboxOwnerId ||
      currentLoadState.selectingOwnerId
    ) return;

    const choice = currentLoadState;
    setLoadState({ ...choice, selectingOwnerId: candidate.ownerId });
    void adoptJourneyOutboxCandidate(outbox, choice.journeyId, outboxOwnerId, candidate).then(
      (record) => {
        if (!pageMountedRef.current || journeyIdRef.current !== choice.journeyId) return;
        if (!record) {
          setLoadAttempt((attempt) => attempt + 1);
          return;
        }
        setLoadState({
          kind: 'ready',
          journeyId: choice.journeyId,
          story: choice.story,
          recoveredOutbox: record,
        });
      },
      () => {
        if (pageMountedRef.current && journeyIdRef.current === choice.journeyId) {
          setLoadState({ kind: 'error', journeyId: choice.journeyId });
        }
      },
    );
  };

  if (isMobile && currentLoadState.kind !== 'ready') {
    return <section className="studio-mobile-only"><h1>請使用電腦整理旅程</h1></section>;
  }

  if (!editor || !outbox) {
    return (
      <section className="page studio-guidance">
        <h1 className="page-title">本機儲存空間暫時無法使用</h1>
        <button className="secondary-command studio-state-action" type="button" onClick={onBootstrapRetry}>重新嘗試</button>
      </section>
    );
  }

  if (ownerClaimState?.kind === 'error') {
    return (
      <section className="page studio-editor-state" role="alert">
        <h1>無法載入旅程</h1>
        <button className="secondary-command studio-state-action" type="button" onClick={onBootstrapRetry}>
          <RefreshCw size={17} aria-hidden="true" />重新嘗試
        </button>
      </section>
    );
  }

  if (currentLoadState.kind === 'loading') {
    return <section className="page studio-editor-state"><p>正在載入旅程…</p></section>;
  }
  if (currentLoadState.kind === 'not-found') {
    return <section className="page studio-editor-state"><h1>找不到這趟私人旅程</h1></section>;
  }
  if (currentLoadState.kind === 'recovery-choice') {
    return (
      <section className="page studio-editor-state">
        <h1>找到多個未儲存版本</h1>
        <p>請選擇要載入的版本；其他版本會繼續保留。</p>
        <ol className="journey-recovery-candidates">
          {currentLoadState.candidates.map((candidate, index) => (
            <li key={`${candidate.ownerId}:${candidate.generation}`}>
              <span>版本 {index + 1}</span>
              <time dateTime={candidate.updatedAt}>
                最後更新：{recoveryTimeFormatter.format(new Date(candidate.updatedAt))}
              </time>
              <button
                className="secondary-command"
                type="button"
                aria-label={`載入此版本：版本 ${index + 1}`}
                disabled={currentLoadState.selectingOwnerId !== undefined}
                onClick={() => selectRecoveryCandidate(candidate)}
              >
                載入此版本
              </button>
            </li>
          ))}
        </ol>
      </section>
    );
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

  return (
    <JourneyEditorWorkspace
      key={currentLoadState.journeyId}
      editor={editor}
      isMobile={isMobile}
      outbox={outbox}
      outboxOwnerId={outboxOwnerId!}
      recoveredOutbox={currentLoadState.recoveredOutbox}
      story={currentLoadState.story}
    />
  );
}
