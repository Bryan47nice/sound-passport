import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyRepository } from '../../data/ports';
import type { JourneyStory } from '../../domain/model';
import { JourneyPage } from './JourneyPage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('JourneyPage', () => {
  afterEach(cleanup);

  it('shows curated moments and a deliberate play command', async () => {
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter initialEntries={['/journeys/tokyo-2024']}>
          <Routes>
            <Route path="/journeys/:journeyId" element={<JourneyPage />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '東京，雨停之後' })).toBeInTheDocument();
    const moments = screen.getAllByRole('listitem');
    expect(moments).toHaveLength(3);
    expect(screen.getAllByRole('img').every((image) => image.classList.contains('journey-photo'))).toBe(true);
    expect(moments[0]).toHaveTextContent('澀谷十字路口');
    expect(screen.getByRole('img', { name: '雨夜裡的澀谷十字路口' })).toBeInTheDocument();
    expect(moments[0]).toHaveTextContent('2024.10.03 · 21:42');
    expect(moments[1]).toHaveTextContent('代代木公園');
    expect(moments[2]).toHaveTextContent('羽田機場');
    expect(screen.getByText('旅後待補')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /播放這趟旅程/ })).toHaveAttribute('href', '/journeys/tokyo-2024/play');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('does not render a resolved journey while the next route is pending', async () => {
    const tokyoStory = await fixtureJourneyRepository.getJourneyStory('tokyo-2024') as JourneyStory;
    const seoulStory = await fixtureJourneyRepository.getJourneyStory('seoul-2025') as JourneyStory;
    const tokyoRequest = deferred<JourneyStory | undefined>();
    const seoulRequest = deferred<JourneyStory | undefined>();
    const repository: JourneyRepository = {
      getJourneyStory: vi.fn((journeyId) => (
        journeyId === 'tokyo-2024' ? tokyoRequest.promise : seoulRequest.promise
      )),
      listCountrySummaries: vi.fn(async () => []),
      listJourneysByCountry: vi.fn(async () => []),
    };

    function RouteChange() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate('/journeys/seoul-2025')}>Change journey</button>;
    }

    render(
      <RepositoryProvider services={{ query: repository }}>
        <MemoryRouter initialEntries={['/journeys/tokyo-2024']}>
          <RouteChange />
          <Routes>
            <Route path="/journeys/:journeyId" element={<JourneyPage />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    await act(async () => tokyoRequest.resolve(tokyoStory));
    expect(await screen.findByRole('heading', { name: tokyoStory.journey.title })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change journey' }));

    expect(screen.getByLabelText(/載入旅程/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: tokyoStory.journey.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /播放這趟旅程/ })).not.toBeInTheDocument();

    await act(async () => seoulRequest.resolve(seoulStory));
    expect(await screen.findByRole('heading', { name: seoulStory.journey.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /播放這趟旅程/ })).toHaveAttribute('href', '/journeys/seoul-2025/play');
  });
});
