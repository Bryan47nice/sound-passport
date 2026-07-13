import { useId } from 'react';
import { AccessibleDialog } from './AccessibleDialog';

interface CompletionDialogProps {
  busy: boolean;
  error?: string;
  journeyTitle: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  open: boolean;
}

export function CompletionDialog({
  busy,
  error,
  journeyTitle,
  onCancel,
  onConfirm,
  open,
}: CompletionDialogProps) {
  const descriptionId = useId();
  return (
    <AccessibleDialog
      className="completion-dialog"
      descriptionId={descriptionId}
      onDismiss={() => { if (!busy) onCancel(); }}
      open={open}
      title="完成旅程"
    >
      <p id={descriptionId}>「{journeyTitle}」完成後會立即出現在世界地圖與播放器。</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onCancel}>返回預覽</button>
        <button
          className="primary-command"
          type="button"
          disabled={busy}
          onClick={() => void onConfirm()}
        >
          {busy ? '完成中' : '確認完成旅程'}
        </button>
      </div>
    </AccessibleDialog>
  );
}
