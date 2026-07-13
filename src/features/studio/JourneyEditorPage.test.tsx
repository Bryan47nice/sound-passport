import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyEditorRepository } from '../../data/ports';
import type { JourneyStory } from '../../domain/model';

const story: JourneyStory = {
  journey: {
    id: 'private-tokyo',
    title: '東京夜行',
    countryCode: 'JP',
    countryName: '日本',
    countryCoordinates: [139.6917, 35.6895],
    cityLabels: ['東京'],
    startDate: '2024-05-01',
    endDate: '2024-05-03',
    summary: '沿著晚風散步。',
    status: 'complete',
    source: 'private',
    createdAt: '2024-05-01T00:00:00.000Z',
    updatedAt: '2024-05-04T00:00:00.000Z',
  },
  moments: [{
    id: 'moment-1', journeyId: 'private-tokyo', photoUrl: '/tokyo.jpg', photoAlt: '東京街景',
    songReferenceId: 'song-1', localDate: '2024-05-02', cityLabel: '東京', placeLabel: '澀谷',
    caption: '', reason: '', reasonStatus: 'needs_review', sortOrder: 0,
    createdAt: '2024-05-01T00:00:00.000Z', updatedAt: '2024-05-01T00:00:00.000Z',
    song: { id: 'song-1', provider: 'manual', title: 'Night Walk', artist: 'Aki', availability: 'needs_link' },
  }],
};

function editorStub(overrides: Partial<JourneyEditorRepository> = {}): JourneyEditorRepository {
  return {
    listPrivateJourneys: vi.fn(),
    createJourney: vi.fn(),
    updateJourney: vi.fn(async (_id, patch) => ({ ...story.journey, ...patch, updatedAt: '2024-05-04T01:02:03.000Z' })),
    deleteJourney: vi.fn(),
    getPrivateJourneyStory: vi.fn(async () => story),
    addMoments: vi.fn(), updateMoment: vi.fn(), deleteMoment: vi.fn(), reorderMoments: vi.fn(), setJourneyStatus: vi.fn(),
    ...overrides,
  };
}

function renderRoute(editor: JourneyEditorRepository | null = editorStub(), path = '/studio/journeys/private-tokyo') {
  return render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, editor: editor ?? undefined }}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </RepositoryProvider>,
  );
}

describe('JourneyEditorPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads the private editor story on direct reload and renders the three-region work surface', async () => {
    const editor = editorStub();
    renderRoute(editor);

    expect(screen.getByText('正在載入旅程…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '東京夜行' })).toBeInTheDocument();
    expect(editor.getPrivateJourneyStory).toHaveBeenCalledWith('private-tokyo');
    expect(screen.getByLabelText('旅程標題')).toHaveValue('東京夜行');
    expect(screen.getByLabelText('國家')).toHaveValue('JP');
    expect(screen.getByLabelText('開始日期')).toHaveValue('2024-05-01');
    expect(screen.getByLabelText('結束日期')).toHaveValue('2024-05-03');
    expect(screen.getByLabelText('旅程總文（選填）')).toHaveValue('沿著晚風散步。');
    expect(screen.getByRole('region', { name: '時刻清單' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '時刻預覽' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '旅程資料' })).toBeInTheDocument();
  });

  it('shows not found for a missing private journey id', async () => {
    renderRoute(editorStub({ getPrivateJourneyStory: vi.fn(async () => undefined) }), '/studio/journeys/missing');
    expect(await screen.findByRole('heading', { name: '找不到這趟私人旅程' })).toBeInTheDocument();
  });

  it('shows the unavailable state when private storage is not ready', () => {
    renderRoute(null);
    expect(screen.getByRole('heading', { name: '本機儲存空間暫時無法使用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument();
  });

  it('offers retry after a load error', async () => {
    const getPrivateJourneyStory = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(story);
    renderRoute(editorStub({ getPrivateJourneyStory }));
    expect(await screen.findByRole('heading', { name: '無法載入旅程' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(await screen.findByRole('heading', { name: '東京夜行' })).toBeInTheDocument();
    expect(getPrivateJourneyStory).toHaveBeenCalledTimes(2);
  });

  it('demotes a complete journey in the same update when a required field is removed', async () => {
    vi.useFakeTimers();
    const editor = editorStub();
    renderRoute(editor);
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '' } });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(editor.updateJourney).toHaveBeenCalledWith('private-tokyo', { title: '', status: 'review' });
    expect(screen.getByText('必要資料已移除，旅程已回到待整理')).toBeInTheDocument();
  });

  it('validates dates and saves catalog country fields atomically', async () => {
    const editor = editorStub();
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2024-04-30' } });
    expect(screen.getByText('結束日期不得早於開始日期')).toBeInTheDocument();
    expect(editor.updateJourney).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('國家'), { target: { value: 'TW' } });
    await waitFor(() => expect(editor.updateJourney).toHaveBeenCalledWith('private-tokyo', expect.objectContaining({
      countryCode: 'TW', countryName: '台灣', countryCoordinates: expect.any(Array),
    })));
  });

  it('adds and removes cities immediately without duplicate blanks', async () => {
    const editor = editorStub();
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '新增城市' }));
    expect(editor.updateJourney).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '東京' } });
    fireEvent.click(screen.getByRole('button', { name: '新增城市' }));
    expect(editor.updateJourney).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '台北' } });
    fireEvent.click(screen.getByRole('button', { name: '新增城市' }));
    await waitFor(() => expect(editor.updateJourney).toHaveBeenCalledWith('private-tokyo', { cityLabels: ['東京', '台北'] }));

    fireEvent.click(screen.getByRole('button', { name: '移除城市 東京' }));
    await waitFor(() => expect(editor.updateJourney).toHaveBeenLastCalledWith('private-tokyo', { cityLabels: ['台北'] }));
  });

  it('shows only desktop guidance on mobile', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    renderRoute();
    expect(document.querySelector('main')?.textContent).toBe('請使用電腦整理旅程');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
