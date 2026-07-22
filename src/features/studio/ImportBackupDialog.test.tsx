import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BackupService,
  ImportPlan,
  ImportResult,
} from '../../backup/backupService';
import { BackupError } from '../../backup/backupManifest';
import {
  RepositoryProvider,
  useRepositoryRevision,
} from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { STORAGE_CAPACITY_GUIDANCE, StorageCapacityError } from '../../data/storageErrors';
import { ImportBackupDialog } from './ImportBackupDialog';

const validPlan: ImportPlan = {
  summary: { journeys: 2, moments: 3, photos: 4 },
  snapshot: { journeys: [], moments: [], songs: [], photos: [] },
  remapped: false,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function backupStub(overrides: Partial<BackupService> = {}) {
  return {
    exportBackup: vi.fn(),
    planImport: vi.fn(),
    commitImport: vi.fn(),
    clearPrivateData: vi.fn(),
    ...overrides,
  } as unknown as BackupService;
}

function RevisionProbe() {
  return <output aria-label="repository revision">{useRepositoryRevision()}</output>;
}

function renderDialog(
  backup: BackupService,
  file = new File(['backup'], 'journey.soundpassport'),
  onClose = vi.fn(),
  strict = false,
) {
  const content = (
    <RepositoryProvider services={{ query: fixtureJourneyRepository, backup }}>
      <ImportBackupDialog backup={backup} file={file} onClose={onClose} open />
      <RevisionProbe />
    </RepositoryProvider>
  );
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}

function ImportDialogHarness({ backup, file }: { backup: BackupService; file: File }) {
  const [open, setOpen] = useState(false);
  return (
    <RepositoryProvider services={{ query: fixtureJourneyRepository, backup }}>
      <button type="button" onClick={() => setOpen(true)}>開啟匯入對話框</button>
      <ImportBackupDialog
        backup={backup}
        file={file}
        onClose={() => setOpen(false)}
        open={open}
      />
      <RevisionProbe />
    </RepositoryProvider>
  );
}

describe('ImportBackupDialog', () => {
  afterEach(cleanup);

  it('localizes a typed validation error and never commits an invalid plan', async () => {
    const backup = backupStub({
      planImport: vi.fn(async () => {
        throw new BackupError('checksum_mismatch', 'Photo hash mismatch');
      }),
    });

    renderDialog(backup);

    expect(await screen.findByRole('alert')).toHaveTextContent('備份照片驗證失敗，無法匯入。');
    expect(backup.planImport).toHaveBeenCalledTimes(1);
    expect(backup.commitImport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');
  });

  it('shows exact additive counts and invalidates queries only after confirmation commits', async () => {
    const user = userEvent.setup();
    const commitImport = vi.fn(async () => ({ summary: { ...validPlan.summary } }));
    const backup = backupStub({
      planImport: vi.fn(async () => validPlan),
      commitImport,
    });
    renderDialog(backup);

    const dialog = await screen.findByRole('dialog', { name: '匯入私人備份' });
    expect(await within(dialog).findByText('2 趟旅程')).toBeInTheDocument();
    expect(within(dialog).getByText('3 個時刻')).toBeInTheDocument();
    expect(within(dialog).getByText('4 張照片')).toBeInTheDocument();
    expect(within(dialog).getByText('匯入只會新增資料，不會刪除目前的私人旅程。')).toBeVisible();
    expect(commitImport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');

    await user.click(within(dialog).getByRole('button', { name: '確認匯入' }));

    await waitFor(() => expect(commitImport).toHaveBeenCalledWith(validPlan));
    expect(await within(dialog).findByText('匯入完成')).toBeInTheDocument();
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('1');
  });

  it('submits once, blocks same-batch dismissal while pending, and preserves the primary action through success', async () => {
    const user = userEvent.setup();
    const commit = deferred<ImportResult>();
    const onClose = vi.fn();
    let confirmAction!: HTMLButtonElement;
    let cancelAction!: HTMLButtonElement;
    let backdrop!: HTMLElement;
    const commitImport = vi.fn(() => {
      confirmAction.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      }));
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      cancelAction.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return commit.promise;
    });
    const backup = backupStub({
      planImport: vi.fn(async () => validPlan),
      commitImport,
    });
    renderDialog(backup, new File(['backup'], 'journey.soundpassport'), onClose);

    const dialog = await screen.findByRole('dialog', { name: '匯入私人備份' });
    expect(await within(dialog).findByText('2 趟旅程')).toBeInTheDocument();
    confirmAction = within(dialog).getByRole('button', { name: '確認匯入' });
    cancelAction = within(dialog).getByRole('button', { name: '取消' });
    backdrop = dialog.parentElement!;
    const actions = confirmAction.closest('.dialog-actions') as HTMLElement;
    confirmAction.focus();

    await user.click(confirmAction);

    expect(commitImport).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');
    expect(within(actions).getAllByRole('button')).toHaveLength(2);
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      commit.resolve({ summary: { ...validPlan.summary } });
      await commit.promise;
    });

    expect(await within(dialog).findByText('匯入完成')).toBeInTheDocument();
    const completeAction = within(dialog).getByRole('button', { name: '完成' });
    expect(completeAction).toBe(confirmAction);
    expect(within(actions).getAllByRole('button')).toHaveLength(2);
    expect(completeAction).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('1');
  });

  it('keeps focus in the dialog after commit failure, skips invalidation, and safely restores focus on close', async () => {
    const user = userEvent.setup();
    const commit = deferred<ImportResult>();
    const file = new File(['backup'], 'journey.soundpassport');
    const backup = backupStub({
      planImport: vi.fn(async () => validPlan),
      commitImport: vi.fn(() => commit.promise),
    });
    render(<ImportDialogHarness backup={backup} file={file} />);
    const opener = screen.getByRole('button', { name: '開啟匯入對話框' });

    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: '匯入私人備份' });
    expect(await within(dialog).findByText('2 趟旅程')).toBeInTheDocument();
    const confirmAction = within(dialog).getByRole('button', { name: '確認匯入' });
    confirmAction.focus();
    await user.click(confirmAction);
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');

    await act(async () => {
      commit.reject(new Error('commit failed'));
      await commit.promise.catch(() => undefined);
    });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '無法驗證備份檔，請確認檔案後再試一次。',
    );
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');
    const closeAction = within(dialog).getByRole('button', { name: '關閉' });
    expect(closeAction).toBe(confirmAction);
    expect(closeAction).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.click(closeAction);

    expect(screen.queryByRole('dialog', { name: '匯入私人備份' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('uses centralized backup and deletion guidance for a storage-capacity failure', async () => {
    const user = userEvent.setup();
    const backup = backupStub({
      planImport: vi.fn(async () => validPlan),
      commitImport: vi.fn(async () => {
        throw new StorageCapacityError(new DOMException('quota', 'QuotaExceededError'));
      }),
    });
    renderDialog(backup);

    const dialog = await screen.findByRole('dialog', { name: '匯入私人備份' });
    await within(dialog).findByText('2 趟旅程');
    await user.click(within(dialog).getByRole('button', { name: '確認匯入' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(STORAGE_CAPACITY_GUIDANCE);
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');
  });

  it('deduplicates a rejected in-flight plan under StrictMode without leaking the rejection', async () => {
    const planning = deferred<ImportPlan>();
    const planImport = vi.fn(() => planning.promise);
    const backup = backupStub({ planImport });

    renderDialog(backup, new File(['backup'], 'journey.soundpassport'), vi.fn(), true);
    await waitFor(() => expect(planImport).toHaveBeenCalled());

    await act(async () => {
      planning.reject(new BackupError('invalid_container', 'not a zip'));
      await planning.promise.catch(() => undefined);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法讀取備份檔，請選擇有效的 Sound Passport 備份。',
    );
    expect(planImport).toHaveBeenCalledTimes(1);
  });

  it('replans the same service and file after a settled StrictMode plan', async () => {
    const firstPlanning = deferred<ImportPlan>();
    const secondPlanning = deferred<ImportPlan>();
    let currentPlanning = firstPlanning;
    const planImport = vi.fn(() => currentPlanning.promise);
    const backup = backupStub({ planImport });
    const file = new File(['backup'], 'journey.soundpassport');

    const firstRender = renderDialog(backup, file, vi.fn(), true);
    await act(async () => {
      firstPlanning.resolve(validPlan);
      await firstPlanning.promise;
    });
    expect(await screen.findByText('2 趟旅程')).toBeInTheDocument();
    const firstCallCount = planImport.mock.calls.length;
    firstRender.unmount();

    currentPlanning = secondPlanning;
    renderDialog(backup, file, vi.fn(), true);
    await act(async () => {
      secondPlanning.resolve(validPlan);
      await secondPlanning.promise;
    });
    expect(await screen.findByText('2 趟旅程')).toBeInTheDocument();

    expect(firstCallCount).toBe(1);
    expect(planImport).toHaveBeenCalledTimes(2);
  });
});
