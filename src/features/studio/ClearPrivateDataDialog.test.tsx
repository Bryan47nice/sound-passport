import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
});
