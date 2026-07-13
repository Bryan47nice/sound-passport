import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  BackupService,
  ImportPlan,
  ImportSummary,
} from '../../backup/backupService';
import { BackupError } from '../../backup/backupManifest';
import { useInvalidateRepositoryQueries } from '../../data/RepositoryContext';
import { AccessibleDialog } from './AccessibleDialog';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; plan: ImportPlan }
  | { kind: 'committing'; plan: ImportPlan }
  | { kind: 'complete'; summary: ImportSummary };

interface ImportBackupDialogProps {
  backup: BackupService;
  file: File;
  onClose: () => void;
  onImported?: (summary: ImportSummary) => void;
  open: boolean;
}

const inFlightImportPlans = new WeakMap<
  BackupService,
  WeakMap<File, Promise<ImportPlan>>
>();

function planImportInFlight(backup: BackupService, file: File) {
  let plansByFile = inFlightImportPlans.get(backup);
  if (!plansByFile) {
    plansByFile = new WeakMap();
    inFlightImportPlans.set(backup, plansByFile);
  }
  const existing = plansByFile.get(file);
  if (existing) return existing;

  const request = Promise.resolve().then(() => backup.planImport(file));
  plansByFile.set(file, request);
  const release = () => {
    if (plansByFile.get(file) === request) plansByFile.delete(file);
  };
  void request.then(release, release);
  return request;
}

function localizedImportError(error: unknown) {
  if (!(error instanceof BackupError)) {
    return '無法驗證備份檔，請確認檔案後再試一次。';
  }
  switch (error.code) {
    case 'invalid_container':
      return '無法讀取備份檔，請選擇有效的 Sound Passport 備份。';
    case 'unsupported_version':
      return '這個備份版本目前不支援，無法匯入。';
    case 'invalid_manifest':
      return '備份內容格式不正確，無法匯入。';
    case 'missing_photo':
      return '備份缺少照片檔案，無法匯入。';
    case 'checksum_mismatch':
      return '備份照片驗證失敗，無法匯入。';
    case 'relationship_error':
      return '備份中的旅程資料關聯不完整，無法匯入。';
    case 'stale_plan':
      return '私人資料已變更，請重新選擇備份檔。';
    case 'limit_exceeded':
      return '備份檔超過允許大小，無法匯入。';
  }
}

export function ImportBackupDialog({
  backup,
  file,
  onClose,
  onImported,
  open,
}: ImportBackupDialogProps) {
  const descriptionId = useId();
  const invalidateQueries = useInvalidateRepositoryQueries();
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const commitPendingRef = useRef(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setState({ kind: 'idle' });
      return;
    }
    let isCurrent = true;
    setState({ kind: 'validating' });
    void planImportInFlight(backup, file).then(
      (plan) => { if (isCurrent) setState({ kind: 'ready', plan }); },
      (error: unknown) => {
        if (isCurrent) setState({ kind: 'invalid', message: localizedImportError(error) });
      },
    );
    return () => { isCurrent = false; };
  }, [backup, file, open]);

  useLayoutEffect(() => {
    if (open && (state.kind === 'complete' || state.kind === 'invalid')) {
      primaryActionRef.current?.focus();
    }
  }, [open, state.kind]);

  const requestClose = () => {
    if (!commitPendingRef.current) onClose();
  };

  const confirmImport = async () => {
    if (state.kind !== 'ready' || commitPendingRef.current) return;
    const plan = state.plan;
    commitPendingRef.current = true;
    setState({ kind: 'committing', plan });
    try {
      const result = await backup.commitImport(plan);
      invalidateQueries();
      onImported?.(result.summary);
      setState({ kind: 'complete', summary: result.summary });
    } catch (error) {
      setState({ kind: 'invalid', message: localizedImportError(error) });
    } finally {
      commitPendingRef.current = false;
    }
  };

  const busy = state.kind === 'committing';
  const summary = state.kind === 'ready' || state.kind === 'committing'
    ? state.plan.summary
    : state.kind === 'complete'
      ? state.summary
      : undefined;
  const primaryLabel = state.kind === 'validating'
    ? '驗證中'
    : state.kind === 'committing'
      ? '匯入中'
      : state.kind === 'complete'
        ? '完成'
        : state.kind === 'invalid'
          ? '關閉'
          : '確認匯入';
  const primaryDisabled = state.kind === 'idle' || state.kind === 'validating';

  return (
    <AccessibleDialog
      descriptionId={descriptionId}
      onDismiss={requestClose}
      open={open}
      title="匯入私人備份"
    >
      <p id={descriptionId}>匯入只會新增資料，不會刪除目前的私人旅程。</p>
      {state.kind === 'validating' && <p role="status">正在驗證備份內容…</p>}
      {summary && (
        <ul aria-label="備份內容摘要">
          <li>{summary.journeys} 趟旅程</li>
          <li>{summary.moments} 個時刻</li>
          <li>{summary.photos} 張照片</li>
        </ul>
      )}
      {(state.kind === 'ready' || state.kind === 'committing') && state.plan.remapped && (
        <p>重複的資料識別碼會在匯入時安全重新編號。</p>
      )}
      {state.kind === 'invalid' && <p className="field-error" role="alert">{state.message}</p>}
      {state.kind === 'complete' && <p role="status">匯入完成</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={requestClose}>
          {state.kind === 'complete' ? '關閉' : '取消'}
        </button>
        <button
          ref={primaryActionRef}
          className="primary-command"
          type="button"
          disabled={primaryDisabled || busy}
          onClick={() => {
            if (state.kind === 'complete' || state.kind === 'invalid') requestClose();
            else void confirmImport();
          }}
        >
          {primaryLabel}
        </button>
      </div>
    </AccessibleDialog>
  );
}
