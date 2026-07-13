import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCombinedJourneyRepository } from '../../data/combinedJourneyRepository';
import { openSoundPassportDb } from '../../data/indexedDb';
import { createIndexedDbJourneyRepository } from '../../data/indexedDbJourneyRepository';
import {
  RepositoryProvider,
  useInvalidateRepositoryQueries,
  useJourneyEditorRepository,
} from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyRepository } from '../../data/ports';
import { cleanupDb, uniqueDbName } from '../../test/indexedDb';
import { seedPrivateReviewJourney } from '../../test/privateJourney';
import { AtlasPage } from './AtlasPage';

vi.mock('./WorldMap', () => ({
  WorldMap: ({ countries, onCountrySelect }: {
    countries: Array<{ countryCode: string; countryName: string; journeyCount: number }>;
    onCountrySelect: (countryCode: string) => void;
  }) => (
    <div aria-label="旅行世界地圖">
      {countries.map((country) => (
        <button key={country.countryCode} onClick={() => onCountrySelect(country.countryCode)}>
          {country.countryName}，{country.journeyCount} 趟旅程
        </button>
      ))}
    </div>
  ),
}));

function LocationProbe() {
  return <output aria-label="目前路徑">{useLocation().pathname}</output>;
}

function PublishingControls({
  journeyId,
  journeyUpdatedAt,
  momentId,
  momentUpdatedAt,
}: {
  journeyId: string;
  journeyUpdatedAt: string;
  momentId: string;
  momentUpdatedAt: string;
}) {
  const editor = useJourneyEditorRepository();
  const invalidateQueries = useInvalidateRepositoryQueries();
  return (
    <>
      <button type="button" onClick={() => void editor.setJourneyStatus(journeyId, 'complete', {
        expectedUpdatedAt: journeyUpdatedAt,
      }).then(() => invalidateQueries())}>完成私人旅程</button>
      <button type="button" onClick={() => void editor.updateMoment(momentId, {
        song: { title: '', artist: '測試歌手', sourceUrl: '' },
      }, { expectedUpdatedAt: momentUpdatedAt }).then(() => invalidateQueries())}>移除必填歌名</button>
    </>
  );
}

describe('AtlasPage', () => {
  afterEach(cleanup);

  it('lists visited countries and opens the selected country', async () => {
    const user = userEvent.setup();
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<><AtlasPage /><LocationProbe /></>} />
            <Route path="/countries/:countryCode" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect((await screen.findAllByText('日本')).length).toBeGreaterThan(0);
    expect(screen.getByText('聽見過的地方')).toBeInTheDocument();
    expect(screen.getAllByText(/2 趟旅程/).length).toBeGreaterThan(0);
    expect(screen.getByText('韓國')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '日本，2 趟旅程' }));
    expect(screen.getByLabelText('目前路徑')).toHaveTextContent('/countries/JP');
  });

  it('publishes a private review live, then removes it from Atlas in the same invalidating save', async () => {
    const user = userEvent.setup();
    const dbName = uniqueDbName('atlas-private-publishing');
    const db = await openSoundPassportDb(dbName);
    try {
      const privateRepository = createIndexedDbJourneyRepository({ db });
      const reviewStory = await seedPrivateReviewJourney(privateRepository);
      const query = createCombinedJourneyRepository(fixtureJourneyRepository, privateRepository);

      render(
        <RepositoryProvider services={{ query, editor: privateRepository }}>
          <MemoryRouter>
            <AtlasPage />
            <PublishingControls
              journeyId={reviewStory.journey.id}
              journeyUpdatedAt={reviewStory.journey.updatedAt}
              momentId={reviewStory.moments[0].id}
              momentUpdatedAt={reviewStory.moments[0].updatedAt}
            />
          </MemoryRouter>
        </RepositoryProvider>,
      );

      await screen.findAllByText('日本');
      expect(screen.queryByText('臺灣')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '完成私人旅程' }));
      expect(await screen.findByRole('button', { name: '臺灣，1 趟旅程' })).toBeInTheDocument();
      expect(screen.getByText('1 趟旅程 · 花蓮海岸公路')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '移除必填歌名' }));
      await waitFor(() => expect(screen.queryByText('臺灣')).not.toBeInTheDocument());
      await expect(privateRepository.getJourneyStory(reviewStory.journey.id)).resolves.toBeUndefined();
      expect((await privateRepository.getPrivateJourneyStory(reviewStory.journey.id))?.journey.status).toBe('review');
    } finally {
      cleanup();
      db.close();
      await cleanupDb(dbName);
    }
  });

  it('leaves loading, explains a query failure, and retries it', async () => {
    const user = userEvent.setup();
    const listCountrySummaries = vi.fn()
      .mockRejectedValueOnce(new Error('IndexedDB read failed'))
      .mockResolvedValueOnce([]);
    const repository: JourneyRepository = {
      listCountrySummaries,
      listJourneysByCountry: vi.fn(),
      getJourneyStory: vi.fn(),
    };
    render(
      <RepositoryProvider services={{ query: repository }}>
        <MemoryRouter><AtlasPage /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '無法讀取旅行地圖' })).toBeInTheDocument();
    expect(screen.queryByLabelText('載入旅行地圖')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新讀取' }));

    expect(await screen.findByRole('heading', { name: '還沒有旅行' })).toBeInTheDocument();
    expect(listCountrySummaries).toHaveBeenCalledTimes(2);
  });

  it('shows fixtures with explicit degradation guidance when private storage fails', async () => {
    const failingPrivate: JourneyRepository = {
      async listCountrySummaries() { throw new Error('IndexedDB failed'); },
      async listJourneysByCountry() { throw new Error('IndexedDB failed'); },
      async getJourneyStory() { throw new Error('IndexedDB failed'); },
    };
    const repository = createCombinedJourneyRepository(fixtureJourneyRepository, failingPrivate);
    render(
      <RepositoryProvider services={{ query: repository }}>
        <MemoryRouter><AtlasPage /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect((await screen.findAllByText('日本')).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('私人旅程暫時無法讀取，目前只顯示示範旅程');
    expect(screen.getByRole('button', { name: '重新讀取' })).toBeInTheDocument();
  });
});
