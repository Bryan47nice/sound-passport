import { useEffect, useId, useRef, useState } from 'react';
import type { BackupService } from '../../backup/backupService';
import { useInvalidateRepositoryQueries } from '../../data/RepositoryContext';
import { AccessibleDialog } from './AccessibleDialog';

const CLEAR_CONFIRMATION = '清除我的私人旅程';

interface ClearPrivateDataDialogProps {
  backup: BackupService;
  onCleared?: () => void;
  onClose: () => void;
  open: boolean;
}

export function ClearPrivateDataDialog({
  backup,
  onCleared,
  onClose,
  open,
}: ClearPrivateDataDialogProps) {
  const descriptionId = useId();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clearPendingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setConfirmation('');
    setBusy(false);
    setError('');
    clearPendingRef.current = false;
  }, [open]);

  const clearPrivateData = async () => {
    if (confirmation !== CLEAR_CONFIRMATION || clearPendingRef.current) return;
    clearPendingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await backup.clearPrivateData();
      invalidateQueries();
      onCleared?.();
      onClose();
    } catch {
      setError('無法清除私人資料，現有資料仍完整保留，請再試一次。');
    } finally {
      clearPendingRef.current = false;
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (!clearPendingRef.current) onClose();
  };

  return (
    <AccessibleDialog
      descriptionId={descriptionId}
      onDismiss={requestClose}
      open={open}
      title="清除私人資料"
    >
      <p id={descriptionId}>這會永久刪除您建立的旅程、時刻、照片與文字，且無法復原。內建示範旅程不受影響。</p>
      <p>請輸入 <strong>{CLEAR_CONFIRMATION}</strong> 以確認。</p>
      <div className="journey-create-form">
        <label className="form-wide">
          輸入確認文字
          <input
            autoComplete="off"
            disabled={busy}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={requestClose}>取消</button>
        <button
          className="destructive-command"
          type="button"
          disabled={busy || confirmation !== CLEAR_CONFIRMATION}
          onClick={() => void clearPrivateData()}
        >
          {busy ? '清除中' : '永久清除私人資料'}
        </button>
      </div>
    </AccessibleDialog>
  );
}
