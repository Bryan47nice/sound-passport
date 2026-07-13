import { Download, Trash2, Upload } from 'lucide-react';
import {
  useRef,
  useState,
  type ChangeEvent,
  type PropsWithChildren,
} from 'react';
import { useBackupService } from '../../data/RepositoryContext';
import { ClearPrivateDataDialog } from './ClearPrivateDataDialog';
import { ImportBackupDialog } from './ImportBackupDialog';

function backupFilename(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `sound-passport-${year}-${month}-${day}.soundpassport`;
}

export function BackupControls({ children }: PropsWithChildren) {
  const backup = useBackupService();
  const inputRef = useRef<HTMLInputElement>(null);
  const exportPendingRef = useRef(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [importFile, setImportFile] = useState<File>();
  const [clearOpen, setClearOpen] = useState(false);
  const [status, setStatus] = useState('');

  const exportBackup = async () => {
    if (exportPendingRef.current) return;
    exportPendingRef.current = true;
    setExportBusy(true);
    setStatus('');
    let objectUrl: string | undefined;
    try {
      const blob = await backup.exportBackup();
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = backupFilename(new Date());
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      setStatus('私人備份已下載。');
    } catch {
      setStatus('無法匯出備份，私人資料未受影響，請再試一次。');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      exportPendingRef.current = false;
      setExportBusy(false);
    }
  };

  const chooseImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setImportFile(file);
  };

  return (
    <div>
      <div className="studio-toolbar" role="toolbar" aria-label="旅程工具">
        {children}
        <button
          className="icon-command"
          type="button"
          disabled={exportBusy}
          title="匯出私人備份"
          aria-label="匯出私人備份"
          onClick={() => void exportBackup()}
        >
          <Download size={18} aria-hidden="true" />
        </button>
        <button
          className="icon-command"
          type="button"
          title="匯入私人備份"
          aria-label="匯入私人備份"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={18} aria-hidden="true" />
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".soundpassport"
          aria-label="選擇 Sound Passport 備份檔"
          onChange={chooseImport}
        />
        <button
          className="icon-command"
          type="button"
          title="清除私人資料"
          aria-label="清除私人資料"
          onClick={() => setClearOpen(true)}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="field-error">備份檔包含您的私人照片與文字，請妥善保管。</p>
      <span className="visually-hidden" role="status" aria-live="polite">{status}</span>
      {importFile && (
        <ImportBackupDialog
          backup={backup}
          file={importFile}
          open
          onClose={() => setImportFile(undefined)}
          onImported={(summary) => {
            setStatus(`已匯入 ${summary.journeys} 趟旅程、${summary.moments} 個時刻與 ${summary.photos} 張照片。`);
          }}
        />
      )}
      <ClearPrivateDataDialog
        backup={backup}
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onCleared={() => setStatus('私人資料已清除，內建示範旅程仍可使用。')}
      />
    </div>
  );
}
