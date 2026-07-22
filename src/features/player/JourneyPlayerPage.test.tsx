import { cleanup, render, screen, within } from '@testing-library/react';
import { useLayoutEffect, type PropsWithChildren } from 'react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JourneyExperienceProvider } from '../../app/JourneyExperienceContext';
import { createCombinedJourneyRepository } from '../../data/combinedJourneyRepository';
import { openSoundPassportDb } from '../../data/indexedDb';
import { createIndexedDbJourneyRepository } from '../../data/indexedDbJourneyRepository';
import { RepositoryProvider as DataRepositoryProvider, type RepositoryServices } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyRepository } from '../../data/ports';
import { cleanupDb, uniqueDbName } from '../../test/indexedDb';
import { seedPrivateReviewJourney } from '../../test/privateJourney';
import { JourneyPlayerPage } from './JourneyPlayerPage';

function RepositoryProvider({ children, services }: PropsWithChildren<{ services: RepositoryServices }>) {
  return (
    <DataRepositoryProvider services={services}>
      <JourneyExperienceProvider kind="demo" routePrefix="">{children}</JourneyExperienceProvider>
    </DataRepositoryProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function CommitProbe({ snapshots }: { snapshots: string[] }) {
  useLayoutEffect(() => {
    snapshots.push(document.body.textContent ?? '');
  });
  return null;
}

function renderPlayer(repository: JourneyRepository, initialEntry: string) {
  return render(
    <RepositoryProvider services={{ query: repository }}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/journeys/:journeyId/play" element={<JourneyPlayerPage />} />
        </Routes>
      </MemoryRouter>
    </RepositoryProvider>,
  );
}

describe('JourneyPlayerPage', () => {
  afterEach(cleanup);

  it('shows fixture photos, local time, song details, and moves only through explicit controls', async () => {
    const user = userEvent.setup();
    const story = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    const firstMoment = story!.moments[0];
    const secondMoment = story!.moments[1];
    renderPlayer(fixtureJourneyRepository, '/journeys/tokyo-2024/play');

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: firstMoment.photoAlt })).toHaveClass('journey-photo', 'player-photo');
    expect(screen.getByRole('img', { name: firstMoment.photoAlt })).toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute('dateTime', firstMoment.localDate);
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
    expect(screen.queryByTitle('YouTube player')).not.toBeInTheDocument();
    expect(screen.getByText(secondMoment.song.title, { selector: '.song-fallback strong' })).toBeInTheDocument();

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
      <RepositoryProvider services={{ query: repository }}>
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

  it('returns to the demo Atlas from a missing demo journey', async () => {
    render(
      <DataRepositoryProvider services={{ query: fixtureJourneyRepository, fixtures: fixtureJourneyRepository }}>
        <JourneyExperienceProvider kind="demo" routePrefix="/demo">
          <MemoryRouter initialEntries={['/demo/journeys/missing/play']}>
            <Routes><Route path="/demo/journeys/:journeyId/play" element={<JourneyPlayerPage />} /></Routes>
          </MemoryRouter>
        </JourneyExperienceProvider>
      </DataRepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '找不到這趟旅程' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回旅行地圖' })).toHaveAttribute('href', '/demo');
  });

  it('does not render fixture content after a private player read fails', async () => {
    const failingPrivate: JourneyRepository = {
      async listCountrySummaries() { throw new Error('IndexedDB failed'); },
      async listJourneysByCountry() { throw new Error('IndexedDB failed'); },
      async getJourneyStory() { throw new Error('IndexedDB failed'); },
    };
    render(
      <DataRepositoryProvider services={{ query: failingPrivate, fixtures: fixtureJourneyRepository }}>
        <JourneyExperienceProvider kind="private" routePrefix="">
          <MemoryRouter initialEntries={['/journeys/tokyo-2024/play']}>
            <Routes><Route path="/journeys/:journeyId/play" element={<JourneyPlayerPage />} /></Routes>
          </MemoryRouter>
        </JourneyExperienceProvider>
      </DataRepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '無法讀取私人資料' })).toBeInTheDocument();
    expect(screen.queryByText('Tokyo, after the rain')).not.toBeInTheDocument();
  });

  it('distinguishes a storage read failure from not found and retries it', async () => {
    const user = userEvent.setup();
    const story = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    const getJourneyStory = vi.fn()
      .mockRejectedValueOnce(new Error('IndexedDB read failed'))
      .mockResolvedValueOnce(story);
    const repository: JourneyRepository = {
      ...fixtureJourneyRepository,
      getJourneyStory,
    };
    renderPlayer(repository, '/journeys/tokyo-2024/play');

    expect(await screen.findByRole('heading', { name: '無法讀取旅程' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '找不到這趟旅程' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新讀取' }));

    expect(await screen.findByText(story!.journey.title)).toBeInTheDocument();
    expect(getJourneyStory).toHaveBeenCalledTimes(2);
  });

  it('shows a Chinese empty-story state without an iframe', async () => {
    const story = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    const repository: JourneyRepository = {
      ...fixtureJourneyRepository,
      async getJourneyStory() {
        return { ...story!, moments: [] };
      },
    };

    renderPlayer(repository, '/journeys/tokyo-2024/play');

    expect(await screen.findByRole('heading', { name: '這趟旅程沒有音樂時刻' })).toBeInTheDocument();
    expect(screen.queryByTitle('YouTube player')).not.toBeInTheDocument();
  });

  it('plays a newly completed private journey in its persisted repository order', async () => {
    const user = userEvent.setup();
    const dbName = uniqueDbName('player-private-order');
    const db = await openSoundPassportDb(dbName);
    try {
      const privateRepository = createIndexedDbJourneyRepository({ db });
      const reviewStory = await seedPrivateReviewJourney(privateRepository);
      await privateRepository.setJourneyStatus(reviewStory.journey.id, 'complete', {
        expectedUpdatedAt: reviewStory.journey.updatedAt,
      });
      const query = createCombinedJourneyRepository(fixtureJourneyRepository, privateRepository);

      renderPlayer(query, `/journeys/${reviewStory.journey.id}/play`);

      expect(await screen.findByText('1 / 2')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '終點之歌' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'coast-two.jpg' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '下一個時刻' }));
      expect(screen.getByText('2 / 2')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '起點之歌' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'coast-one.jpg' })).toBeInTheDocument();
    } finally {
      cleanup();
      db.close();
      await cleanupDb(dbName);
    }
  });

  it('does not commit a story from the previous experience repository', async () => {
    const previousStory = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    const nextStory = deferred<Awaited<ReturnType<JourneyRepository['getJourneyStory']>>>();
    const nextRepository: JourneyRepository = {
      ...fixtureJourneyRepository,
      getJourneyStory: () => nextStory.promise,
    };
    const snapshots: string[] = [];
    const view = (repository: JourneyRepository, kind: 'private' | 'demo') => (
      <DataRepositoryProvider services={{ query: repository, fixtures: repository }}>
        <JourneyExperienceProvider kind={kind} routePrefix="">
          <MemoryRouter initialEntries={['/journeys/tokyo-2024/play']}>
            <Routes>
              <Route
                path="/journeys/:journeyId/play"
                element={<><JourneyPlayerPage /><CommitProbe snapshots={snapshots} /></>}
              />
            </Routes>
          </MemoryRouter>
        </JourneyExperienceProvider>
      </DataRepositoryProvider>
    );
    const rendered = render(view(fixtureJourneyRepository, 'demo'));
    expect(await screen.findByText(previousStory!.journey.title)).toBeInTheDocument();

    snapshots.length = 0;
    rendered.rerender(view(nextRepository, 'private'));

    expect(snapshots.every((snapshot) => !snapshot.includes(previousStory!.journey.title))).toBe(true);
    expect(screen.getByLabelText('載入播放器')).toBeInTheDocument();
  });
});
