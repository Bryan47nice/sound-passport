import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupService } from '../../backup/backupService';
import {
  RepositoryProvider,
  useRepositoryRevision,
} from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { PrivateDataPort } from '../../data/ports';
import { ClearPrivateDataDialog } from './ClearPrivateDataDialog';

function RevisionProbe() {
  return <output aria-label="repository revision">{useRepositoryRevision()}</output>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function privateDataStub(): PrivateDataPort {
  return {
    exportSnapshot: vi.fn(async () => ({ journeys: [], moments: [], songs: [], photos: [] })),
    importSnapshot: vi.fn(),
    clearPrivateData: vi.fn(),
  };
}

describe('ClearPrivateDataDialog', () => {
  afterEach(cleanup);

  it('requires the exact typed phrase, clears only private data, and invalidates live queries', async () => {
    const user = userEvent.setup();
    const privateData = privateDataStub();
    const backup = new BackupService(privateData);
    const fixtureSummariesBefore = await fixtureJourneyRepository.listCountrySummaries();
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, backup }}>
        <ClearPrivateDataDialog backup={backup} onClose={vi.fn()} open />
        <RevisionProbe />
      </RepositoryProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: '清除私人資料' });
    const confirmation = within(dialog).getByRole('textbox', { name: '輸入確認文字' });
    const clear = within(dialog).getByRole('button', { name: '永久清除私人資料' });

    expect(within(dialog).getByText('清除我的私人旅程')).toBeVisible();
    expect(clear).toBeDisabled();
    await user.type(confirmation, '清除我的私人旅');
    expect(clear).toBeDisabled();
    await user.clear(confirmation);
    await user.type(confirmation, '清除我的私人旅程');
    expect(clear).toBeEnabled();

    await user.click(clear);

    await waitFor(() => expect(privateData.clearPrivateData).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('1');
    expect(await fixtureJourneyRepository.listCountrySummaries()).toEqual(fixtureSummariesBefore);
  });

  it('submits once, blocks same-batch dismissal, and invalidates only after a failed clear is retried successfully', async () => {
    const user = userEvent.setup();
    const firstClear = deferred<void>();
    const secondClear = deferred<void>();
    const privateData = privateDataStub();
    const clearPrivateData = vi.mocked(privateData.clearPrivateData);
    const backup = new BackupService(privateData);
    const onClose = vi.fn();
    let clearAction!: HTMLButtonElement;
    let cancelAction!: HTMLButtonElement;
    let backdrop!: HTMLElement;
    clearPrivateData
      .mockImplementationOnce(() => {
        clearAction.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Escape',
        }));
        backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        cancelAction.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return firstClear.promise;
      })
      .mockImplementationOnce(() => secondClear.promise);
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, backup }}>
        <ClearPrivateDataDialog backup={backup} onClose={onClose} open />
        <RevisionProbe />
      </RepositoryProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: '清除私人資料' });
    const confirmation = within(dialog).getByRole('textbox', { name: '輸入確認文字' });
    clearAction = within(dialog).getByRole('button', { name: '永久清除私人資料' });
    cancelAction = within(dialog).getByRole('button', { name: '取消' });
    backdrop = dialog.parentElement!;
    await user.type(confirmation, '清除我的私人旅程');

    await user.click(clearAction);

    expect(clearPrivateData).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');

    await act(async () => {
      firstClear.reject(new Error('clear failed'));
      await firstClear.promise.catch(() => undefined);
    });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '無法清除私人資料，現有資料仍完整保留，請再試一次。',
    );
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');
    expect(clearAction).toBeEnabled();

    await user.click(clearAction);
    expect(clearPrivateData).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('0');

    await act(async () => {
      secondClear.resolve();
      await secondClear.promise;
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('repository revision')).toHaveTextContent('1');
  });
});
