import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import { fixtureJourneyRepository } from '../data/fixtureJourneyRepository';
import { App } from './App';

vi.mock('../features/atlas/WorldMap', () => ({
  WorldMap: () => <div aria-label="旅行世界地圖" />,
}));

describe('App', () => {
  it('renders the Sound Passport shell', async () => {
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
        <MemoryRouter><App /></MemoryRouter>
      </RepositoryProvider>,
    );
    expect(screen.getByRole('banner')).toHaveTextContent('Sound Passport');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(await screen.findByLabelText('旅行世界地圖')).toBeInTheDocument();
  });
});
