import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { JourneyExperienceProvider } from '../../app/JourneyExperienceContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { RepositoryProvider } from '../../data/RepositoryContext';
import type { JourneyRepository } from '../../data/ports';
import { JourneyPlayerPage } from './JourneyPlayerPage';

function renderPlayer(repository: JourneyRepository, kind: 'private' | 'demo', initialEntry: string, routePrefix: '' | '/demo') {
  return render(
    <RepositoryProvider services={{ query: repository, fixtures: fixtureJourneyRepository }}>
      <JourneyExperienceProvider kind={kind} routePrefix={routePrefix}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/journeys/:journeyId/play" element={<JourneyPlayerPage />} />
            <Route path="/demo/journeys/:journeyId/play" element={<JourneyPlayerPage />} />
          </Routes>
        </MemoryRouter>
      </JourneyExperienceProvider>
    </RepositoryProvider>,
  );
}

describe('JourneyPlayerPage', () => {
  afterEach(cleanup);

  it('renders fixture moments without autoplay', async () => {
    const story = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    renderPlayer(fixtureJourneyRepository, 'demo', '/demo/journeys/tokyo-2024/play', '/demo');

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: story!.moments[0].photoAlt })).toBeInTheDocument();
    expect(screen.getByTitle('YouTube player')).toHaveAttribute('src', expect.stringContaining('autoplay=0'));
  });

  it('returns to the demo Atlas from a missing demo journey', async () => {
    renderPlayer(fixtureJourneyRepository, 'demo', '/demo/journeys/missing/play', '/demo');

    expect(await screen.findByRole('heading', { name: '找不到這趟旅程' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回旅行地圖' })).toHaveAttribute('href', '/demo');
  });

  it('does not render fixture content after a private player read fails', async () => {
    const failingPrivate: JourneyRepository = {
      async listCountrySummaries() { throw new Error('IndexedDB failed'); },
      async listJourneysByCountry() { throw new Error('IndexedDB failed'); },
      async getJourneyStory() { throw new Error('IndexedDB failed'); },
    };
    renderPlayer(failingPrivate, 'private', '/journeys/tokyo-2024/play', '');

    expect(await screen.findByRole('heading', { name: '無法讀取私人資料' })).toBeInTheDocument();
    expect(screen.queryByText('Tokyo, after the rain')).not.toBeInTheDocument();
  });
});
