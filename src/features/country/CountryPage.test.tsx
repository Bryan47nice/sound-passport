import { cleanup, render, screen, within } from '@testing-library/react';
import { useLayoutEffect, type PropsWithChildren } from 'react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JourneyExperienceProvider } from '../../app/JourneyExperienceContext';
import { createCombinedJourneyRepository } from '../../data/combinedJourneyRepository';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { openSoundPassportDb } from '../../data/indexedDb';
import { createIndexedDbJourneyRepository } from '../../data/indexedDbJourneyRepository';
import {
  RepositoryProvider as DataRepositoryProvider,
  type RepositoryServices,
  useInvalidateRepositoryQueries,
  useJourneyEditorRepository,
} from '../../data/RepositoryContext';
import type { JourneyRepository } from '../../data/ports';
import type { Journey } from '../../domain/model';
import { cleanupDb, uniqueDbName } from '../../test/indexedDb';
import { seedPrivateReviewJourney } from '../../test/privateJourney';
import { CountryPage } from './CountryPage';

function RepositoryProvider({ children, services }: PropsWithChildren<{ services: RepositoryServices }>) {
  return (
    <DataRepositoryProvider services={services}>
      <JourneyExperienceProvider kind="demo" routePrefix="">{children}</JourneyExperienceProvider>
    </DataRepositoryProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function CommitProbe({ snapshots }: { snapshots: string[] }) {
  useLayoutEffect(() => { snapshots.push(document.body.textContent ?? ''); });
  return null;
}

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

  it('keeps demo journey links under the demo prefix', async () => {
    render(
      <DataRepositoryProvider services={{ query: fixtureJourneyRepository, fixtures: fixtureJourneyRepository }}>
        <JourneyExperienceProvider kind="demo" routePrefix="/demo">
          <MemoryRouter initialEntries={['/demo/countries/JP']}>
            <Routes><Route path="/demo/countries/:countryCode" element={<CountryPage />} /></Routes>
          </MemoryRouter>
        </JourneyExperienceProvider>
      </DataRepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '日本' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /東京，雨停之後/ })).toHaveAttribute('href', '/demo/journeys/tokyo-2024');
    expect(screen.getByRole('link', { name: /京都，安靜的顏色/ })).toHaveAttribute('href', '/demo/journeys/kyoto-2023');
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

  it('leaves loading after a rejected read and succeeds when the user retries', async () => {
    const user = userEvent.setup();
    const japaneseJourneys = await fixtureJourneyRepository.listJourneysByCountry('JP');
    const listJourneysByCountry = vi.fn()
      .mockRejectedValueOnce(new Error('IndexedDB read failed'))
      .mockResolvedValueOnce(japaneseJourneys);
    const repository: JourneyRepository = {
      listCountrySummaries: vi.fn(async () => []),
      listJourneysByCountry,
      getJourneyStory: vi.fn(),
    };
    render(
      <RepositoryProvider services={{ query: repository }}>
        <MemoryRouter initialEntries={['/countries/JP']}>
          <Routes><Route path="/countries/:countryCode" element={<CountryPage />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '無法讀取國家旅程' })).toBeInTheDocument();
    expect(screen.queryByLabelText('載入國家旅程')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新讀取' }));

    expect(await screen.findByRole('heading', { name: '日本' })).toBeInTheDocument();
    expect(listJourneysByCountry).toHaveBeenCalledTimes(2);
  });

  it('does not render fixtures when a private country read fails', async () => {
    const failingPrivate: JourneyRepository = {
      listCountrySummaries: vi.fn(async () => { throw new Error('IndexedDB failed'); }),
      listJourneysByCountry: vi.fn(async () => { throw new Error('IndexedDB failed'); }),
      getJourneyStory: vi.fn(async () => { throw new Error('IndexedDB failed'); }),
    };
    render(
      <DataRepositoryProvider services={{ query: failingPrivate, fixtures: fixtureJourneyRepository }}>
        <JourneyExperienceProvider kind="private" routePrefix="">
          <MemoryRouter initialEntries={['/countries/JP']}>
            <Routes><Route path="/countries/:countryCode" element={<CountryPage />} /></Routes>
          </MemoryRouter>
        </JourneyExperienceProvider>
      </DataRepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '無法讀取私人資料' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '日本' })).not.toBeInTheDocument();
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

  it('does not commit journeys from the previous experience repository', async () => {
    const previousJourneys = await fixtureJourneyRepository.listJourneysByCountry('JP');
    const nextJourneys = deferred<Journey[]>();
    const previousRepository: JourneyRepository = {
      ...fixtureJourneyRepository,
      listJourneysByCountry: async () => previousJourneys,
    };
    const nextRepository: JourneyRepository = {
      ...fixtureJourneyRepository,
      listJourneysByCountry: () => nextJourneys.promise,
    };
    const snapshots: string[] = [];
    const view = (repository: JourneyRepository, kind: 'private' | 'demo') => (
      <DataRepositoryProvider services={{ query: repository, fixtures: repository }}>
        <JourneyExperienceProvider kind={kind} routePrefix="">
          <MemoryRouter initialEntries={['/countries/JP']}>
            <Routes><Route path="/countries/:countryCode" element={<><CountryPage /><CommitProbe snapshots={snapshots} /></>} /></Routes>
          </MemoryRouter>
        </JourneyExperienceProvider>
      </DataRepositoryProvider>
    );
    const rendered = render(view(previousRepository, 'demo'));
    expect(await screen.findByText(previousJourneys[0].title)).toBeInTheDocument();

    snapshots.length = 0;
    rendered.rerender(view(nextRepository, 'private'));

    expect(snapshots.every((snapshot) => !snapshot.includes(previousJourneys[0].title))).toBe(true);
    expect(screen.getByLabelText('載入國家旅程')).toBeInTheDocument();
  });
});
