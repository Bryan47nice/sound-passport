import { RefreshCw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router';
import {
  useOptionalJourneyAutosaveOutbox,
  useOptionalJourneyEditorRepository,
  usePrivateStorageError,
} from '../../data/RepositoryContext';
import {
  JourneyVersionConflictError,
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
  type JourneyEditorRepository,
} from '../../data/ports';
import { validateJourneyForReview } from '../../domain/journeyValidation';
import type { Journey, JourneyMoment, JourneyPatch, JourneyStory } from '../../domain/model';
import { JourneyPhoto } from '../../media/JourneyPhoto';
import { JourneyDetailsForm } from './JourneyDetailsForm';
import { MomentEditor, type MomentAutosaveRegistration } from './MomentEditor';
import { MomentList } from './MomentList';
import { PhotoDropzone } from './PhotoDropzone';
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
  type JourneyOutboxPageOwnerClaim,
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
type OwnerClaimState =
  | {
      kind: 'ready';
      editor: JourneyEditorRepository;
      outbox: JourneyAutosaveOutboxPort;
      claim: JourneyOutboxPageOwnerClaim;
    }
  | {
      kind: 'error';
      editor: JourneyEditorRepository;
      outbox: JourneyAutosaveOutboxPort;
    };

const recoveryTimeFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

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
    promise: Promise<JourneyOutboxPageOwnerClaim>;
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
  const [editorStory, setEditorStory] = useState(story);
  const [draft, setDraft] = useState(initialDraft);
  const [dateError, setDateError] = useState('');
  const [demotionNotice, setDemotionNotice] = useState('');
  const [selectedMomentId, setSelectedMomentId] = useState(story.moments[0]?.id);
  const [momentDirty, setMomentDirty] = useState(false);
  const draftRef = useRef(initialDraft);
  const fieldRevisionsRef = useRef<Partial<Record<JourneyUserPatchKey, number>>>({});
  const recoveredQueuedRef = useRef(false);
  const mountedRef = useRef(false);
  const momentAutosaveRef = useRef<MomentAutosaveRegistration | undefined>(undefined);

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
    setEditorStory((current) => ({ ...current, journey: persisted }));
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
  const handleMomentAutosaveChange = useCallback((registration: MomentAutosaveRegistration | undefined) => {
    momentAutosaveRef.current = registration;
    setMomentDirty(registration?.dirty ?? false);
  }, []);
  const flushWorkspace = useCallback(async () => {
    await Promise.all([
      autosave.flush(),
      momentAutosaveRef.current?.flush() ?? Promise.resolve(),
    ]);
  }, [autosave.flush]);
  useDirtyNavigationGuard({ dirty: autosave.dirty || momentDirty, flush: flushWorkspace });

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

  const refreshStory = useCallback(async () => {
    const refreshed = await editor.getPrivateJourneyStory(story.journey.id);
    if (!refreshed) throw new Error('Journey is no longer available.');
    if (!mountedRef.current) return refreshed;

    const previousStatus = draftRef.current.status;
    const nextDraft = {
      ...draftRef.current,
      status: refreshed.journey.status,
      updatedAt: refreshed.journey.updatedAt,
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setEditorStory(refreshed);
    if (previousStatus === 'complete' && refreshed.journey.status === 'review') {
      setDemotionNotice('必要資料已移除，旅程已回到待整理');
    }
    return refreshed;
  }, [editor, story.journey.id]);

  const selectMoment = useCallback((momentId: string) => {
    if (momentId === selectedMomentId) return;
    const registration = momentAutosaveRef.current;
    if (!registration?.dirty) {
      setSelectedMomentId(momentId);
      return;
    }
    void registration.flush().then(() => {
      if (mountedRef.current) setSelectedMomentId(momentId);
    }, () => undefined);
  }, [selectedMomentId]);

  const updateMomentDraft = useCallback((nextMoment: JourneyMoment) => {
    setEditorStory((current) => ({
      ...current,
      moments: current.moments.map((item) => item.id === nextMoment.id ? nextMoment : item),
    }));
  }, []);

  const updateMomentOrder = useCallback((orderedIds: string[]) => {
    setEditorStory((current) => {
      const momentsById = new Map(current.moments.map((moment) => [moment.id, moment]));
      return {
        ...current,
        moments: orderedIds.flatMap((id, sortOrder) => {
          const moment = momentsById.get(id);
          return moment ? [{ ...moment, sortOrder }] : [];
        }),
      };
    });
  }, []);

  const deleteMoment = useCallback(async (momentId: string) => {
    const deletedIndex = editorStory.moments.findIndex((moment) => moment.id === momentId);
    await editor.deleteMoment(momentId);
    const refreshed = await refreshStory();
    const nextIndex = Math.min(Math.max(0, deletedIndex), refreshed.moments.length - 1);
    setSelectedMomentId(refreshed.moments[nextIndex]?.id);
  }, [editor, editorStory.moments, refreshStory]);

  useEffect(() => {
    if (!selectedMomentId || !editorStory.moments.some((moment) => moment.id === selectedMomentId)) {
      setSelectedMomentId(editorStory.moments[0]?.id);
    }
  }, [editorStory.moments, selectedMomentId]);

  const selectedMoment = editorStory.moments.find((moment) => moment.id === selectedMomentId);
  const selectedPosition = selectedMoment
    ? editorStory.moments.findIndex((moment) => moment.id === selectedMoment.id) + 1
    : 0;
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
      <section id="journey-details-region" className="journey-overview-region" aria-label="旅程資料">
        <div className="journey-region-heading"><h2>旅程資料</h2></div>
        <JourneyDetailsForm
          draft={draft}
          dateError={dateError}
          onTextChange={(patch) => applyUserPatch(patch, false)}
          onImmediateChange={(patch) => applyUserPatch(patch, true)}
          onDateChange={handleDateChange}
        />
      </section>
      <div className="journey-editor-workspace">
        <MomentList
          journeyId={story.journey.id}
          moments={editorStory.moments}
          selectedMomentId={selectedMomentId}
          repository={editor}
          onSelect={selectMoment}
          onOrderChange={updateMomentOrder}
          onReordered={() => refreshStory().then(() => undefined)}
          headerActions={(
            <PhotoDropzone
              journeyId={story.journey.id}
              repository={editor}
              onMomentsAdded={() => refreshStory().then(() => undefined)}
              onSelectMoment={selectMoment}
            />
          )}
        />
        <section className="journey-moment-preview" aria-label="時刻預覽">
          {selectedMoment ? (
            <JourneyPhoto
              alt={selectedMoment.photoAlt}
              className="journey-editor-preview-image"
              fixtureUrl={selectedMoment.photoUrl}
              photoAssetId={selectedMoment.photoAssetId}
            />
          ) : <p>選取時刻後在此預覽</p>}
        </section>
        <section className="moment-details-region" aria-label="時刻資料">
          {selectedMoment ? (
            <MomentEditor
              key={selectedMoment.id}
              moment={selectedMoment}
              position={selectedPosition}
              repository={editor}
              onMomentChange={updateMomentDraft}
              onDelete={deleteMoment}
              onSaved={() => refreshStory().then(() => undefined)}
              onAutosaveChange={handleMomentAutosaveChange}
            />
          ) : <p className="muted">加入或選取時刻後即可編輯</p>}
        </section>
      </div>
    </section>
  );
}

export function JourneyEditorPage({ onBootstrapRetry = () => window.location.reload() }: JourneyEditorPageProps) {
  const { journeyId = '' } = useParams();
  const editor = useOptionalJourneyEditorRepository();
  const outbox = useOptionalJourneyAutosaveOutbox();
  const privateStorageError = usePrivateStorageError();
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
    if (!editor || !outbox || !outboxOwnerId || ownerClaimState?.kind !== 'ready') return;
    let active = true;
    setLoadState({ kind: 'loading', journeyId });
    void Promise.all([
      editor.getPrivateJourneyStory(journeyId),
      readJourneyOutbox(
        outbox,
        journeyId,
        outboxOwnerId,
        ownerClaimState.claim.claimRecoveryOwner,
      ),
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
  }, [editor, journeyId, loadAttempt, outbox, outboxOwnerId, ownerClaimState]);

  const currentLoadState: LoadState = loadState.journeyId === journeyId
    ? loadState
    : { kind: 'loading', journeyId };

  const selectRecoveryCandidate = (candidate: JourneyOutboxRecoveryCandidate) => {
    if (
      currentLoadState.kind !== 'recovery-choice' ||
      !outbox ||
      !outboxOwnerId ||
      ownerClaimState?.kind !== 'ready' ||
      currentLoadState.selectingOwnerId
    ) return;

    const choice = currentLoadState;
    setLoadState({ ...choice, selectingOwnerId: candidate.ownerId });
    void adoptJourneyOutboxCandidate(
      outbox,
      choice.journeyId,
      outboxOwnerId,
      candidate,
      ownerClaimState.claim.claimRecoveryOwner,
    ).then(
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
        <p className="muted">{privateStorageError ?? '請確認瀏覽器允許本機儲存後重新開啟。'}</p>
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
