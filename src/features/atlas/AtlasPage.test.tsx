import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JourneyExperienceProvider } from '../../app/JourneyExperienceContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { RepositoryProvider } from '../../data/RepositoryContext';
import type { JourneyRepository } from '../../data/ports';
import { AtlasPage } from './AtlasPage';

vi.mock('./WorldMap', () => ({
  WorldMap: ({ countries, onCountrySelect }: {
    countries: Array<{ countryCode: string; countryName: string; journeyCount: number }>;
    onCountrySelect: (countryCode: string) => void;
  }) => <div aria-label="旅行世界地圖">{countries.map((country) => (
    <button key={country.countryCode} onClick={() => onCountrySelect(country.countryCode)}>
      {country.countryName}，{country.journeyCount} 趟旅程
    </button>
  ))}</div>,
}));

function LocationProbe() {
  return <output aria-label="目前路徑">{useLocation().pathname}</output>;
}

function renderAtlas(repository: JourneyRepository, kind: 'private' | 'demo', routePrefix: '' | '/demo') {
  return render(
    <RepositoryProvider services={{ query: repository, fixtures: fixtureJourneyRepository }}>
      <JourneyExperienceProvider kind={kind} routePrefix={routePrefix}>
        <MemoryRouter initialEntries={[routePrefix || '/']}>
          <Routes>
            <Route path="/" element={<><AtlasPage /><LocationProbe /></>} />
            <Route path="/demo" element={<><AtlasPage /><LocationProbe /></>} />
            <Route path="/demo/countries/:countryCode" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </JourneyExperienceProvider>
    </RepositoryProvider>,
  );
}

describe('AtlasPage', () => {
  afterEach(cleanup);

  it('labels demo data and retains the demo prefix when selecting a country', async () => {
    const user = userEvent.setup();
    renderAtlas(fixtureJourneyRepository, 'demo', '/demo');

    expect(await screen.findByText('探索示範')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '日本，2 趟旅程' }));
    expect(screen.getByLabelText('目前路徑')).toHaveTextContent('/demo/countries/JP');
  });

  it('shows a private-data error without fixture countries when a private read fails', async () => {
    const failingPrivate: JourneyRepository = {
      async listCountrySummaries() { throw new Error('IndexedDB failed'); },
      async listJourneysByCountry() { throw new Error('IndexedDB failed'); },
      async getJourneyStory() { throw new Error('IndexedDB failed'); },
    };
    renderAtlas(failingPrivate, 'private', '');

    expect(await screen.findByRole('heading', { name: '無法讀取私人資料' })).toBeInTheDocument();
    expect(screen.queryByText('日本')).not.toBeInTheDocument();
  });
});
