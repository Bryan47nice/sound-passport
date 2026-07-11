import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { AtlasPage } from './AtlasPage';

vi.mock('./WorldMap', () => ({
  WorldMap: ({ countries, onCountrySelect }: {
    countries: Array<{ countryCode: string; countryName: string; journeyCount: number }>;
    onCountrySelect: (countryCode: string) => void;
  }) => (
    <div aria-label="旅行世界地圖">
      {countries.map((country) => (
        <button key={country.countryCode} onClick={() => onCountrySelect(country.countryCode)}>
          {country.countryName}，{country.journeyCount} 趟旅程
        </button>
      ))}
    </div>
  ),
}));

function LocationProbe() {
  return <output aria-label="目前路徑">{useLocation().pathname}</output>;
}

describe('AtlasPage', () => {
  it('lists visited countries and opens the selected country', async () => {
    const user = userEvent.setup();
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<><AtlasPage /><LocationProbe /></>} />
            <Route path="/countries/:countryCode" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect((await screen.findAllByText('日本')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 趟旅程/).length).toBeGreaterThan(0);
    expect(screen.getByText('韓國')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '日本，2 趟旅程' }));
    expect(screen.getByLabelText('目前路徑')).toHaveTextContent('/countries/JP');
  });
});
