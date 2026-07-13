import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupService, ImportPlan } from '../../backup/backupService';
import { BackupError } from '../../backup/backupManifest';
import {
  RepositoryProvider,
  useRepositoryRevision,
} from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { ImportBackupDialog } from './ImportBackupDialog';

const validPlan: ImportPlan = {
  summary: { journeys: 2, moments: 3, photos: 4 },
  snapshot: { journeys: [], moments: [], songs: [], photos: [] },
  remapped: false,
};

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

function renderDialog(backup: BackupService, file = new File(['backup'], 'journey.soundpassport')) {
  return render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, backup }}>
      <ImportBackupDialog backup={backup} file={file} onClose={vi.fn()} open />
      <RevisionProbe />
    </RepositoryProvider>,
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
});
