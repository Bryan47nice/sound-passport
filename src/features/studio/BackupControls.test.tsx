import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('uses the extension only as a picker filter and still validates the selected contents', async () => {
    const invalidBackup = new File(['not a zip'], 'renamed.soundpassport');
    const planImport = vi.fn(async () => {
      throw new BackupError('invalid_container', 'not a zip');
    });
    const backup = backupStub({ planImport });
    renderControls(backup);
    const input = screen.getByLabelText('選擇 Sound Passport 備份檔');

    expect(input).toHaveAttribute('accept', '.soundpassport');
    fireEvent.change(input, { target: { files: [invalidBackup] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('無法讀取備份檔，請選擇有效的 Sound Passport 備份。');
    expect(planImport).toHaveBeenCalledTimes(1);
    expect(planImport).toHaveBeenCalledWith(invalidBackup);
    expect(backup.commitImport).not.toHaveBeenCalled();
  });
});
