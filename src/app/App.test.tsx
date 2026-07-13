import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import { fixtureJourneyRepository } from '../data/fixtureJourneyRepository';
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
