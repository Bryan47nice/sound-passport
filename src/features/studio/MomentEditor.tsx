import { Trash2 } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  MomentVersionConflictError,
  type JourneyEditorRepository,
  type MomentAutosaveOutboxPort,
} from '../../data/ports';
import { StorageCapacityError } from '../../data/storageErrors';
import type { JourneyMoment, MomentPatch, SongAvailability } from '../../domain/model';
import { parseYouTubeVideoId } from '../../domain/youtube';
import {
  applyMomentPatch,
  createMomentPatchEnvelope,
  mergeMomentPatchEnvelopes,
  momentPatchConflicts,
  MomentPatchConflictError,
  momentPatchMatches,
  type MomentPatchEnvelope,
} from './momentPatch';
import {
  adoptMomentOutboxCandidate,
  readMomentOutbox,
  type MomentOutboxRecoveryCandidate,
} from './momentOutbox';
import type { JourneyOutboxOwnerClaimer } from './journeyOutbox';
import { useAutosave } from './useAutosave';

export interface MomentAutosaveRegistration {
  dirty: boolean;
  flush: () => Promise<void>;
}

interface MomentEditorProps {
  moment: JourneyMoment;
  position: number;
  repository: Pick<JourneyEditorRepository, 'updateMoment'> &
    Partial<Pick<JourneyEditorRepository, 'getPrivateJourneyStory'>>;
  onMomentChange: (moment: JourneyMoment) => void;
  onDelete: (momentId: string) => void | Promise<void>;
  onSaved?: () => void | Promise<void>;
  onAutosaveChange?: (registration: MomentAutosaveRegistration | undefined) => void;
  recovery?: MomentAutosaveOutboxPort;
  recoveryClaimOwner?: JourneyOutboxOwnerClaimer;
  recoveryOwnerId?: string;
}

const momentFields = [
  'localDate', 'localTime', 'cityLabel', 'placeLabel', 'caption', 'reason', 'reasonStatus', 'photoAlt',
] as const;
const songFields = ['title', 'artist', 'sourceUrl'] as const;

type MomentRecoveryState =
  | { kind: 'checking'; key: string }
  | {
      kind: 'choice';
      key: string;
      candidates: MomentOutboxRecoveryCandidate[];
      selectedCandidateKey?: string;
      adopting: boolean;
    }
  | { kind: 'ready'; key?: string; announcement?: string }
  | { kind: 'error'; key: string };

const recoveryTimeFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function recoveryCandidateKey(candidate: MomentOutboxRecoveryCandidate) {
  return `${candidate.ownerId}\u0000${candidate.generation}`;
}

function carryLocalChanges(
  previousAccepted: JourneyMoment,
  currentDraft: JourneyMoment,
  nextAccepted: JourneyMoment,
) {
  let result = nextAccepted;
  for (const field of momentFields) {
    if (currentDraft[field] !== previousAccepted[field]) result = { ...result, [field]: currentDraft[field] };
  }
  let song = result.song;
  for (const field of songFields) {
    if (currentDraft.song[field] !== previousAccepted.song[field]) {
      song = { ...song, [field]: currentDraft.song[field] };
    }
  }
  return song === result.song ? result : { ...result, song };
}

function linkState(sourceUrl: string | undefined): SongAvailability {
  const value = sourceUrl?.trim();
  if (!value) return 'needs_link';
  return parseYouTubeVideoId(value) ? 'available' : 'invalid_link';
}

export function MomentEditor({
  moment,
  position,
  repository,
  onMomentChange,
  onDelete,
  onSaved,
  onAutosaveChange,
  recovery,
  recoveryClaimOwner,
  recoveryOwnerId,
}: MomentEditorProps) {
  const recoveryKey = recovery && recoveryOwnerId
    ? `${moment.journeyId}\u0000${moment.id}\u0000${recoveryOwnerId}`
    : undefined;
  const [draft, setDraft] = useState(moment);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'error'>('idle');
  const [discarding, setDiscarding] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [recoveryState, setRecoveryState] = useState<MomentRecoveryState>(() => (
    recoveryKey ? { kind: 'checking', key: recoveryKey } : { kind: 'ready' }
  ));
  const draftRef = useRef(moment);
  const acceptedMomentRef = useRef(moment);
  const mountedRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const recoveryKeyRef = useRef(recoveryKey);
  const recoveryActionRef = useRef<string | undefined>(undefined);
  recoveryKeyRef.current = recoveryKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  const refreshAfterSave = useCallback(async () => {
    if (!onSaved) return;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    if (mountedRef.current) setRefreshState('refreshing');
    try {
      await onSaved();
      if (mountedRef.current && refreshGenerationRef.current === generation) setRefreshState('idle');
    } catch {
      if (mountedRef.current && refreshGenerationRef.current === generation) setRefreshState('error');
    }
  }, [onSaved]);

  const loadRemoteMoment = useCallback(async () => {
    const story = await repository.getPrivateJourneyStory?.(moment.journeyId);
    return story?.moments.find(({ id }) => id === moment.id);
  }, [moment.id, moment.journeyId, repository]);

  const acceptSave = useCallback(async (
    envelope: MomentPatchEnvelope,
    persistedBase: JourneyMoment,
    updatedAt: string,
  ) => {
    const previousAccepted = acceptedMomentRef.current;
    if (previousAccepted.id !== moment.id) return;
    const nextAccepted = { ...applyMomentPatch(persistedBase, envelope.patch), updatedAt };
    const nextDraft = carryLocalChanges(previousAccepted, draftRef.current, nextAccepted);
    acceptedMomentRef.current = nextAccepted;
    if (mountedRef.current && draftRef.current.id === moment.id) {
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      onMomentChange(nextDraft);
      await refreshAfterSave();
    }
  }, [moment.id, onMomentChange, refreshAfterSave]);

  const save = useCallback(async (envelope: MomentPatchEnvelope) => {
    const accepted = acceptedMomentRef.current;
    if (momentPatchMatches(accepted, envelope.patch)) {
      await acceptSave(envelope, accepted, accepted.updatedAt);
      return;
    }
    const acceptedConflicts = momentPatchConflicts(accepted, envelope);
    if (acceptedConflicts.length > 0) {
      throw new MomentPatchConflictError(accepted, acceptedConflicts);
    }
    try {
      const updated = await repository.updateMoment(moment.id, envelope.patch, {
        expectedUpdatedAt: accepted.updatedAt,
      });
      await acceptSave(envelope, accepted, updated.updatedAt);
      return;
    } catch (error) {
      if (!(error instanceof MomentVersionConflictError)) throw error;
    }

    const remote = await loadRemoteMoment();
    if (!remote) throw new Error('Moment is no longer available.');
    if (momentPatchMatches(remote, envelope.patch)) {
      await acceptSave(envelope, remote, remote.updatedAt);
      return;
    }

    const conflicts = momentPatchConflicts(remote, envelope);
    const rebasedDraft = carryLocalChanges(accepted, draftRef.current, remote);
    acceptedMomentRef.current = remote;
    if (mountedRef.current) {
      draftRef.current = rebasedDraft;
      setDraft(rebasedDraft);
      onMomentChange(rebasedDraft);
    }
    if (conflicts.length > 0) throw new MomentPatchConflictError(remote, conflicts);

    const updated = await repository.updateMoment(moment.id, envelope.patch, {
      expectedUpdatedAt: remote.updatedAt,
    });
    await acceptSave(envelope, remote, updated.updatedAt);
  }, [acceptSave, loadRemoteMoment, moment.id, onMomentChange, repository]);

  const forceSave = useCallback(async (envelope: MomentPatchEnvelope) => {
    const remote = await loadRemoteMoment();
    if (!remote) throw new Error('Moment is no longer available.');
    const updated = await repository.updateMoment(moment.id, envelope.patch, {
      expectedUpdatedAt: remote.updatedAt,
    });
    await acceptSave(envelope, remote, updated.updatedAt);
  }, [acceptSave, loadRemoteMoment, moment.id, repository]);

  const persistRecovery = useCallback((
    envelope: MomentPatchEnvelope,
    { generation }: { generation: string },
  ) => {
    if (!recovery || !recoveryOwnerId) return Promise.resolve();
    return recovery.putMomentOutbox({
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: recoveryOwnerId,
      generation,
      envelope,
      updatedAt: new Date().toISOString(),
    });
  }, [moment.id, moment.journeyId, recovery, recoveryOwnerId]);

  const clearRecovery = useCallback((generation: string) => {
    if (!recovery || !recoveryOwnerId) return Promise.resolve(true);
    return recovery.compareAndDeleteMomentOutbox(moment.id, recoveryOwnerId, generation);
  }, [moment.id, recovery, recoveryOwnerId]);

  const autosave = useAutosave<MomentPatchEnvelope>({
    save,
    forceSave,
    delay: 500,
    merge: mergeMomentPatchEnvelopes,
    recovery: recovery && recoveryOwnerId ? {
      put: persistRecovery,
      compareAndDelete: clearRecovery,
    } : undefined,
  });

  useEffect(() => {
    const accepted = acceptedMomentRef.current;
    if (accepted.id !== moment.id) {
      acceptedMomentRef.current = moment;
      draftRef.current = moment;
      setDraft(moment);
      refreshGenerationRef.current += 1;
      setRefreshState('idle');
      return;
    }
    if (autosave.dirty || moment.updatedAt < accepted.updatedAt) return;
    acceptedMomentRef.current = moment;
    draftRef.current = moment;
    setDraft(moment);
  }, [autosave.dirty, moment]);
  const handledRecoveryRef = useRef<string | undefined>(undefined);
  const recoveryLookupRef = useRef<{
    key: string;
    promise: Promise<{
      result: Awaited<ReturnType<typeof readMomentOutbox>>;
      remote: JourneyMoment | undefined;
    }>;
  } | undefined>(undefined);

  useEffect(() => {
    if (!recovery || !recoveryOwnerId || !recoveryKey || autosave.dirty) return;
    if (handledRecoveryRef.current === recoveryKey) return;
    setRecoveryState((current) => (
      current.key === recoveryKey &&
      (current.kind === 'checking' || current.kind === 'choice')
        ? current
        : { kind: 'checking', key: recoveryKey }
    ));
    let lookup = recoveryLookupRef.current;
    if (!lookup || lookup.key !== recoveryKey) {
      const promise = readMomentOutbox(
        recovery,
        moment.id,
        moment.journeyId,
        recoveryOwnerId,
        recoveryClaimOwner,
      ).then(async (result) => ({
        result,
        remote: result.kind === 'recovered'
          ? repository.getPrivateJourneyStory
            ? await loadRemoteMoment()
            : acceptedMomentRef.current
          : undefined,
      }));
      lookup = { key: recoveryKey, promise };
      recoveryLookupRef.current = lookup;
    }
    let active = true;
    void lookup.promise.then(
      ({ result, remote }) => {
        if (!active || handledRecoveryRef.current === recoveryKey || autosave.dirty) return;
        if (result.kind === 'candidates') {
          setRecoveryState({
            kind: 'choice',
            key: recoveryKey,
            candidates: result.candidates,
            adopting: false,
          });
          return;
        }
        if (result.kind === 'none') {
          handledRecoveryRef.current = recoveryKey;
          setRecoveryState({ kind: 'ready', key: recoveryKey });
          return;
        }
        if (!remote) {
          setRecoveryState({ kind: 'error', key: recoveryKey });
          return;
        }
        handledRecoveryRef.current = recoveryKey;
        acceptedMomentRef.current = remote;
        const recovered = applyMomentPatch(remote, result.record.envelope.patch);
        draftRef.current = recovered;
        setDraft(recovered);
        onMomentChange(recovered);
        setRecoveryState({ kind: 'ready', key: recoveryKey });
        autosave.enqueue(result.record.envelope);
      },
      () => {
        if (!active) return;
        if (recoveryLookupRef.current === lookup) recoveryLookupRef.current = undefined;
        setRecoveryState({ kind: 'error', key: recoveryKey });
      },
    );
    return () => { active = false; };
  }, [
    autosave.dirty,
    autosave.enqueue,
    loadRemoteMoment,
    moment.id,
    moment.journeyId,
    onMomentChange,
    recovery,
    recoveryAttempt,
    recoveryClaimOwner,
    recoveryKey,
    recoveryOwnerId,
    repository.getPrivateJourneyStory,
  ]);

  const ignoreRecovery = () => {
    if (
      !recoveryKey ||
      recoveryState.key !== recoveryKey ||
      (recoveryState.kind === 'choice' && recoveryState.adopting)
    ) return;
    handledRecoveryRef.current = recoveryKey;
    setRecoveryState({ kind: 'ready', key: recoveryKey });
  };

  const selectRecoveryCandidate = (candidate: MomentOutboxRecoveryCandidate) => {
    if (
      !recoveryKey ||
      recoveryState.kind !== 'choice' ||
      recoveryState.key !== recoveryKey ||
      recoveryState.adopting
    ) return;
    setRecoveryState({
      ...recoveryState,
      selectedCandidateKey: recoveryCandidateKey(candidate),
    });
  };

  const recoverCandidate = () => {
    if (
      !recovery ||
      !recoveryOwnerId ||
      !recoveryKey ||
      recoveryState.kind !== 'choice' ||
      recoveryState.key !== recoveryKey ||
      recoveryState.adopting ||
      recoveryActionRef.current
    ) return;
    const candidate = recoveryState.candidates.length === 1
      ? recoveryState.candidates[0]
      : recoveryState.candidates.find((item) => (
        recoveryCandidateKey(item) === recoveryState.selectedCandidateKey
      ));
    if (!candidate) return;

    const actionKey = recoveryKey;
    recoveryActionRef.current = actionKey;
    setRecoveryState({ ...recoveryState, adopting: true });
    void (async () => {
      try {
        const adopted = await adoptMomentOutboxCandidate(
          recovery,
          moment.id,
          moment.journeyId,
          recoveryOwnerId,
          candidate,
          recoveryClaimOwner,
        );
        if (!mountedRef.current || recoveryKeyRef.current !== actionKey) return;

        const remote = repository.getPrivateJourneyStory
          ? await loadRemoteMoment()
          : acceptedMomentRef.current;
        if (!mountedRef.current || recoveryKeyRef.current !== actionKey) return;
        if (!remote) {
          setRecoveryState({ kind: 'error', key: actionKey });
          return;
        }

        handledRecoveryRef.current = actionKey;
        acceptedMomentRef.current = remote;
        if (!adopted) {
          draftRef.current = remote;
          setDraft(remote);
          onMomentChange(remote);
          setRecoveryState({
            kind: 'ready',
            key: actionKey,
            announcement: '未儲存內容已由其他分頁處理，已重新載入最新儲存內容。',
          });
          return;
        }

        const recovered = applyMomentPatch(remote, adopted.envelope.patch);
        draftRef.current = recovered;
        setDraft(recovered);
        onMomentChange(recovered);
        setRecoveryState({ kind: 'ready', key: actionKey });
        autosave.enqueue(adopted.envelope);
      } catch {
        if (mountedRef.current && recoveryKeyRef.current === actionKey) {
          setRecoveryState({ kind: 'error', key: actionKey });
        }
      } finally {
        if (recoveryActionRef.current === actionKey) recoveryActionRef.current = undefined;
      }
    })();
  };

  const retryRecovery = () => {
    if (!recoveryKey || recoveryActionRef.current) return;
    handledRecoveryRef.current = undefined;
    recoveryLookupRef.current = undefined;
    setRecoveryState({ kind: 'checking', key: recoveryKey });
    setRecoveryAttempt((attempt) => attempt + 1);
  };
  const registrationRef = useRef<MomentAutosaveRegistration>({
    dirty: autosave.dirty,
    flush: autosave.flush,
  });
  registrationRef.current = { dirty: autosave.dirty, flush: autosave.flush };

  useEffect(() => {
    onAutosaveChange?.(registrationRef.current);
  }, [autosave.dirty, autosave.flush, onAutosaveChange]);

  useEffect(() => () => {
    const registration = registrationRef.current;
    if (!registration.dirty) {
      onAutosaveChange?.(undefined);
      return;
    }
    void registration.flush().then(
      () => onAutosaveChange?.(undefined),
      () => undefined,
    );
  }, [onAutosaveChange]);

  const queueDraft = (nextDraft: JourneyMoment, patch: MomentPatch, immediate = false) => {
    const envelope = createMomentPatchEnvelope(draftRef.current, patch);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    onMomentChange(nextDraft);
    if (immediate) autosave.saveNow(envelope);
    else autosave.enqueue(envelope);
  };

  const updateField = <Key extends keyof Pick<JourneyMoment, 'cityLabel' | 'placeLabel' | 'caption'>>(
    field: Key,
    value: JourneyMoment[Key],
  ) => {
    const nextDraft = { ...draftRef.current, [field]: value };
    queueDraft(nextDraft, { [field]: value });
  };

  const updateReason = (reason: string) => {
    const reasonStatus: JourneyMoment['reasonStatus'] = reason.trim() ? 'complete' : 'needs_review';
    const nextDraft = { ...draftRef.current, reason, reasonStatus };
    queueDraft(nextDraft, { reason, reasonStatus });
  };

  const updateSong = (field: 'title' | 'artist' | 'sourceUrl', value: string) => {
    const sourceUrl = field === 'sourceUrl' ? value : draftRef.current.song.sourceUrl;
    const availability = linkState(sourceUrl);
    const providerItemId = sourceUrl?.trim() ? parseYouTubeVideoId(sourceUrl.trim()) : undefined;
    const song = {
      ...draftRef.current.song,
      [field]: value,
      sourceUrl,
      provider: sourceUrl?.trim() ? 'youtube' as const : 'manual' as const,
      providerItemId,
      availability,
    };
    const nextDraft = { ...draftRef.current, song };
    queueDraft(nextDraft, {
      song: { [field]: song[field] },
    });
  };

  const discardConflict = async () => {
    if (!(autosave.error instanceof MomentPatchConflictError) || discarding) return;
    setDiscarding(true);
    try {
      await autosave.discard();
      const remote = await loadRemoteMoment();
      if (!remote) throw new Error('Moment is no longer available.');
      acceptedMomentRef.current = remote;
      draftRef.current = remote;
      setDraft(remote);
      onMomentChange(remote);
    } finally {
      if (mountedRef.current) setDiscarding(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('確定要刪除這則時刻嗎？此動作無法復原。')) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await autosave.flush();
      await onDelete(moment.id);
    } catch {
      setDeleteError('無法刪除時刻，請再試一次。');
    } finally {
      setDeleting(false);
    }
  };

  const availability = linkState(draft.song.sourceUrl);
  const hasConflict = autosave.error instanceof MomentPatchConflictError;
  const storageCapacityAnnouncement = autosave.state === 'error' &&
    autosave.error instanceof StorageCapacityError
    ? autosave.errorAnnouncement
    : '';
  const saveLabel = autosave.state === 'saving'
    ? '時刻儲存中'
    : autosave.state === 'saved'
      ? '時刻已儲存'
      : autosave.state === 'error'
        ? '時刻儲存失敗'
        : autosave.dirty ? '時刻尚未儲存' : '';
  const activeRecoveryState: MomentRecoveryState = !recoveryKey
    ? { kind: 'ready' }
    : recoveryState.key === recoveryKey
      ? recoveryState
      : { kind: 'checking', key: recoveryKey };

  let recoveryPanel: ReactNode;
  if (activeRecoveryState.kind === 'checking') {
    recoveryPanel = <p className="muted moment-recovery-checking" aria-live="polite">正在檢查未儲存內容…</p>;
  } else if (activeRecoveryState.kind === 'choice') {
    const requiresSelection = activeRecoveryState.candidates.length > 1;
    recoveryPanel = (
      <section
        className="moment-recovery-prompt"
        role="region"
        aria-labelledby="moment-recovery-title"
      >
        <h3 id="moment-recovery-title">找到未儲存的時刻內容</h3>
        <p>另一個分頁可能仍在編輯這則時刻。</p>
        <p className="muted">請確認要復原的版本，或忽略並使用目前已儲存的內容。</p>
        {requiresSelection ? (
          <fieldset className="moment-recovery-candidates">
            <legend>選擇要復原的版本</legend>
            {activeRecoveryState.candidates.map((candidate, index) => (
              <label key={recoveryCandidateKey(candidate)}>
                <input
                  type="radio"
                  name="moment-recovery-candidate"
                  aria-label={`選擇復原版本 ${index + 1}`}
                  checked={activeRecoveryState.selectedCandidateKey === recoveryCandidateKey(candidate)}
                  disabled={activeRecoveryState.adopting}
                  onChange={() => selectRecoveryCandidate(candidate)}
                />
                <span>復原版本 {index + 1}</span>
                <time dateTime={candidate.updatedAt}>
                  最後更新：{recoveryTimeFormatter.format(new Date(candidate.updatedAt))}
                </time>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="moment-recovery-version">
            <span>復原版本 1</span>
            <time dateTime={activeRecoveryState.candidates[0].updatedAt}>
              最後更新：{recoveryTimeFormatter.format(
                new Date(activeRecoveryState.candidates[0].updatedAt),
              )}
            </time>
          </div>
        )}
        <div className="moment-recovery-actions">
          <button
            className="primary-command"
            type="button"
            disabled={
              activeRecoveryState.adopting ||
              (requiresSelection && !activeRecoveryState.selectedCandidateKey)
            }
            onClick={recoverCandidate}
          >
            復原未儲存內容
          </button>
          <button
            className="secondary-command"
            type="button"
            disabled={activeRecoveryState.adopting}
            onClick={ignoreRecovery}
          >
            忽略
          </button>
        </div>
      </section>
    );
  } else if (activeRecoveryState.kind === 'error') {
    recoveryPanel = (
      <div className="moment-recovery-prompt" role="alert">
        <h3>無法處理未儲存內容</h3>
        <p>未儲存內容尚未套用，請重新檢查後再繼續。</p>
        <div className="moment-recovery-actions">
          <button className="secondary-command" type="button" onClick={retryRecovery}>重新檢查</button>
        </div>
      </div>
    );
  }

  return (
    <div className="moment-editor">
      <div className="moment-editor-heading">
        <div>
          <p>第 {position} 則</p>
          <h2>時刻資料</h2>
        </div>
        <button
          className="icon-command destructive-icon-command"
          type="button"
          aria-label="刪除時刻"
          title="刪除時刻"
          disabled={deleting || activeRecoveryState.kind !== 'ready'}
          onClick={() => void handleDelete()}
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </div>
      {recoveryPanel}
      {activeRecoveryState.kind === 'ready' && (
        <>
          {activeRecoveryState.announcement && (
            <p className="moment-recovery-announcement" role="alert">
              {activeRecoveryState.announcement}
            </p>
          )}
          <form className="moment-editor-form" onSubmit={(event) => event.preventDefault()}>
            <div className="moment-date-time-fields">
              <label>日期
                <input
                  required
                  type="date"
                  data-validation-field="localDate"
                  value={draft.localDate}
                  onChange={(event) => {
                    const localDate = event.target.value;
                    queueDraft({ ...draftRef.current, localDate }, { localDate }, true);
                  }}
                />
              </label>
              <label>時間
                <input
                  type="time"
                  value={draft.localTime ?? ''}
                  onChange={(event) => {
                    const localTime = event.target.value || undefined;
                    queueDraft({ ...draftRef.current, localTime }, { localTime }, true);
                  }}
                />
              </label>
            </div>
            <div className="moment-location-fields">
              <label>城市
                <input value={draft.cityLabel} onChange={(event) => updateField('cityLabel', event.target.value)} />
              </label>
              <label>地點
                <input value={draft.placeLabel} onChange={(event) => updateField('placeLabel', event.target.value)} />
              </label>
            </div>
            <label>時刻文案
              <textarea rows={4} value={draft.caption} onChange={(event) => updateField('caption', event.target.value)} />
            </label>
            <div className="moment-song-fields">
              <label>歌名
                <input
                  required
                  data-validation-field="song.title"
                  value={draft.song.title}
                  onChange={(event) => updateSong('title', event.target.value)}
                />
              </label>
              <label>歌手
                <input
                  required
                  data-validation-field="song.artist"
                  value={draft.song.artist}
                  onChange={(event) => updateSong('artist', event.target.value)}
                />
              </label>
            </div>
            <label>YouTube 連結
              <input
                type="url"
                value={draft.song.sourceUrl ?? ''}
                data-link-state={availability}
                aria-invalid={availability === 'invalid_link' ? true : undefined}
                aria-describedby={availability === 'invalid_link' ? 'moment-youtube-error' : undefined}
                onChange={(event) => updateSong('sourceUrl', event.target.value)}
              />
            </label>
            {availability === 'invalid_link' && (
              <p
                className="field-error"
                id="moment-youtube-error"
                data-link-state="invalid_link"
              >
                連結格式不正確
              </p>
            )}
            <label>選歌原因
              <textarea rows={4} value={draft.reason} onChange={(event) => updateReason(event.target.value)} />
            </label>
          </form>
          <div className="moment-save-status" aria-live="polite">
            <span>{saveLabel}</span>
            {autosave.state === 'error' && (
              hasConflict ? (
                <span className="journey-save-actions">
                  <button type="button" disabled={discarding} onClick={autosave.forceRetry}>覆寫遠端內容</button>
                  <button type="button" disabled={discarding} onClick={() => void discardConflict()}>捨棄並重新載入</button>
                </span>
              ) : <button type="button" onClick={autosave.retry}>重試儲存</button>
            )}
          </div>
          {storageCapacityAnnouncement && (
            <p className="field-error" role="alert">{storageCapacityAnnouncement}</p>
          )}
          {autosave.state === 'error' && hasConflict && (
            <p className="field-error" role="alert">時刻內容已在其他位置更新，本機草稿尚未覆寫。</p>
          )}
          {refreshState === 'error' && (
            <div className="moment-refresh-error" role="alert">
              <span>時刻已儲存，但重新載入失敗。</span>
              <button type="button" onClick={() => void refreshAfterSave()}>重新載入</button>
            </div>
          )}
          {deleteError && <p className="field-error" role="alert">{deleteError}</p>}
        </>
      )}
    </div>
  );
}
