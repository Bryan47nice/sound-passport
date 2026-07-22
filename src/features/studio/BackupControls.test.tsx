import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupService } from '../../backup/backupService';
import { BackupError } from '../../backup/backupManifest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { BackupControls } from './BackupControls';

function backupStub(overrides: Partial<BackupService> = {}) {
  return {
    exportBackup: vi.fn(async () => new Blob(['backup'])),
    planImport: vi.fn(),
    commitImport: vi.fn(),
    clearPrivateData: vi.fn(),
    ...overrides,
  } as unknown as BackupService;
}

function renderControls(backup: BackupService) {
  return render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, backup }}>
      <BackupControls />
    </RepositoryProvider>,
  );
}

function expectedFilename(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `sound-passport-${year}-${month}-${day}.soundpassport`;
}

describe('BackupControls', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads one dated backup, removes its anchor, revokes its URL, and warns about private content', async () => {
    const user = userEvent.setup();
    const backupBlob = new Blob(['private backup']);
    const backup = backupStub({ exportBackup: vi.fn(async () => backupBlob) });
    const createObjectURL = vi.fn(() => 'blob:sound-passport-backup');
    const revokeObjectURL = vi.fn();
    const NativeURL = URL;
    class MockURL extends NativeURL {}
    Object.assign(MockURL, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', MockURL);
    let clickedAnchor: HTMLAnchorElement | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureAnchor(
      this: HTMLAnchorElement,
    ) {
      clickedAnchor = this;
    });
    const filename = expectedFilename(new Date());

    renderControls(backup);

    expect(screen.getByText('備份檔包含您的私人照片與文字，請妥善保管。')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '匯出私人備份' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(backup.exportBackup).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(backupBlob);
    expect(clickedAnchor).toMatchObject({ download: filename, href: 'blob:sound-passport-backup' });
    expect(clickedAnchor).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sound-passport-backup');
  });

  it('shows a visible localized alert when export fails', async () => {
    const user = userEvent.setup();
    const backup = backupStub({
      exportBackup: vi.fn(async () => {
        throw new Error('export failed');
      }),
    });
    renderControls(backup);

    await user.click(screen.getByRole('button', { name: '匯出私人備份' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法匯出備份，私人資料未受影響，請再試一次。',
    );
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('keeps the native file input out of the tab order and uses the visible import button as its trigger', async () => {
    const user = userEvent.setup();
    const { container } = renderControls(backupStub());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const clickInput = vi.spyOn(input!, 'click').mockImplementation(() => undefined);
    const exportButton = screen.getByRole('button', { name: '匯出私人備份' });
    const importButton = screen.getByRole('button', { name: '匯入私人備份' });
    const clearButton = screen.getByRole('button', { name: '清除私人資料' });

    await user.click(importButton);
    expect(clickInput).toHaveBeenCalledTimes(1);

    exportButton.focus();
    await user.tab();
    expect(importButton).toHaveFocus();
    await user.tab();
    expect(clearButton).toHaveFocus();
    expect(input).toHaveAttribute('accept', '.soundpassport');
    expect(input).toHaveAttribute('tabindex', '-1');
    expect(input).toHaveAttribute('aria-hidden', 'true');
  });

  it('validates selected contents and restores focus to the visible import button after close', async () => {
    const user = userEvent.setup();
    const invalidBackup = new File(['not a zip'], 'renamed.soundpassport');
    const planImport = vi.fn(async () => {
      throw new BackupError('invalid_container', 'not a zip');
    });
    const backup = backupStub({ planImport });
    const { container } = renderControls(backup);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const importButton = screen.getByRole('button', { name: '匯入私人備份' });
    expect(input).not.toBeNull();

    expect(input).toHaveAttribute('accept', '.soundpassport');
    input!.focus();
    fireEvent.change(input!, { target: { files: [invalidBackup] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('無法讀取備份檔，請選擇有效的 Sound Passport 備份。');
    expect(planImport).toHaveBeenCalledTimes(1);
    expect(planImport).toHaveBeenCalledWith(invalidBackup);
    expect(backup.commitImport).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: '匯入私人備份' });
    await user.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog', { name: '匯入私人備份' })).not.toBeInTheDocument();
    expect(importButton).toHaveFocus();
  });
});
