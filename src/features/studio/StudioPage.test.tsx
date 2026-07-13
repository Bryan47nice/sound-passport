import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import type { JourneyEditorRepository } from '../../data/ports';
import type { Journey, JourneyStory } from '../../domain/model';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { StudioPage } from './StudioPage';

type RecoveryPageProps = { onBootstrapRetry: () => void };
const RecoveryStudioPage = StudioPage as unknown as (props: RecoveryPageProps) => ReactElement;

const journeys: Journey[] = [
  {
    id: 'draft-journey', title: '札幌下雪的早晨', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895],
    cityLabels: ['札幌'], startDate: '2024-02-01', endDate: '2024-02-04', summary: '', status: 'draft',
    coverPhotoAssetId: 'cover-draft', createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-05T08:00:00.000Z', source: 'private',
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const story: JourneyStory = {
  journey: journeys[0],
  moments: [
    { id: 'moment-1', journeyId: 'draft-journey', photoUrl: 'https://example.com/one.jpg', photoAlt: '', songReferenceId: 'song-1', localDate: '2024-02-01', cityLabel: '札幌', placeLabel: '', caption: '', reason: '', reasonStatus: 'needs_review', sortOrder: 0, createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-01T00:00:00.000Z', song: { id: 'song-1', provider: 'manual', title: '第一首歌', artist: '測試', availability: 'needs_link' } },
    { id: 'moment-2', journeyId: 'draft-journey', photoUrl: 'https://example.com/two.jpg', photoAlt: '', songReferenceId: 'song-2', localDate: '2024-02-02', cityLabel: '札幌', placeLabel: '', caption: '', reason: '', reasonStatus: 'needs_review', sortOrder: 1, createdAt: '2024-02-02T00:00:00.000Z', updatedAt: '2024-02-02T00:00:00.000Z', song: { id: 'song-2', provider: 'manual', title: '第二首歌', artist: '測試', availability: 'available' } },
  ],
};

function editorStub(overrides: Partial<JourneyEditorRepository> = {}): JourneyEditorRepository {
  return {
    listPrivateJourneys: vi.fn(async () => journeys),
    getPrivateJourneyStory: vi.fn(async (id) => id === story.journey.id ? story : undefined),
    createJourney: vi.fn(), updateJourney: vi.fn(), deleteJourney: vi.fn(), addMoments: vi.fn(),
    updateMoment: vi.fn(), deleteMoment: vi.fn(), reorderMoments: vi.fn(), setJourneyStatus: vi.fn(),
    ...overrides,
  };
}

function renderPage(editor = editorStub()) {
  return render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, editor }}>
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
    expect(row).toHaveTextContent('YouTube 1');
    expect(row).toHaveTextContent('圖說 2');
    expect(row).toHaveTextContent('原因 2');
    expect(row).toHaveTextContent(new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(journeys[0].updatedAt)));
    expect(within(row).getByRole('img', { name: '札幌下雪的早晨封面' })).toBeInTheDocument();
    expect(screen.queryByText('釜山的傍晚')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '草稿', selected: true })).toBeInTheDocument();
  });

  it('shows a restrained placeholder when a journey has no cover', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('tab', { name: '待整理' }));

    const row = await screen.findByRole('row', { name: /釜山的傍晚/ });
    expect(within(row).getByLabelText('尚未設定封面')).toHaveTextContent('無封面');
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

  it('implements one labelled tabpanel with roving keyboard selection', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('row', { name: /札幌下雪的早晨/ });

    const draftTab = screen.getByRole('tab', { name: '草稿' });
    const reviewTab = screen.getByRole('tab', { name: '待整理' });
    const completeTab = screen.getByRole('tab', { name: '已完成' });
    expect(draftTab).toHaveAttribute('id', 'studio-tab-draft');
    expect(draftTab).toHaveAttribute('tabindex', '0');
    expect(reviewTab).toHaveAttribute('tabindex', '-1');
    for (const tab of [draftTab, reviewTab, completeTab]) {
      expect(tab).toHaveAttribute('aria-controls', 'studio-panel');
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'studio-panel');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'studio-tab-draft');

    draftTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(reviewTab).toHaveFocus();
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'studio-panel');
    expect(await screen.findByText('釜山的傍晚')).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(completeTab).toHaveFocus();
    expect(completeTab).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(draftTab).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(completeTab).toHaveFocus();
    expect(completeTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows loading, reports repository errors, and retries with the same editor', async () => {
    const user = userEvent.setup();
    const listPrivateJourneys = vi.fn()
      .mockRejectedValueOnce(new Error('IndexedDB unavailable'))
      .mockResolvedValueOnce(journeys);
    renderPage(editorStub({ listPrivateJourneys }));

    expect(screen.getByText('正在載入私人旅程…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '無法載入私人旅程' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新載入' }));

    expect(await screen.findByRole('row', { name: /札幌下雪的早晨/ })).toBeInTheDocument();
    expect(listPrivateJourneys).toHaveBeenCalledTimes(2);
  });

  it('clears ready rows immediately when the editor identity changes', async () => {
    const nextList = deferred<Journey[]>();
    const firstEditor = editorStub();
    const secondEditor = editorStub({ listPrivateJourneys: vi.fn(() => nextList.promise) });
    const view = renderPage(firstEditor);
    await screen.findByRole('row', { name: /札幌下雪的早晨/ });

    view.rerender(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, editor: secondEditor }}>
        <MemoryRouter><StudioPage /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(screen.queryByText('札幌下雪的早晨')).not.toBeInTheDocument();
    expect(screen.getByText('正在載入私人旅程…')).toBeInTheDocument();
    nextList.resolve([]);
    expect(await screen.findByText('這裡還沒有草稿旅程。')).toBeInTheDocument();
  });

  it('ignores stale repository resolutions after the editor identity changes', async () => {
    const staleList = deferred<Journey[]>();
    const staleEditor = editorStub({ listPrivateJourneys: vi.fn(() => staleList.promise) });
    const currentJourney = { ...journeys[0], id: 'current-draft', title: '目前的旅程' };
    const currentEditor = editorStub({
      listPrivateJourneys: vi.fn(async () => [currentJourney]),
      getPrivateJourneyStory: vi.fn(async () => undefined),
    });
    const view = renderPage(staleEditor);

    view.rerender(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, editor: currentEditor }}>
        <MemoryRouter><StudioPage /></MemoryRouter>
      </RepositoryProvider>,
    );
    expect(await screen.findByText('目前的旅程')).toBeInTheDocument();

    await act(async () => { staleList.resolve(journeys); });
    expect(screen.getByText('目前的旅程')).toBeInTheDocument();
    expect(screen.queryByText('札幌下雪的早晨')).not.toBeInTheDocument();
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

  it('shows the exact blocked-database guidance propagated by bootstrap', () => {
    render(
      <RepositoryProvider services={{
        query: fixtureJourneyRepository,
        privateStorageError: '請關閉其他分頁後重新嘗試',
      }}>
        <MemoryRouter><StudioPage /></MemoryRouter>
      </RepositoryProvider>,
    );

    expect(screen.getByText('請關閉其他分頁後重新嘗試')).toBeInTheDocument();
  });

  it('retries bootstrap when the editor service is unavailable', async () => {
    const user = userEvent.setup();
    const onBootstrapRetry = vi.fn();
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter><RecoveryStudioPage onBootstrapRetry={onBootstrapRetry} /></MemoryRouter>
      </RepositoryProvider>,
    );

    await user.click(screen.getByRole('button', { name: '重新嘗試' }));
    expect(onBootstrapRetry).toHaveBeenCalledTimes(1);
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

  it('responds to matchMedia changes and removes the exact listener on cleanup', async () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: false,
      addEventListener: vi.fn((_event: string, nextListener: () => void) => { listener = nextListener; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const view = renderPage();
    await screen.findByRole('row', { name: /札幌下雪的早晨/ });

    media.matches = true;
    act(() => listener?.());
    expect(screen.getByText('請使用電腦整理旅程')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '新增旅程' })).not.toBeInTheDocument();

    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
