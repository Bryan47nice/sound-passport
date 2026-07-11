import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { JourneyPage } from './JourneyPage';

describe('JourneyPage', () => {
  it('shows curated moments and a deliberate play command', async () => {
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
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
    expect(moments[0]).toHaveTextContent('澀谷十字路口');
    expect(screen.getByRole('img', { name: '雨夜裡的澀谷十字路口' })).toBeInTheDocument();
    expect(moments[0]).toHaveTextContent('2024.10.03 · 21:42');
    expect(moments[1]).toHaveTextContent('代代木公園');
    expect(moments[2]).toHaveTextContent('羽田機場');
    expect(screen.getByText('旅後待補')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /播放這趟旅程/ })).toHaveAttribute('href', '/journeys/tokyo-2024/play');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });
});
