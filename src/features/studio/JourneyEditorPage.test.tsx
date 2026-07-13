import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { JourneyVersionConflictError, type JourneyEditorRepository } from '../../data/ports';
import type { Journey, JourneyPatch, JourneyStory } from '../../domain/model';

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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function versionAfter(version: string) {
  return new Date(Date.parse(version) + 1).toISOString();
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function editorStub(overrides: Partial<JourneyEditorRepository> = {}): JourneyEditorRepository {
  let currentStory: JourneyStory = {
    journey: { ...story.journey, cityLabels: [...story.journey.cityLabels] },
    moments: story.moments.map((moment) => ({ ...moment, song: { ...moment.song } })),
  };
  const repository: JourneyEditorRepository = {
    listPrivateJourneys: vi.fn(async () => [currentStory.journey]),
    createJourney: vi.fn(),
    updateJourney: vi.fn(async (_id, patch) => {
      currentStory = {
        ...currentStory,
        journey: {
          ...currentStory.journey,
          ...patch,
          updatedAt: versionAfter(currentStory.journey.updatedAt),
        },
      };
      return currentStory.journey;
    }),
    deleteJourney: vi.fn(),
    getPrivateJourneyStory: vi.fn(async (id) => id === currentStory.journey.id ? currentStory : undefined),
    addMoments: vi.fn(),
    updateMoment: vi.fn(),
    deleteMoment: vi.fn(),
    reorderMoments: vi.fn(),
    setJourneyStatus: vi.fn(),
  };
  return { ...repository, ...overrides };
}

function renderRoute(editor: JourneyEditorRepository | null = editorStub(), path = '/studio/journeys/private-tokyo') {
  return render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, editor: editor ?? undefined }}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </RepositoryProvider>,
  );
}

function RouteSwitcher() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/studio/journeys/private-kyoto')}>切換旅程</button>;
}

describe('JourneyEditorPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it('synchronously suppresses the loaded journey when the route id changes', async () => {
    const nextLoad = deferred<JourneyStory | undefined>();
    const nextStory: JourneyStory = {
      ...story,
      journey: { ...story.journey, id: 'private-kyoto', title: '京都清晨' },
    };
    const getPrivateJourneyStory = vi.fn((id: string) => (
      id === story.journey.id ? Promise.resolve(story) : nextLoad.promise
    ));
    const editor = editorStub({ getPrivateJourneyStory });
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, editor }}>
        <MemoryRouter initialEntries={['/studio/journeys/private-tokyo']}>
          <RouteSwitcher />
          <App />
        </MemoryRouter>
      </RepositoryProvider>,
    );
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.click(screen.getByRole('button', { name: '切換旅程' }));
    expect(screen.queryByRole('heading', { name: '東京夜行' })).not.toBeInTheDocument();
    expect(screen.getByText('正在載入旅程…')).toBeInTheDocument();

    await act(async () => { nextLoad.resolve(nextStory); await nextLoad.promise; });
    expect(await screen.findByRole('heading', { name: '京都清晨' })).toBeInTheDocument();
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

  it('demotes a complete journey in the same version-checked update when a required field is removed', async () => {
    const editor = editorStub();
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '' } });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(editor.updateJourney).toHaveBeenCalledWith(
      'private-tokyo',
      { title: '', status: 'review' },
      { expectedUpdatedAt: story.journey.updatedAt },
    );
    expect(screen.getByText('必要資料已移除，旅程已回到待整理')).toBeInTheDocument();
  });

  it('never re-promotes when a demotion completes before a second queued edit', async () => {
    const firstWrite = deferred();
    let persisted = story.journey;
    const updateJourney = vi.fn(async (_id: string, patch: JourneyPatch) => {
      if (updateJourney.mock.calls.length === 1) await firstWrite.promise;
      persisted = { ...persisted, ...patch, updatedAt: versionAfter(persisted.updatedAt) };
      return persisted;
    });
    const getPrivateJourneyStory = vi.fn(async () => ({ ...story, journey: persisted }));
    const editor = editorStub({ updateJourney, getPrivateJourneyStory });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(screen.getByLabelText('旅程總文（選填）'), { target: { value: '第二次編輯' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(updateJourney).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstWrite.resolve(undefined);
      await firstWrite.promise;
      await flushMicrotasks();
    });
    expect(updateJourney).toHaveBeenCalledTimes(2);
    expect(updateJourney.mock.calls[0][1]).toEqual({ title: '', status: 'review' });
    expect(updateJourney.mock.calls[1][1]).toEqual({ summary: '第二次編輯' });
    expect(updateJourney.mock.calls[1][1]).not.toHaveProperty('status');
    expect(screen.getByText('待整理')).toBeInTheDocument();
  });

  it('rebases a field patch over a disjoint persisted change without sending a snapshot', async () => {
    const external = {
      ...story,
      journey: {
        ...story.journey,
        summary: '其他分頁更新的總文',
        status: 'review' as const,
        updatedAt: '2024-05-04T00:00:01.000Z',
      },
    };
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(story)
      .mockResolvedValue(external);
    const updateJourney = vi.fn(async (_id: string, patch: JourneyPatch) => ({
      ...external.journey,
      ...patch,
      updatedAt: '2024-05-04T00:00:02.000Z',
    }));
    const editor = editorStub({ getPrivateJourneyStory, updateJourney });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '本機新標題' } });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(updateJourney).toHaveBeenCalledWith(
      story.journey.id,
      { title: '本機新標題' },
      { expectedUpdatedAt: external.journey.updatedAt },
    );
    expect(updateJourney.mock.calls[0][1]).not.toHaveProperty('summary');
    expect(updateJourney.mock.calls[0][1]).not.toHaveProperty('status');
    expect(updateJourney.mock.calls[0][1]).not.toHaveProperty('id');
    expect(updateJourney.mock.calls[0][1]).not.toHaveProperty('updatedAt');
    expect(screen.getByText('待整理')).toBeInTheDocument();
  });

  it('shows a same-field conflict and overwrites only after explicit Retry', async () => {
    const external: JourneyStory = {
      ...story,
      journey: {
        ...story.journey,
        title: '其他分頁標題',
        updatedAt: '2024-05-04T00:00:01.000Z',
      },
    };
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(story)
      .mockResolvedValue(external);
    const updateJourney = vi.fn(async (_id: string, patch: JourneyPatch) => ({
      ...external.journey,
      ...patch,
      updatedAt: '2024-05-04T00:00:02.000Z',
    }));
    const editor = editorStub({ getPrivateJourneyStory, updateJourney });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '本機保留標題' } });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(updateJourney).not.toHaveBeenCalled();
    expect(screen.getByLabelText('旅程標題')).toHaveValue('本機保留標題');
    expect(screen.getByText('內容衝突')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試並套用' }));
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(1);

    expect(updateJourney).toHaveBeenCalledWith(
      story.journey.id,
      { title: '本機保留標題' },
      { expectedUpdatedAt: external.journey.updatedAt },
    );
  });

  it('refreshes the current version after an atomic repository conflict before Retry', async () => {
    const raced: JourneyStory = {
      ...story,
      journey: {
        ...story.journey,
        title: '競爭寫入標題',
        updatedAt: '2024-05-04T00:00:01.000Z',
      },
    };
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(story)
      .mockResolvedValueOnce(story)
      .mockResolvedValue(raced);
    const updateJourney = vi.fn()
      .mockRejectedValueOnce(new JourneyVersionConflictError(
        story.journey.id,
        story.journey.updatedAt,
        raced.journey.updatedAt,
      ))
      .mockImplementationOnce(async (_id: string, patch: JourneyPatch) => ({
        ...raced.journey,
        ...patch,
        updatedAt: '2024-05-04T00:00:02.000Z',
      }));
    const editor = editorStub({ getPrivateJourneyStory, updateJourney });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '本機競爭標題' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText('內容衝突')).toBeInTheDocument();
    expect(screen.getByLabelText('旅程標題')).toHaveValue('本機競爭標題');

    fireEvent.click(screen.getByRole('button', { name: '重試並套用' }));
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(2);
    expect(updateJourney.mock.calls[1][2]).toEqual({ expectedUpdatedAt: raced.journey.updatedAt });
  });

  it('marks and describes both date inputs when the range is invalid', async () => {
    const editor = editorStub();
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2024-04-30' } });
    const startDate = screen.getByLabelText('開始日期');
    const endDate = screen.getByLabelText('結束日期');
    expect(screen.getByText('結束日期不得早於開始日期')).toHaveAttribute('id', 'journey-date-error');
    expect(startDate).toHaveAttribute('aria-invalid', 'true');
    expect(endDate).toHaveAttribute('aria-invalid', 'true');
    expect(startDate).toHaveAttribute('aria-describedby', 'journey-date-error');
    expect(endDate).toHaveAttribute('aria-describedby', 'journey-date-error');
    expect(editor.updateJourney).not.toHaveBeenCalled();
  });

  it('saves catalog country fields atomically and manages cities as immediate field patches', async () => {
    const editor = editorStub();
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.change(screen.getByLabelText('國家'), { target: { value: 'TW' } });
    await waitFor(() => expect(editor.updateJourney).toHaveBeenCalledWith(
      'private-tokyo',
      expect.objectContaining({ countryCode: 'TW', countryName: '台灣', countryCoordinates: expect.any(Array) }),
      expect.objectContaining({ expectedUpdatedAt: expect.any(String) }),
    ));

    vi.mocked(editor.updateJourney).mockClear();
    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '新增城市' }));
    expect(editor.updateJourney).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '台北' } });
    fireEvent.click(screen.getByRole('button', { name: '新增城市' }));
    await waitFor(() => expect(editor.updateJourney).toHaveBeenCalledWith(
      'private-tokyo',
      { cityLabels: ['東京', '台北'] },
      expect.objectContaining({ expectedUpdatedAt: expect.any(String) }),
    ));
  });

  it('provides keyboard-adjustable desktop separators with stable numeric values', async () => {
    renderRoute();
    await screen.findByRole('heading', { name: '東京夜行' });

    const listSeparator = screen.getByRole('separator', { name: '調整時刻清單寬度' });
    const detailsSeparator = screen.getByRole('separator', { name: '調整旅程資料寬度' });
    expect(listSeparator).toHaveAttribute('aria-orientation', 'vertical');
    expect(listSeparator).toHaveAttribute('aria-valuenow', '220');
    expect(detailsSeparator).toHaveAttribute('aria-valuenow', '340');

    fireEvent.keyDown(listSeparator, { key: 'ArrowRight' });
    expect(listSeparator).toHaveAttribute('aria-valuenow', '236');
    fireEvent.keyDown(listSeparator, { key: 'Home' });
    expect(listSeparator).toHaveAttribute('aria-valuenow', '180');
    fireEvent.keyDown(detailsSeparator, { key: 'ArrowLeft' });
    expect(detailsSeparator).toHaveAttribute('aria-valuenow', '356');
  });

  it('shows only desktop guidance on mobile', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    renderRoute();
    expect(document.querySelector('main')?.textContent).toBe('請使用電腦整理旅程');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
