import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCombinedJourneyRepository } from '../../data/combinedJourneyRepository';
import { openSoundPassportDb } from '../../data/indexedDb';
import { createIndexedDbJourneyRepository } from '../../data/indexedDbJourneyRepository';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyEditorRepository, JourneyRepository } from '../../data/ports';
import type { JourneyStory } from '../../domain/model';
import { cleanupDb, uniqueDbName } from '../../test/indexedDb';
import { seedPrivateReviewJourney } from '../../test/privateJourney';
import { JourneyPage } from './JourneyPage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function editorStub(overrides: Partial<JourneyEditorRepository> = {}): JourneyEditorRepository {
  return {
    listPrivateJourneys: vi.fn(),
    createJourney: vi.fn(),
    updateJourney: vi.fn(),
    deleteJourney: vi.fn(),
    getPrivateJourneyStory: vi.fn(),
    addMoments: vi.fn(),
    updateMoment: vi.fn(),
    deleteMoment: vi.fn(),
    reorderMoments: vi.fn(),
    setJourneyStatus: vi.fn(),
    ...overrides,
  };
}

function LocationProbe() {
  return <output aria-label="目前路徑">{useLocation().pathname}</output>;
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
    expect(screen.queryByRole('link', { name: '編輯旅程' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除旅程' })).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('shows a completed private journey summary and moment captions from the combined live query', async () => {
    const dbName = uniqueDbName('journey-private-detail');
    const db = await openSoundPassportDb(dbName);
    try {
      const privateRepository = createIndexedDbJourneyRepository({ db });
      const reviewStory = await seedPrivateReviewJourney(privateRepository);
      await privateRepository.setJourneyStatus(reviewStory.journey.id, 'complete', {
        expectedUpdatedAt: reviewStory.journey.updatedAt,
      });
      const query = createCombinedJourneyRepository(fixtureJourneyRepository, privateRepository);

      render(
        <RepositoryProvider services={{ query, editor: privateRepository }}>
          <MemoryRouter initialEntries={[`/journeys/${reviewStory.journey.id}`]}>
            <Routes><Route path="/journeys/:journeyId" element={<JourneyPage />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>,
      );

      expect(await screen.findByRole('heading', { name: '花蓮海岸公路' })).toBeInTheDocument();
      expect(screen.getByText('沿著海岸，把兩段風景留在同一趟旅程。')).toBeInTheDocument();
      expect(screen.getByText('第二段圖說')).toBeInTheDocument();
      expect(screen.getByText('第一段圖說')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '編輯旅程' })).toHaveAttribute(
        'href',
        `/studio/journeys/${reviewStory.journey.id}`,
      );
      expect(screen.getByRole('button', { name: '刪除旅程' })).toBeInTheDocument();
    } finally {
      cleanup();
      db.close();
      await cleanupDb(dbName);
    }
  });

  it('names a private journey in deletion confirmation, calls one cascade command, and returns to Studio', async () => {
    const user = userEvent.setup();
    const privateStory = await fixtureJourneyRepository.getJourneyStory('tokyo-2024') as JourneyStory;
    privateStory.journey = {
      ...privateStory.journey,
      id: 'private-delete',
      title: '要刪除的海岸旅程',
      source: 'private',
    };
    privateStory.moments = privateStory.moments.map((moment) => ({ ...moment, journeyId: privateStory.journey.id }));
    const query: JourneyRepository = {
      ...fixtureJourneyRepository,
      getJourneyStory: vi.fn(async () => privateStory),
    };
    const deleteJourney = vi.fn(async () => undefined);
    render(
      <RepositoryProvider services={{ query, editor: editorStub({ deleteJourney }) }}>
        <MemoryRouter initialEntries={[`/journeys/${privateStory.journey.id}`]}>
          <Routes>
            <Route path="/journeys/:journeyId" element={<JourneyPage />} />
            <Route path="/studio" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    await user.click(await screen.findByRole('button', { name: '刪除旅程' }));
    const dialog = screen.getByRole('dialog', { name: '刪除「要刪除的海岸旅程」？' });
    expect(dialog).toHaveTextContent('這趟旅程的所有時刻與照片也會一起刪除，且無法復原。');
    await user.click(screen.getByRole('button', { name: '確認刪除旅程' }));

    expect(deleteJourney).toHaveBeenCalledTimes(1);
    expect(deleteJourney).toHaveBeenCalledWith(privateStory.journey.id);
    expect(await screen.findByLabelText('目前路徑')).toHaveTextContent('/studio');
  });

  it('submits one deletion while pending and recovers for retry after an error', async () => {
    const user = userEvent.setup();
    const fixtureStory = await fixtureJourneyRepository.getJourneyStory('tokyo-2024') as JourneyStory;
    const privateStory: JourneyStory = {
      journey: {
        ...fixtureStory.journey,
        id: 'private-pending-delete',
        source: 'private',
      },
      moments: fixtureStory.moments.map((moment) => ({
        ...moment,
        journeyId: 'private-pending-delete',
      })),
    };
    const firstRequest = deferred<void>();
    const deleteJourney = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockResolvedValueOnce(undefined);
    const query: JourneyRepository = {
      ...fixtureJourneyRepository,
      getJourneyStory: vi.fn(async () => privateStory),
    };
    render(
      <RepositoryProvider services={{ query, editor: editorStub({ deleteJourney }) }}>
        <MemoryRouter initialEntries={[`/journeys/${privateStory.journey.id}`]}>
          <Routes>
            <Route path="/journeys/:journeyId" element={<JourneyPage />} />
            <Route path="/studio" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    await user.click(await screen.findByRole('button', { name: '刪除旅程' }));
    const dialog = screen.getByRole('dialog');
    const confirm = screen.getByRole('button', { name: '確認刪除旅程' });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(deleteJourney).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '刪除中' })).toBeDisabled();

    await act(async () => {
      firstRequest.reject(new Error('transaction aborted'));
      await firstRequest.promise.catch(() => undefined);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法刪除旅程，資料仍完整保留，請再試一次。',
    );
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '確認刪除旅程' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '確認刪除旅程' }));
    expect(deleteJourney).toHaveBeenCalledTimes(2);
    expect(await screen.findByLabelText('目前路徑')).toHaveTextContent('/studio');
  });

  it('keeps a failed private deletion recoverable without leaving the journey', async () => {
    const user = userEvent.setup();
    const fixtureStory = await fixtureJourneyRepository.getJourneyStory('seoul-2025') as JourneyStory;
    const privateStory = {
      ...fixtureStory,
      journey: { ...fixtureStory.journey, id: 'private-failure', source: 'private' as const },
    };
    const deleteJourney = vi.fn()
      .mockRejectedValueOnce(new Error('transaction aborted'))
      .mockResolvedValueOnce(undefined);
    const query: JourneyRepository = {
      ...fixtureJourneyRepository,
      getJourneyStory: vi.fn(async () => privateStory),
    };
    render(
      <RepositoryProvider services={{ query, editor: editorStub({ deleteJourney }) }}>
        <MemoryRouter initialEntries={[`/journeys/${privateStory.journey.id}`]}>
          <Routes>
            <Route path="/journeys/:journeyId" element={<JourneyPage />} />
            <Route path="/studio" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    await user.click(await screen.findByRole('button', { name: '刪除旅程' }));
    await user.click(screen.getByRole('button', { name: '確認刪除旅程' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法刪除旅程，資料仍完整保留，請再試一次。',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '確認刪除旅程' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '確認刪除旅程' }));
    expect(deleteJourney).toHaveBeenCalledTimes(2);
    expect(await screen.findByLabelText('目前路徑')).toHaveTextContent('/studio');
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
