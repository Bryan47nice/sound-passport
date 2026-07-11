import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { CountryPage } from './CountryPage';

describe('CountryPage', () => {
  it('shows repeat visits without starting media', async () => {
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
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
});
