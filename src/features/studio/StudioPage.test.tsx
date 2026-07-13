import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import type { JourneyEditorRepository } from '../../data/ports';
import type { Journey, JourneyStory } from '../../domain/model';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { StudioPage } from './StudioPage';

const journeys: Journey[] = [
  {
    id: 'draft-journey', title: '札幌下雪的早晨', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895],
    cityLabels: ['札幌'], startDate: '2024-02-01', endDate: '2024-02-04', summary: '', status: 'draft',
    createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-05T08:00:00.000Z', source: 'private',
  },
  {
    id: 'review-journey', title: '釜山的傍晚', countryCode: 'KR', countryName: '韓國', countryCoordinates: [129.0756, 35.1796],
    cityLabels: ['釜山'], startDate: '2024-03-01', endDate: '2024-03-03', summary: '', status: 'review',
    createdAt: '2024-03-01T00:00:00.000Z', updatedAt: '2024-03-04T08:00:00.000Z', source: 'private',
  },
  {
    id: 'complete-journey', title: '花蓮的海', countryCode: 'TW', countryName: '臺灣', countryCoordinates: [121.5654, 25.033],
    cityLabels: ['花蓮'], startDate: '2024-04-01', endDate: '2024-04-02', summary: '', status: 'complete',
    createdAt: '2024-04-01T00:00:00.000Z', updatedAt: '2024-04-03T08:00:00.000Z', source: 'private',
  },
];

const story: JourneyStory = {
  journey: journeys[0],
  moments: [
    { id: 'moment-1', journeyId: 'draft-journey', photoUrl: 'https://example.com/one.jpg', photoAlt: '', songReferenceId: 'song-1', localDate: '2024-02-01', cityLabel: '札幌', placeLabel: '', caption: '', reason: '', reasonStatus: 'needs_review', sortOrder: 0, createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-01T00:00:00.000Z', song: { id: 'song-1', provider: 'manual', title: '第一首歌', artist: '測試', availability: 'needs_link' } },
    { id: 'moment-2', journeyId: 'draft-journey', photoUrl: 'https://example.com/two.jpg', photoAlt: '', songReferenceId: 'song-2', localDate: '2024-02-02', cityLabel: '札幌', placeLabel: '', caption: '', reason: '', reasonStatus: 'needs_review', sortOrder: 1, createdAt: '2024-02-02T00:00:00.000Z', updatedAt: '2024-02-02T00:00:00.000Z', song: { id: 'song-2', provider: 'manual', title: '第二首歌', artist: '測試', availability: 'available' } },
  ],
};

function editorStub(): JourneyEditorRepository {
  return {
    listPrivateJourneys: vi.fn(async () => journeys),
    getPrivateJourneyStory: vi.fn(async (id) => id === story.journey.id ? story : undefined),
    createJourney: vi.fn(), updateJourney: vi.fn(), deleteJourney: vi.fn(), addMoments: vi.fn(),
    updateMoment: vi.fn(), deleteMoment: vi.fn(), reorderMoments: vi.fn(), setJourneyStatus: vi.fn(),
  };
}

function renderPage() {
  return render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, editor: editorStub() }}>
      <MemoryRouter><StudioPage /></MemoryRouter>
    </RepositoryProvider>,
  );
}

describe('StudioPage', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('defaults to drafts and exposes the requested journey row fields', async () => {
    renderPage();

    const row = await screen.findByRole('row', { name: /札幌下雪的早晨/ });
    expect(row).toHaveTextContent('日本');
    expect(row).toHaveTextContent('2024-02-01 至 2024-02-04');
    expect(row).toHaveTextContent('2 個時刻');
    expect(row).toHaveTextContent('1 個 YouTube 待補');
    expect(row).toHaveTextContent('2024-02-05');
    expect(screen.queryByText('釜山的傍晚')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '草稿', selected: true })).toBeInTheDocument();
  });

  it('filters journey status exclusively', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('row', { name: /札幌下雪的早晨/ });

    await user.click(screen.getByRole('tab', { name: '待整理' }));
    expect(screen.getByRole('row', { name: /釜山的傍晚/ })).toBeInTheDocument();
    expect(screen.queryByText('札幌下雪的早晨')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '已完成' }));
    expect(screen.getByRole('row', { name: /花蓮的海/ })).toBeInTheDocument();
    expect(screen.queryByText('釜山的傍晚')).not.toBeInTheDocument();
  });

  it('uses the new journey route and labels unavailable controls truthfully', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: '新增旅程' })).toHaveAttribute('href', '/studio/journeys/new');
    expect(screen.getByRole('button', { name: '匯出備份，即將可用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '匯入備份，即將可用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清除私人資料，即將可用' })).toBeDisabled();
    expect(within(screen.getByRole('toolbar')).getAllByTitle('即將可用')).toHaveLength(3);
  });

  it('shows local storage guidance when the editor service is unavailable', () => {
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter><StudioPage /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(screen.getByText('本機儲存空間暫時無法使用')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '新增旅程' })).not.toBeInTheDocument();
  });

  it('prioritizes mobile guidance over the unavailable editor state', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter><StudioPage /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(screen.getByText('請使用電腦整理旅程')).toBeInTheDocument();
    expect(screen.queryByText('本機儲存空間暫時無法使用')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '新增旅程' })).not.toBeInTheDocument();
  });
});
