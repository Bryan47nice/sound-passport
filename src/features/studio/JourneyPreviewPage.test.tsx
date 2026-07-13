import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { JourneyVersionConflictError, type JourneyEditorRepository } from '../../data/ports';
import type { JourneyStory } from '../../domain/model';
import { JourneyPreviewPage } from './JourneyPreviewPage';

const story: JourneyStory = {
  journey: {
    id: 'private-coast',
    title: '花蓮海岸公路',
    countryCode: 'TW',
    countryName: '臺灣',
    countryCoordinates: [121.5654, 25.033],
    cityLabels: ['花蓮'],
    startDate: '2026-04-01',
    endDate: '2026-04-03',
    summary: '沿著海岸，把兩段風景留在同一趟旅程。',
    status: 'draft',
    source: 'private',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  },
  moments: [
    {
      id: 'coast-1',
      journeyId: 'private-coast',
      photoUrl: '/coast-one.jpg',
      photoAlt: '七星潭海岸',
      songReferenceId: 'song-1',
      localDate: '2026-04-01',
      localTime: '08:20',
      cityLabel: '花蓮',
      placeLabel: '七星潭',
      caption: '早晨的浪很慢。',
      reason: '出發時需要一首安靜的歌。',
      reasonStatus: 'complete',
      sortOrder: 0,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      song: {
        id: 'song-1',
        provider: 'youtube',
        providerItemId: 'M7lc1UVf-VE',
        sourceUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
        title: 'Coastline One',
        artist: 'Demo Artist',
        availability: 'available',
      },
    },
    {
      id: 'coast-2',
      journeyId: 'private-coast',
      photoUrl: '/coast-two.jpg',
      photoAlt: '石梯坪海岸',
      songReferenceId: 'song-2',
      localDate: '2026-04-02',
      cityLabel: '花蓮',
      placeLabel: '石梯坪',
      caption: '下午的風把聲音拉得很長。',
      reason: '',
      reasonStatus: 'needs_review',
      sortOrder: 1,
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      song: {
        id: 'song-2',
        provider: 'manual',
        title: 'Coastline Two',
        artist: 'Demo Artist',
        availability: 'needs_link',
      },
    },
  ],
};

function editorStub(
  nextStory: JourneyStory | undefined = story,
  overrides: Partial<JourneyEditorRepository> = {},
): JourneyEditorRepository {
  return {
    listPrivateJourneys: vi.fn(async () => nextStory ? [nextStory.journey] : []),
    createJourney: vi.fn(),
    updateJourney: vi.fn(),
    deleteJourney: vi.fn(),
    getPrivateJourneyStory: vi.fn(async () => nextStory),
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

function renderPreview(editor: JourneyEditorRepository) {
  return render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, editor }}>
      <MemoryRouter initialEntries={['/studio/journeys/private-coast/preview']}>
        <Routes>
          <Route path="/studio/journeys/:journeyId/preview" element={<JourneyPreviewPage />} />
          <Route path="/journeys/:journeyId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </RepositoryProvider>,
  );
}

describe('JourneyPreviewPage', () => {
  afterEach(cleanup);

  it('loads a draft through the editor port without mutating status and presents summary before moments', async () => {
    const editor = editorStub();
    renderPreview(editor);

    expect(await screen.findByRole('heading', { name: story.journey.title })).toBeInTheDocument();
    expect(editor.getPrivateJourneyStory).toHaveBeenCalledWith(story.journey.id);
    expect(editor.setJourneyStatus).not.toHaveBeenCalled();

    const summary = screen.getByText(story.journey.summary);
    const moments = screen.getByRole('list', { name: '旅程時刻' });
    expect(summary.compareDocumentPosition(moments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(moments).getByText('早晨的浪很慢。')).toBeInTheDocument();
    expect(within(moments).getByText('下午的風把聲音拉得很長。')).toBeInTheDocument();

    const iframe = within(moments).getByTitle('YouTube player');
    expect(iframe).toHaveAttribute('src', expect.stringContaining('https://www.youtube-nocookie.com/embed/'));
    expect(iframe).toHaveAttribute('src', expect.stringContaining('autoplay=0'));
    expect(iframe.getAttribute('allow') ?? '').not.toContain('autoplay');
    expect(within(moments).getByText('Coastline Two', { selector: 'strong' })).toBeInTheDocument();
    expect(within(moments).getAllByText('Demo Artist').length).toBeGreaterThan(0);
    expect(within(moments).getByText('尚未連結 YouTube')).toBeInTheDocument();
    expect(within(moments).getAllByTitle('YouTube player')).toHaveLength(1);
  });

  it('completes only a valid review after confirmation and navigates to its public detail route', async () => {
    const user = userEvent.setup();
    const reviewStory = { ...story, journey: { ...story.journey, status: 'review' as const } };
    const setJourneyStatus = vi.fn(async () => ({ ...reviewStory.journey, status: 'complete' as const }));
    renderPreview(editorStub(reviewStory, { setJourneyStatus }));

    await user.click(await screen.findByRole('button', { name: '完成旅程' }));
    const dialog = screen.getByRole('dialog', { name: '完成旅程' });
    expect(dialog).toHaveTextContent(reviewStory.journey.title);
    await user.click(within(dialog).getByRole('button', { name: '確認完成旅程' }));

    await waitFor(() => expect(setJourneyStatus).toHaveBeenCalledWith(
      reviewStory.journey.id,
      'complete',
      { expectedUpdatedAt: reviewStory.journey.updatedAt },
    ));
    expect(await screen.findByLabelText('目前路徑')).toHaveTextContent(`/journeys/${reviewStory.journey.id}`);
  });

  it('does not offer completion for an invalid review loaded directly', async () => {
    const invalidStory = {
      ...story,
      journey: { ...story.journey, status: 'review' as const },
      moments: [{
        ...story.moments[0],
        song: { ...story.moments[0].song, title: '' },
      }],
    };
    const editor = editorStub(invalidStory);
    renderPreview(editor);

    expect(await screen.findByText('請填寫第 1 則時刻的歌名。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '完成旅程' })).not.toBeInTheDocument();
    expect(editor.setJourneyStatus).not.toHaveBeenCalled();
  });

  it('keeps a stale review recoverable when the atomic completion transition rejects', async () => {
    const user = userEvent.setup();
    const reviewStory = { ...story, journey: { ...story.journey, status: 'review' as const } };
    const setJourneyStatus = vi.fn(async () => {
      throw new JourneyVersionConflictError(
        reviewStory.journey.id,
        reviewStory.journey.updatedAt,
        '2026-04-05T00:00:00.000Z',
      );
    });
    renderPreview(editorStub(reviewStory, { setJourneyStatus }));

    await user.click(await screen.findByRole('button', { name: '完成旅程' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認完成旅程' }));

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      '旅程內容已更新，請重新載入後再完成。',
    );
    expect(screen.queryByLabelText('目前路徑')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
