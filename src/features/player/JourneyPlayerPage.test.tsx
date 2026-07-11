import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyRepository } from '../../data/ports';
import { JourneyPlayerPage } from './JourneyPlayerPage';

function renderPlayer(repository: JourneyRepository, initialEntry: string) {
  return render(
    <RepositoryProvider repository={repository}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/journeys/:journeyId/play" element={<JourneyPlayerPage />} />
        </Routes>
      </MemoryRouter>
    </RepositoryProvider>,
  );
}

describe('JourneyPlayerPage', () => {
  it('shows fixture photos, local time, song details, and moves only through explicit controls', async () => {
    const user = userEvent.setup();
    const story = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    const firstMoment = story!.moments[0];
    const secondMoment = story!.moments[1];
    renderPlayer(fixtureJourneyRepository, '/journeys/tokyo-2024/play');

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: firstMoment.photoAlt })).toBeInTheDocument();
    expect(screen.getByText('2024.10.03 · 21:42')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: firstMoment.song.title })).toBeInTheDocument();
    expect(screen.getByText(firstMoment.song.artist)).toBeInTheDocument();
    expect(screen.getByText(firstMoment.reason)).toBeInTheDocument();
    const iframe = screen.getByTitle('YouTube player');
    expect(iframe).toHaveAttribute('src', expect.stringContaining('autoplay=0'));
    expect(iframe.getAttribute('allow') ?? '').not.toContain('autoplay');
    expect(screen.getByRole('button', { name: '上一個時刻' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '下一個時刻' }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: secondMoment.photoAlt })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一個時刻' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '上一個時刻' }));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一個時刻' }));
    await user.click(screen.getByRole('button', { name: '下一個時刻' }));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一個時刻' })).toBeDisabled();
  });

  it('clears a previous story while a new journey request is pending', async () => {
    const user = userEvent.setup();
    const tokyoStory = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    const kyotoStory = await fixtureJourneyRepository.getJourneyStory('kyoto-2023');
    let resolveKyoto!: (value: Awaited<ReturnType<JourneyRepository['getJourneyStory']>>) => void;
    const repository: JourneyRepository = {
      ...fixtureJourneyRepository,
      getJourneyStory(journeyId) {
        if (journeyId === 'kyoto-2023') {
          return new Promise((resolve) => {
            resolveKyoto = resolve;
          });
        }
        return fixtureJourneyRepository.getJourneyStory(journeyId);
      },
    };

    const { container } = render(
      <RepositoryProvider repository={repository}>
        <MemoryRouter initialEntries={['/journeys/tokyo-2024/play']}>
          <Routes>
            <Route
              path="/journeys/:journeyId/play"
              element={<><JourneyPlayerPage /><Link to="/journeys/kyoto-2023/play">切換旅程</Link></>}
            />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    const page = within(container);
    expect(await page.findByText(tokyoStory!.journey.title)).toBeInTheDocument();
    await user.click(page.getByRole('link', { name: '切換旅程' }));

    expect(page.getByLabelText('載入播放器')).toBeInTheDocument();
    expect(page.queryByText(tokyoStory!.journey.title)).not.toBeInTheDocument();

    resolveKyoto(kyotoStory);
    expect(await page.findByText(kyotoStory!.journey.title)).toBeInTheDocument();
  });

  it('shows a Chinese not-found state for an unknown journey', async () => {
    renderPlayer(fixtureJourneyRepository, '/journeys/missing/play');

    expect(await screen.findByRole('heading', { name: '找不到這趟旅程' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回旅行地圖' })).toHaveAttribute('href', '/');
  });
});
