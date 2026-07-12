import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyRepository } from '../../data/ports';
import type { Journey } from '../../domain/model';
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
      <RepositoryProvider repository={repository}>
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
});
