import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { JourneyExperienceProvider } from '../../app/JourneyExperienceContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { RepositoryProvider } from '../../data/RepositoryContext';
import type { JourneyRepository } from '../../data/ports';
import { CountryPage } from './CountryPage';

function renderCountry(repository: JourneyRepository, kind: 'private' | 'demo', routePrefix: '' | '/demo') {
  return render(
    <RepositoryProvider services={{ query: repository, fixtures: fixtureJourneyRepository }}>
      <JourneyExperienceProvider kind={kind} routePrefix={routePrefix}>
        <MemoryRouter initialEntries={[`${routePrefix}/countries/JP`]}>
          <Routes>
            <Route path="/countries/:countryCode" element={<CountryPage />} />
            <Route path="/demo/countries/:countryCode" element={<CountryPage />} />
          </Routes>
        </MemoryRouter>
      </JourneyExperienceProvider>
    </RepositoryProvider>,
  );
}

describe('CountryPage', () => {
  afterEach(cleanup);

  it('keeps demo journey links under the demo prefix', async () => {
    renderCountry(fixtureJourneyRepository, 'demo', '/demo');

    expect(await screen.findByRole('heading', { name: '日本' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /東京，雨停之後/ })).toHaveAttribute('href', '/demo/journeys/tokyo-2024');
    expect(screen.getByRole('link', { name: /京都，安靜的顏色/ })).toHaveAttribute('href', '/demo/journeys/kyoto-2023');
  });

  it('does not render fixtures when a private country read fails', async () => {
    const failingPrivate: JourneyRepository = {
      async listCountrySummaries() { throw new Error('IndexedDB failed'); },
      async listJourneysByCountry() { throw new Error('IndexedDB failed'); },
      async getJourneyStory() { throw new Error('IndexedDB failed'); },
    };
    renderCountry(failingPrivate, 'private', '');

    expect(await screen.findByRole('heading', { name: '無法讀取私人資料' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '日本' })).not.toBeInTheDocument();
  });
});
