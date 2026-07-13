import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JourneyEditorRepository } from '../../data/ports';
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

  const save = useCallback(async (patch: MomentPatch) => {
    await repository.updateMoment(moment.id, patch);
    await onSaved?.();
  }, [moment.id, onSaved, repository]);
  const autosave = useAutosave({
    save,
    delay: 500,
    merge: mergeMomentPatches,
  });
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
    setDraft(nextDraft);
    onMomentChange(nextDraft);
    if (immediate) autosave.saveNow(patch);
    else autosave.enqueue(patch);
  };

  const updateField = <Key extends keyof Pick<JourneyMoment, 'cityLabel' | 'placeLabel' | 'caption'>>(
    field: Key,
    value: JourneyMoment[Key],
  ) => {
    const nextDraft = { ...draft, [field]: value };
    queueDraft(nextDraft, { [field]: value });
  };

  const updateReason = (reason: string) => {
    const reasonStatus: JourneyMoment['reasonStatus'] = reason.trim() ? 'complete' : 'needs_review';
    const nextDraft = { ...draft, reason, reasonStatus };
    queueDraft(nextDraft, { reason, reasonStatus });
  };

  const updateSong = (field: 'title' | 'artist' | 'sourceUrl', value: string) => {
    const sourceUrl = field === 'sourceUrl' ? value : draft.song.sourceUrl;
    const availability = linkState(sourceUrl);
    const providerItemId = sourceUrl?.trim() ? parseYouTubeVideoId(sourceUrl.trim()) : undefined;
    const song = {
      ...draft.song,
      [field]: value,
      sourceUrl,
      provider: sourceUrl?.trim() ? 'youtube' as const : 'manual' as const,
      providerItemId,
      availability,
    };
    const nextDraft = { ...draft, song };
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
              value={draft.localDate}
              onChange={(event) => {
                const localDate = event.target.value;
                queueDraft({ ...draft, localDate }, { localDate }, true);
              }}
            />
          </label>
          <label>時間
            <input
              type="time"
              value={draft.localTime ?? ''}
              onChange={(event) => {
                const localTime = event.target.value || undefined;
                queueDraft({ ...draft, localTime }, { localTime }, true);
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
            <input required value={draft.song.title} onChange={(event) => updateSong('title', event.target.value)} />
          </label>
          <label>歌手
            <input required value={draft.song.artist} onChange={(event) => updateSong('artist', event.target.value)} />
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
      {deleteError && <p className="field-error" role="alert">{deleteError}</p>}
    </div>
  );
}
