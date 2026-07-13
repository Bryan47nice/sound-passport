import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MomentVersionConflictError,
  type JourneyEditorRepository,
  type MomentAutosaveOutboxPort,
} from '../../data/ports';
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
import { readMomentOutbox } from './momentOutbox';
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
  const [draft, setDraft] = useState(moment);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'error'>('idle');
  const [discarding, setDiscarding] = useState(false);
  const draftRef = useRef(moment);
  const acceptedMomentRef = useRef(moment);
  const mountedRef = useRef(false);
  const refreshGenerationRef = useRef(0);

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
  const restoredRecoveryRef = useRef<string | undefined>(undefined);
  const recoveryLookupRef = useRef<{
    key: string;
    promise: Promise<{
      record: Awaited<ReturnType<typeof readMomentOutbox>>;
      remote: JourneyMoment | undefined;
    }>;
  } | undefined>(undefined);

  useEffect(() => {
    if (!recovery || !recoveryOwnerId || autosave.dirty) return;
    const recoveryKey = `${moment.id}\u0000${recoveryOwnerId}`;
    if (restoredRecoveryRef.current === recoveryKey) return;
    let lookup = recoveryLookupRef.current;
    if (!lookup || lookup.key !== recoveryKey) {
      const promise = readMomentOutbox(
        recovery,
        moment.id,
        moment.journeyId,
        recoveryOwnerId,
        recoveryClaimOwner,
      ).then(async (record) => ({
        record,
        remote: record
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
      ({ record, remote }) => {
        if (!active || restoredRecoveryRef.current === recoveryKey || autosave.dirty) return;
        restoredRecoveryRef.current = recoveryKey;
        if (!record || !remote) return;
        acceptedMomentRef.current = remote;
        const recovered = applyMomentPatch(remote, record.envelope.patch);
        draftRef.current = recovered;
        setDraft(recovered);
        onMomentChange(recovered);
        autosave.enqueue(record.envelope);
      },
      () => {
        if (active && recoveryLookupRef.current === lookup) recoveryLookupRef.current = undefined;
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
    recoveryClaimOwner,
    recoveryOwnerId,
    repository.getPrivateJourneyStory,
  ]);
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
  const saveLabel = autosave.state === 'saving'
    ? '時刻儲存中'
    : autosave.state === 'saved'
      ? '時刻已儲存'
      : autosave.state === 'error'
        ? '時刻儲存失敗'
        : autosave.dirty ? '時刻尚未儲存' : '';

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
          disabled={deleting}
          onClick={() => void handleDelete()}
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </div>
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
    </div>
  );
}
