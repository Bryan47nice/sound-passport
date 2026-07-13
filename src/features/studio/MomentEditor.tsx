import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MomentVersionConflictError, type JourneyEditorRepository } from '../../data/ports';
import type { JourneyMoment, MomentPatch, SongAvailability } from '../../domain/model';
import { parseYouTubeVideoId } from '../../domain/youtube';
import { useAutosave } from './useAutosave';

export interface MomentAutosaveRegistration {
  dirty: boolean;
  flush: () => Promise<void>;
}

interface MomentEditorProps {
  moment: JourneyMoment;
  position: number;
  repository: Pick<JourneyEditorRepository, 'updateMoment'>;
  onMomentChange: (moment: JourneyMoment) => void;
  onDelete: (momentId: string) => void | Promise<void>;
  onSaved?: () => void | Promise<void>;
  onAutosaveChange?: (registration: MomentAutosaveRegistration | undefined) => void;
}

function mergeMomentPatches(current: MomentPatch, next: MomentPatch): MomentPatch {
  return {
    ...current,
    ...next,
    song: next.song ?? current.song,
  };
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
}: MomentEditorProps) {
  const [draft, setDraft] = useState(moment);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'error'>('idle');
  const draftRef = useRef(moment);
  const acceptedVersionRef = useRef({ momentId: moment.id, updatedAt: moment.updatedAt });
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

  const save = useCallback(async (patch: MomentPatch) => {
    const momentId = moment.id;
    const expectedUpdatedAt = acceptedVersionRef.current.updatedAt;
    const updated = await repository.updateMoment(
      momentId,
      patch,
      { expectedUpdatedAt },
    );
    if (acceptedVersionRef.current.momentId !== momentId) return;
    acceptedVersionRef.current = { momentId, updatedAt: updated.updatedAt };
    if (mountedRef.current && draftRef.current.id === momentId) {
      const nextDraft = { ...draftRef.current, updatedAt: updated.updatedAt };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      onMomentChange(nextDraft);
      await refreshAfterSave();
    }
  }, [moment.id, onMomentChange, refreshAfterSave, repository]);
  const autosave = useAutosave({
    save,
    delay: 500,
    merge: mergeMomentPatches,
  });

  useEffect(() => {
    const accepted = acceptedVersionRef.current;
    if (accepted.momentId !== moment.id) {
      acceptedVersionRef.current = { momentId: moment.id, updatedAt: moment.updatedAt };
      draftRef.current = moment;
      setDraft(moment);
      refreshGenerationRef.current += 1;
      setRefreshState('idle');
      return;
    }
    if (autosave.dirty || moment.updatedAt < accepted.updatedAt) return;
    acceptedVersionRef.current = { momentId: moment.id, updatedAt: moment.updatedAt };
    draftRef.current = moment;
    setDraft(moment);
  }, [autosave.dirty, moment]);
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
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    onMomentChange(nextDraft);
    if (immediate) autosave.saveNow(patch);
    else autosave.enqueue(patch);
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
      song: {
        title: song.title,
        artist: song.artist,
        sourceUrl: song.sourceUrl,
      },
    });
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
          <button type="button" onClick={autosave.retry}>重試儲存</button>
        )}
      </div>
      {autosave.state === 'error' && autosave.error instanceof MomentVersionConflictError && (
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
