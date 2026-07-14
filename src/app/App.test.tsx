import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import { fixtureJourneyRepository } from '../data/fixtureJourneyRepository';
import type { JourneyEditorRepository } from '../data/ports';
import { App } from './App';

vi.mock('../features/atlas/WorldMap', () => ({
  WorldMap: () => <div aria-label="旅行世界地圖" />,
}));

describe('App', () => {
  afterEach(cleanup);

  it('renders the Sound Passport shell', async () => {
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter><App /></MemoryRouter>
      </RepositoryProvider>,
    );
    expect(screen.getByRole('banner')).toHaveTextContent('Sound Passport');
    const brand = screen.getByRole('link', { name: 'Sound Passport' });
    expect(brand).toHaveAttribute('href', '/');
    expect(brand.querySelector('.brand-passport-mark')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '世界地圖' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '整理' })).toHaveAttribute('href', '/studio');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(await screen.findByLabelText('旅行世界地圖')).toBeInTheDocument();
  });

  it('renders the Studio route unavailable state instead of the not-found page', async () => {
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter initialEntries={['/studio']}><App /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '本機儲存空間暫時無法使用' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '找不到這個頁面' })).not.toBeInTheDocument();
  });

  it('renders the editor route unavailable state instead of the Task 6 transition', () => {
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter initialEntries={['/studio/journeys/new-journey']}><App /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(screen.getByRole('heading', { name: '本機儲存空間暫時無法使用' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '旅程編輯功能即將開放' })).not.toBeInTheDocument();
  });

  it('routes a private journey preview through the editor repository', async () => {
    const fixtureStory = await fixtureJourneyRepository.getJourneyStory('seoul-2025');
    const privateStory = {
      ...fixtureStory!,
      journey: {
        ...fixtureStory!.journey,
        id: 'private-preview',
        title: '私人預覽旅程',
        source: 'private' as const,
        status: 'draft' as const,
      },
    };
    const editor: JourneyEditorRepository = {
      listPrivateJourneys: vi.fn(),
      createJourney: vi.fn(),
      updateJourney: vi.fn(),
      deleteJourney: vi.fn(),
      getPrivateJourneyStory: vi.fn(async () => privateStory),
      addMoments: vi.fn(),
      updateMoment: vi.fn(),
      deleteMoment: vi.fn(),
      reorderMoments: vi.fn(),
      setJourneyStatus: vi.fn(),
    };

    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, editor }}>
        <MemoryRouter initialEntries={['/studio/journeys/private-preview/preview']}><App /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '私人預覽旅程' })).toBeInTheDocument();
    expect(editor.getPrivateJourneyStory).toHaveBeenCalledWith('private-preview');
    expect(screen.queryByRole('heading', { name: '找不到這個頁面' })).not.toBeInTheDocument();
  });

  it('shows a not-found page for an unknown route', () => {
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter initialEntries={['/not-found']}><App /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(screen.getByRole('heading', { name: '找不到這個頁面' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到世界地圖' })).toHaveAttribute('href', '/');
  });
});
