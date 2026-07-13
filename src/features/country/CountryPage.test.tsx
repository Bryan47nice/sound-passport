import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { createCombinedJourneyRepository } from '../../data/combinedJourneyRepository';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { openSoundPassportDb } from '../../data/indexedDb';
import { createIndexedDbJourneyRepository } from '../../data/indexedDbJourneyRepository';
import {
  RepositoryProvider,
  useInvalidateRepositoryQueries,
  useJourneyEditorRepository,
} from '../../data/RepositoryContext';
import type { JourneyRepository } from '../../data/ports';
import type { Journey } from '../../domain/model';
import { cleanupDb, uniqueDbName } from '../../test/indexedDb';
import { seedPrivateReviewJourney } from '../../test/privateJourney';
import { CountryPage } from './CountryPage';

function PublishControl({ journeyId, expectedUpdatedAt }: { journeyId: string; expectedUpdatedAt: string }) {
  const editor = useJourneyEditorRepository();
  const invalidateQueries = useInvalidateRepositoryQueries();
  return (
    <button type="button" onClick={() => void editor.setJourneyStatus(journeyId, 'complete', {
      expectedUpdatedAt,
    }).then(() => invalidateQueries())}>完成待整理旅程</button>
  );
}

describe('CountryPage', () => {
  afterEach(cleanup);

  it('shows repeat visits without starting media', async () => {
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter initialEntries={['/countries/JP']}>
          <Routes>
            <Route path="/countries/:countryCode" element={<CountryPage />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '日本' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /東京，雨停之後/ })).toHaveAttribute('href', '/journeys/tokyo-2024');
    expect(screen.getByRole('link', { name: /京都，安靜的顏色/ })).toHaveAttribute('href', '/journeys/kyoto-2023');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('does not show stale journeys while a new country request is pending', async () => {
    const user = userEvent.setup();
    let resolvePendingCountry!: (journeys: Journey[]) => void;
    const repository: JourneyRepository = {
      ...fixtureJourneyRepository,
      listJourneysByCountry(countryCode) {
        if (countryCode === 'JP') return fixtureJourneyRepository.listJourneysByCountry(countryCode);
        return new Promise((resolve) => {
          resolvePendingCountry = resolve;
        });
      },
    };

    const { container } = render(
      <RepositoryProvider services={{ query: repository }}>
        <MemoryRouter initialEntries={['/countries/JP']}>
          <Routes>
            <Route path="/countries/:countryCode" element={<><CountryPage /><Link to="/countries/XX">切換國家</Link></>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );
    const page = within(container);

    expect(await page.findByRole('heading', { name: '日本' })).toBeInTheDocument();
    await user.click(page.getByRole('link', { name: '切換國家' }));

    expect(page.getByLabelText('載入國家旅程')).toBeInTheDocument();
    expect(page.queryByText('東京，雨停之後')).not.toBeInTheDocument();

    resolvePendingCountry([]);
    expect(await page.findByRole('heading', { name: '找不到這個國家的旅程' })).toBeInTheDocument();
  });

  it('refetches a mounted country route when a private review becomes complete', async () => {
    const user = userEvent.setup();
    const dbName = uniqueDbName('country-private-publishing');
    const db = await openSoundPassportDb(dbName);
    try {
      const privateRepository = createIndexedDbJourneyRepository({ db });
      const reviewStory = await seedPrivateReviewJourney(privateRepository);
      const query = createCombinedJourneyRepository(fixtureJourneyRepository, privateRepository);

      render(
        <RepositoryProvider services={{ query, editor: privateRepository }}>
          <MemoryRouter initialEntries={['/countries/TW']}>
            <Routes>
              <Route path="/countries/:countryCode" element={(
                <>
                  <CountryPage />
                  <PublishControl
                    journeyId={reviewStory.journey.id}
                    expectedUpdatedAt={reviewStory.journey.updatedAt}
                  />
                </>
              )} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>,
      );

      expect(await screen.findByRole('heading', { name: '找不到這個國家的旅程' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '完成待整理旅程' }));

      expect(await screen.findByRole('heading', { name: '臺灣' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /花蓮海岸公路/ })).toHaveAttribute(
        'href',
        `/journeys/${reviewStory.journey.id}`,
      );
    } finally {
      cleanup();
      db.close();
      await cleanupDb(dbName);
    }
  });
});
