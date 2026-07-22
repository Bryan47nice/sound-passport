import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { AuthProvider } from '../../auth/AuthContext';
import type { AuthPort, AuthUser } from '../../auth/ports';
import { RepositoryProvider as DataRepositoryProvider, type RepositoryServices } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import {
  JourneyVersionConflictError,
  MomentVersionConflictError,
  type JourneyAutosaveOutboxPort,
  type JourneyAutosaveOutboxRecord,
  type JourneyEditorRepository,
  type UpdateMomentOptions,
} from '../../data/ports';
import type { Journey, JourneyPatch, JourneyStory, Moment, MomentPatch } from '../../domain/model';
import { claimJourneyOutboxOwner } from './journeyOutbox';

const signedInUser: AuthUser = {
  uid: 'studio-test-user',
  displayName: 'Studio Test User',
  email: 'studio@example.com',
  photoURL: null,
};

const signedInAuthPort: AuthPort = {
  observe(listener) {
    listener(signedInUser);
    return () => undefined;
  },
  signInWithGoogle: async () => undefined,
  signOut: async () => undefined,
};

function RepositoryProvider({ children, services }: PropsWithChildren<{ services: RepositoryServices }>) {
  return (
    <AuthProvider port={signedInAuthPort}>
      <DataRepositoryProvider services={services}>{children}</DataRepositoryProvider>
    </AuthProvider>
  );
}

const ownerStorageKey = 'sound-passport.journey-autosave-owner-id';
const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const ownerC = '33333333-3333-4333-8333-333333333333';

class DeterministicLockManager {
  private readonly held = new Set<string>();

  async request<T>(
    name: string,
    _options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ) {
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      this.held.delete(name);
    }
  }

  isHeld(ownerId: string) {
    return this.held.has(`sound-passport-owner:${ownerId}`);
  }
}

let ownerLocks: DeterministicLockManager;

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

function findStyleRule(rules: CSSRuleList, selector: string) {
  return Array.from(rules).find((rule) => (rule as CSSStyleRule).selectorText === selector) as
    CSSStyleRule | undefined;
}

function findMediaRule(rules: CSSRuleList, mediaText: string) {
  return Array.from(rules).find((rule) => (rule as CSSMediaRule).media?.mediaText === mediaText) as
    CSSMediaRule | undefined;
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

type InspectableOutbox = JourneyAutosaveOutboxPort & {
  peek: (journeyId: string, ownerId?: string) => JourneyAutosaveOutboxRecord | undefined;
};

function outboxStub(initial: JourneyAutosaveOutboxRecord[] = []): InspectableOutbox {
  const records = new Map<string, JourneyAutosaveOutboxRecord>();
  const key = (journeyId: string, ownerId: string) => `${journeyId}\u0000${ownerId}`;
  initial.forEach((record) => records.set(key(record.journeyId, record.ownerId), record));
  return {
    get: vi.fn(async (journeyId, ownerId) => records.get(key(journeyId, ownerId))),
    listByJourney: vi.fn(async (journeyId) => (
      [...records.values()]
        .filter((record) => record.journeyId === journeyId)
        .sort((left, right) => left.ownerId.localeCompare(right.ownerId))
    )),
    adopt: vi.fn(async (journeyId, fromOwnerId, toOwnerId, expectedGeneration?: string) => {
      const exact = records.get(key(journeyId, toOwnerId));
      if (exact) return exact;
      const source = records.get(key(journeyId, fromOwnerId));
      if (!source || (expectedGeneration !== undefined && source.generation !== expectedGeneration)) {
        return undefined;
      }
      const adopted = { ...source, ownerId: toOwnerId };
      records.delete(key(journeyId, fromOwnerId));
      records.set(key(journeyId, toOwnerId), adopted);
      return adopted;
    }),
    put: vi.fn(async (record) => { records.set(key(record.journeyId, record.ownerId), record); }),
    compareAndDelete: vi.fn(async (journeyId, ownerId, generation) => {
      const recordKey = key(journeyId, ownerId);
      if (records.get(recordKey)?.generation !== generation) return false;
      records.delete(recordKey);
      return true;
    }),
    peek: (journeyId, ownerId = ownerA) => records.get(key(journeyId, ownerId)),
  };
}

function recoveryRecord(
  ownerId: string,
  title: string,
  generation: string,
): JourneyAutosaveOutboxRecord {
  return {
    journeyId: story.journey.id,
    ownerId,
    generation,
    envelope: {
      patch: { title },
      base: { title: story.journey.title },
    },
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

function controllableMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const result = {
    get matches() { return matches; },
    media: '(max-width: 640px)',
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  return {
    matchMedia: vi.fn(() => result),
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function renderRoute(
  editor: JourneyEditorRepository | null = editorStub(),
  path = '/studio/journeys/private-tokyo',
  outbox: JourneyAutosaveOutboxPort = outboxStub(),
  privateStorageError?: string,
) {
  return render(
    <RepositoryProvider services={{
      query: fixtureJourneyRepository,
      editor: editor ?? undefined,
      outbox: editor ? outbox : undefined,
      privateStorageError,
    }}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </RepositoryProvider>,
  );
}

function RouteSwitcher() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/studio/journeys/private-kyoto')}>切換旅程</button>;
}

function HistoryBackControl() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>瀏覽器返回</button>;
}

function storyWithTwoMoments(): JourneyStory {
  const second = {
    ...story.moments[0],
    id: 'moment-2',
    songReferenceId: 'song-2',
    sortOrder: 1,
    photoAlt: '東京清晨',
    song: { ...story.moments[0].song, id: 'song-2', title: 'Morning Walk' },
  };
  return {
    journey: { ...story.journey },
    moments: [story.moments[0], second],
  };
}

describe('JourneyEditorPage', () => {
  beforeEach(() => {
    ownerLocks = new DeterministicLockManager();
    vi.stubGlobal('navigator', { locks: ownerLocks });
    window.sessionStorage.setItem(ownerStorageKey, ownerA);
  });

  afterEach(async () => {
    cleanup();
    await flushMicrotasks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
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
    expect(screen.getByRole('region', { name: '時刻資料' })).toBeInTheDocument();
    expect(screen.getByLabelText('加入照片')).toHaveAttribute('multiple');
    expect(screen.getByLabelText('歌名')).toHaveValue('Night Walk');
  });

  it('flushes journey and moment drafts before atomically moving a valid draft to review preview', async () => {
    const journeyWrite = deferred();
    const momentWrite = deferred();
    const operations: string[] = [];
    let currentStory: JourneyStory = {
      journey: { ...story.journey, status: 'draft' },
      moments: story.moments.map((moment) => ({ ...moment, song: { ...moment.song } })),
    };
    const updateJourney = vi.fn(async (_id: string, patch: JourneyPatch) => {
      operations.push('journey:start');
      await journeyWrite.promise;
      currentStory = {
        ...currentStory,
        journey: {
          ...currentStory.journey,
          ...patch,
          updatedAt: versionAfter(currentStory.journey.updatedAt),
        },
      };
      operations.push('journey:commit');
      return currentStory.journey;
    });
    const updateMoment = vi.fn(async (_id: string, patch: MomentPatch) => {
      operations.push('moment:start');
      await momentWrite.promise;
      const current = currentStory.moments[0];
      const nextMoment = {
        ...current,
        ...patch,
        song: patch.song ? { ...current.song, ...patch.song } : current.song,
        updatedAt: versionAfter(current.updatedAt),
      };
      currentStory = {
        journey: {
          ...currentStory.journey,
          updatedAt: versionAfter(currentStory.journey.updatedAt),
        },
        moments: [nextMoment],
      };
      operations.push('moment:commit');
      return nextMoment;
    });
    const setJourneyStatus = vi.fn(async (_id: string, status: Journey['status']) => {
      operations.push('status:review');
      currentStory = {
        ...currentStory,
        journey: {
          ...currentStory.journey,
          status,
          updatedAt: versionAfter(currentStory.journey.updatedAt),
        },
      };
      return currentStory.journey;
    });
    const editor = editorStub({
      getPrivateJourneyStory: vi.fn(async () => currentStory),
      updateJourney,
      updateMoment,
      setJourneyStatus,
    });
    renderRoute(editor);

    const title = await screen.findByRole('textbox', { name: '旅程標題' });
    fireEvent.change(title, { target: { value: '東京夜行，重新整理' } });
    fireEvent.change(screen.getByRole('textbox', { name: '歌名' }), { target: { value: 'Night Walk Revised' } });
    fireEvent.click(screen.getByRole('button', { name: '前往預覽' }));

    await waitFor(() => expect(operations).toEqual(['journey:start']));
    expect(setJourneyStatus).not.toHaveBeenCalled();

    await act(async () => {
      journeyWrite.resolve();
      await journeyWrite.promise;
      await flushMicrotasks();
    });
    expect(operations).toEqual(['journey:start', 'journey:commit', 'moment:start']);
    expect(setJourneyStatus).not.toHaveBeenCalled();

    await act(async () => {
      momentWrite.resolve();
      await momentWrite.promise;
      await flushMicrotasks();
    });

    await waitFor(() => expect(setJourneyStatus).toHaveBeenCalledWith(
      story.journey.id,
      'review',
      { expectedUpdatedAt: expect.any(String) },
    ));
    expect(operations).toEqual([
      'journey:start',
      'journey:commit',
      'moment:start',
      'moment:commit',
      'status:review',
    ]);
    expect(await screen.findByRole('button', { name: '完成旅程' })).toBeInTheDocument();
  });

  it('keeps an invalid draft in draft, reports actionable validation, and focuses the first failing field', async () => {
    const invalidStory: JourneyStory = {
      ...story,
      journey: { ...story.journey, title: '', status: 'draft' },
    };
    const setJourneyStatus = vi.fn();
    const editor = editorStub({
      getPrivateJourneyStory: vi.fn(async () => invalidStory),
      setJourneyStatus,
    });
    renderRoute(editor);

    const title = await screen.findByRole('textbox', { name: '旅程標題' });
    fireEvent.click(screen.getByRole('button', { name: '前往預覽' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('請填寫旅程標題。');
    expect(title).toHaveFocus();
    expect(setJourneyStatus).not.toHaveBeenCalled();
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('focuses the mapped invalid field after switching to a different moment', async () => {
    const invalidStory: JourneyStory = {
      journey: { ...story.journey, status: 'draft' },
      moments: [
        story.moments[0],
        {
          ...story.moments[0],
          id: 'moment-2',
          photoUrl: '/tokyo-second.jpg',
          photoAlt: '東京第二張街景',
          songReferenceId: 'song-2',
          sortOrder: 1,
          song: {
            ...story.moments[0].song,
            id: 'song-2',
            title: '',
          },
        },
      ],
    };
    const editor = editorStub({
      getPrivateJourneyStory: vi.fn(async () => invalidStory),
    });
    renderRoute(editor);

    await screen.findByRole('heading', { name: story.journey.title });
    expect(screen.getByRole('textbox', { name: '歌名' })).toHaveValue('Night Walk');
    fireEvent.click(screen.getByRole('button', { name: '前往預覽' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('請填寫第 2 則時刻的歌名。');
    const invalidSongTitle = screen.getByRole('textbox', { name: '歌名' });
    expect(invalidSongTitle).toHaveValue('');
    expect(invalidSongTitle).toHaveFocus();
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
      <RepositoryProvider services={{ query: fixtureJourneyRepository, editor, outbox: outboxStub() }}>
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

  it('shows the exact blocked-upgrade guidance on a direct editor route', () => {
    renderRoute(null, '/studio/journeys/private-tokyo', outboxStub(), '請關閉其他分頁後重新嘗試');
    expect(screen.getByText('請關閉其他分頁後重新嘗試')).toBeInTheDocument();
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

  it('keeps the route editor mounted until an AppShell navigation flush succeeds', async () => {
    const write = deferred<Journey>();
    const updateJourney = vi.fn(() => write.promise);
    const editor = editorStub({ updateJourney });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '離開前標題' } });
    fireEvent.click(screen.getByRole('link', { name: '整理' }));
    await act(flushMicrotasks);

    expect(updateJourney).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: '離開前標題' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '旅程資料' })).toBeInTheDocument();

    const updated = {
      ...story.journey,
      title: '離開前標題',
      updatedAt: versionAfter(story.journey.updatedAt),
    };
    await act(async () => { write.resolve(updated); await write.promise; await flushMicrotasks(); });
    expect(await screen.findByRole('heading', { name: '整理旅程' })).toBeInTheDocument();
  });

  it('keeps preview pending until the active reorder and refresh both finish', async () => {
    const currentStory = storyWithTwoMoments();
    const reorder = deferred<void>();
    const refresh = deferred<JourneyStory>();
    let loaded = false;
    let reorderFinished = false;
    let refreshFinished = false;
    const getPrivateJourneyStory = vi.fn(async () => {
      if (!loaded) {
        loaded = true;
        return currentStory;
      }
      if (reorderFinished && !refreshFinished) return refresh.promise;
      return currentStory;
    });
    const editor = editorStub({
      getPrivateJourneyStory,
      reorderMoments: vi.fn(async () => {
        await reorder.promise;
        reorderFinished = true;
      }),
    });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    fireEvent.click(screen.getByRole('button', { name: '前往預覽' }));
    await act(flushMicrotasks);

    expect(screen.getByRole('button', { name: '前往預覽' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '查看已完成旅程' })).not.toBeInTheDocument();

    await act(async () => {
      reorder.resolve();
      await reorder.promise;
      await flushMicrotasks();
    });
    expect(screen.queryByRole('button', { name: '查看已完成旅程' })).not.toBeInTheDocument();

    await act(async () => {
      refreshFinished = true;
      refresh.resolve({ ...currentStory, moments: [...currentStory.moments].reverse() });
      await refresh.promise;
      await flushMicrotasks();
    });
    expect(await screen.findByRole('link', { name: '查看已完成旅程' })).toBeInTheDocument();
  });

  it('holds a newer AppShell PUSH until pending reorder work succeeds', async () => {
    const currentStory = storyWithTwoMoments();
    const reorder = deferred<void>();
    const editor = editorStub({
      getPrivateJourneyStory: vi.fn(async () => currentStory),
      reorderMoments: vi.fn(() => reorder.promise),
    });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    fireEvent.click(screen.getByRole('link', { name: '整理' }));
    await act(flushMicrotasks);

    expect(screen.getByRole('button', { name: '前往預覽' })).toBeInTheDocument();
    await act(async () => {
      reorder.resolve();
      await reorder.promise;
      await flushMicrotasks();
    });
    expect(await screen.findByRole('heading', { name: '整理旅程' })).toBeInTheDocument();
  });

  it('holds a newer POP until pending reorder work succeeds', async () => {
    const currentStory = storyWithTwoMoments();
    const reorder = deferred<void>();
    const editor = editorStub({
      getPrivateJourneyStory: vi.fn(async () => currentStory),
      reorderMoments: vi.fn(() => reorder.promise),
    });
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, editor, outbox: outboxStub() }}>
        <MemoryRouter
          initialEntries={['/studio', '/studio/journeys/private-tokyo']}
          initialIndex={1}
        >
          <HistoryBackControl />
          <App />
        </MemoryRouter>
      </RepositoryProvider>,
    );
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    fireEvent.click(screen.getByRole('button', { name: '瀏覽器返回' }));
    await act(flushMicrotasks);

    expect(screen.getByRole('button', { name: '前往預覽' })).toBeInTheDocument();
    await act(async () => {
      reorder.resolve();
      await reorder.promise;
      await flushMicrotasks();
    });
    expect(await screen.findByRole('heading', { name: '整理旅程' })).toBeInTheDocument();
  });

  it('does not let deferred preview redirect override a newer POP', async () => {
    const commandLoad = deferred<JourneyStory | undefined>();
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(story)
      .mockImplementationOnce(() => commandLoad.promise)
      .mockResolvedValue(story);
    const editor = editorStub({ getPrivateJourneyStory });
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository, editor, outbox: outboxStub() }}>
        <MemoryRouter
          initialEntries={['/studio', '/studio/journeys/private-tokyo']}
          initialIndex={1}
        >
          <HistoryBackControl />
          <App />
        </MemoryRouter>
      </RepositoryProvider>,
    );
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.click(screen.getByRole('button', { name: '前往預覽' }));
    await waitFor(() => expect(getPrivateJourneyStory).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '瀏覽器返回' }));
    expect(await screen.findByRole('heading', { name: '整理旅程' })).toBeInTheDocument();

    await act(async () => {
      commandLoad.resolve(story);
      await commandLoad.promise;
      await flushMicrotasks();
    });

    expect(screen.getByRole('heading', { name: '整理旅程' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看已完成旅程' })).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('旅程總文（選填）')).toHaveValue('其他分頁更新的總文');
  });

  it('keeps an ordinary same-field retry conflict-safe and overwrites only after the explicit force action', async () => {
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
    const saveStatus = document.querySelector('.journey-save-status');
    const saveActions = saveStatus?.querySelector('.journey-save-actions');
    expect(saveActions).toBeInTheDocument();
    expect(saveActions?.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByLabelText('旅程標題')).toHaveValue('本機保留標題');
    expect(screen.getByText('內容衝突')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(flushMicrotasks);
    expect(updateJourney).not.toHaveBeenCalled();
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

  it('turns generic failure plus a concurrent same-field change into conflict before explicit force retry', async () => {
    let persisted: JourneyStory = story;
    const getPrivateJourneyStory = vi.fn(async () => persisted);
    const updateJourney = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockImplementationOnce(async (_id: string, patch: JourneyPatch, options?: { expectedUpdatedAt?: string }) => {
        persisted = {
          ...persisted,
          journey: {
            ...persisted.journey,
            ...patch,
            updatedAt: versionAfter(persisted.journey.updatedAt),
          },
        };
        expect(options).toEqual({ expectedUpdatedAt: '2024-05-04T00:00:01.000Z' });
        return persisted.journey;
      });
    const editor = editorStub({ getPrivateJourneyStory, updateJourney });
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '本機失敗標題' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText('儲存失敗')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重試並套用' })).not.toBeInTheDocument();

    persisted = {
      ...persisted,
      journey: {
        ...persisted.journey,
        title: '其他分頁標題',
        updatedAt: '2024-05-04T00:00:01.000Z',
      },
    };
    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(1);
    expect(screen.getByText('內容衝突')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重試並套用' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重試並套用' }));
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(2);
    expect(updateJourney.mock.calls[1][1]).toEqual({ title: '本機失敗標題' });
  });

  it('retries against the latest version after a concurrent moment mutation invalidates the story', async () => {
    const raced: JourneyStory = {
      ...story,
      journey: {
        ...story.journey,
        status: 'review',
        updatedAt: '2024-05-04T00:00:01.000Z',
      },
      moments: story.moments.map((moment) => ({ ...moment, localDate: '2024-04-30' })),
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
    expect(screen.getByText('待整理')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(2);
    expect(updateJourney.mock.calls[1][2]).toEqual({ expectedUpdatedAt: raced.journey.updatedAt });
    expect(updateJourney.mock.calls[1][1]).toEqual({ title: '本機競爭標題' });
  });

  it('does not overwrite a newer local field while rebasing an older save response', async () => {
    const write = deferred<Journey>();
    const external: JourneyStory = {
      ...story,
      journey: {
        ...story.journey,
        summary: '其他分頁更新的總文',
        updatedAt: '2024-05-04T00:00:01.000Z',
      },
    };
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(story)
      .mockResolvedValue(external);
    const updateJourney = vi.fn(() => write.promise);
    renderRoute(editorStub({ getPrivateJourneyStory, updateJourney }));
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '本機新標題' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);
    fireEvent.change(screen.getByLabelText('旅程總文（選填）'), { target: { value: '本機較新的總文' } });

    const response = {
      ...external.journey,
      title: '本機新標題',
      updatedAt: '2024-05-04T00:00:02.000Z',
    };
    await act(async () => { write.resolve(response); await write.promise; await flushMicrotasks(); });

    expect(screen.getByLabelText('旅程總文（選填）')).toHaveValue('本機較新的總文');
    expect(screen.getByRole('heading', { name: '本機新標題' })).toBeInTheDocument();
  });

  it('recovers the exact current owner record and leaves another owner untouched', async () => {
    const current = recoveryRecord(ownerA, 'Current owner pending title', 'generation-a');
    const independent = recoveryRecord(ownerB, 'Other owner pending title', 'generation-b');
    const outbox = outboxStub([current, independent]);

    renderRoute(editorStub(), '/studio/journeys/private-tokyo', outbox);

    expect(await screen.findByLabelText('旅程標題')).toHaveValue('Current owner pending title');
    expect(outbox.adopt).not.toHaveBeenCalled();
    expect(outbox.peek(story.journey.id, ownerB)).toEqual(independent);
  });

  it('adopts one legacy outbox record for the current reload owner', async () => {
    const legacy = recoveryRecord('legacy-v3', 'Migrated pending title', 'legacy-generation');
    const outbox = outboxStub([legacy]);

    renderRoute(editorStub(), '/studio/journeys/private-tokyo', outbox);

    expect(await screen.findByLabelText('旅程標題')).toHaveValue('Migrated pending title');
    expect(outbox.adopt).toHaveBeenCalledWith(
      story.journey.id,
      'legacy-v3',
      ownerA,
      legacy.generation,
    );
    expect(outbox.peek(story.journey.id, 'legacy-v3')).toBeUndefined();
    expect(outbox.peek(story.journey.id, ownerA)).toMatchObject({
      journeyId: story.journey.id,
      ownerId: ownerA,
      envelope: legacy.envelope,
    });
  });

  it('rotates before recovery without adopting the opener tab live outbox', async () => {
    const openerStorage = {
      getItem: vi.fn(() => ownerA),
      setItem: vi.fn(),
    };
    const openerClaim = await claimJourneyOutboxOwner({ locks: ownerLocks, storage: openerStorage });
    const pending = recoveryRecord(ownerA, 'Duplicated tab pending title', 'generation-a');
    const outbox = outboxStub([pending]);

    const view = renderRoute(editorStub(), '/studio/journeys/private-tokyo', outbox);

    expect(await screen.findByRole('heading', { name: '找到未儲存的旅程內容' })).toBeInTheDocument();
    expect(screen.getByText('另一個分頁可能仍在編輯這趟旅程。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '復原未儲存內容：版本 1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '忽略' })).toBeEnabled();
    const rotatedOwnerId = window.sessionStorage.getItem(ownerStorageKey)!;
    expect(rotatedOwnerId).not.toBe(ownerA);
    expect(outbox.adopt).not.toHaveBeenCalled();
    expect(outbox.peek(story.journey.id, ownerA)).toEqual(pending);
    expect(outbox.peek(story.journey.id, rotatedOwnerId)).toBeUndefined();
    expect(ownerLocks.isHeld(rotatedOwnerId)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '忽略' }));
    expect(screen.getByLabelText('旅程標題')).toHaveValue(story.journey.title);
    expect(outbox.adopt).not.toHaveBeenCalled();

    view.unmount();
    await act(flushMicrotasks);
    expect(ownerLocks.isHeld(rotatedOwnerId)).toBe(false);
    await openerClaim.release();
  });

  it('lets the user choose one abandoned version and retains every unselected owner', async () => {
    window.sessionStorage.setItem(ownerStorageKey, ownerC);
    const first = recoveryRecord(ownerA, 'Owner A pending title', 'generation-a');
    const second = recoveryRecord(ownerB, 'Owner B pending title', 'generation-b');
    const outbox = outboxStub([first, second]);

    renderRoute(editorStub(), '/studio/journeys/private-tokyo', outbox);

    expect(await screen.findByRole('heading', { name: '找到未儲存的旅程內容' })).toBeInTheDocument();
    expect(screen.queryByText('Owner A pending title')).not.toBeInTheDocument();
    expect(screen.queryByText('Owner B pending title')).not.toBeInTheDocument();
    const commands = screen.getAllByRole('button', { name: /復原未儲存內容：版本/ });
    expect(commands).toHaveLength(2);

    fireEvent.click(commands[1]);

    expect(await screen.findByLabelText('旅程標題')).toHaveValue('Owner B pending title');
    expect(outbox.peek(story.journey.id, ownerA)).toEqual(first);
    expect(outbox.peek(story.journey.id, ownerB)).toBeUndefined();
    expect(outbox.peek(story.journey.id, ownerC)).toMatchObject({
      ownerId: ownerC,
      generation: expect.any(String),
      envelope: second.envelope,
    });
    await waitFor(() => {
      expect(outbox.peek(story.journey.id, ownerC)?.generation).not.toBe(second.generation);
    });
    expect(outbox.adopt).toHaveBeenCalledWith(
      story.journey.id,
      ownerB,
      ownerC,
      second.generation,
    );
  });

  it('recovers the latest outbox envelope after a rejected bare-unmount flush', async () => {
    let rejectWrite = true;
    let persisted = story.journey;
    const getPrivateJourneyStory = vi.fn(async () => ({ ...story, journey: persisted }));
    const updateJourney = vi.fn(async (_id: string, patch: JourneyPatch) => {
      if (rejectWrite) throw new Error('storage unavailable');
      persisted = { ...persisted, ...patch, updatedAt: versionAfter(persisted.updatedAt) };
      return persisted;
    });
    const editor = editorStub({ getPrivateJourneyStory, updateJourney });
    const outbox = outboxStub();
    const firstView = renderRoute(editor, '/studio/journeys/private-tokyo', outbox);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '重新掛載後復原' } });
    await act(flushMicrotasks);
    expect(outbox.peek('private-tokyo')?.envelope.patch).toEqual({ title: '重新掛載後復原' });
    firstView.unmount();
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(1);
    expect(outbox.peek('private-tokyo')).toBeDefined();

    rejectWrite = false;
    renderRoute(editor, '/studio/journeys/private-tokyo', outbox);
    await act(flushMicrotasks);
    expect(screen.getByLabelText('旅程標題')).toHaveValue('重新掛載後復原');
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);

    expect(updateJourney).toHaveBeenCalledTimes(2);
    expect(updateJourney.mock.calls[1][1]).toEqual({ title: '重新掛載後復原' });
    expect(outbox.peek('private-tokyo')).toBeUndefined();
  });

  it('surfaces outbox persistence failure, keeps the unload guard, and retries before saving', async () => {
    const outbox = outboxStub();
    vi.mocked(outbox.put).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    const editor = editorStub();
    renderRoute(editor, '/studio/journeys/private-tokyo', outbox);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '保留在記憶體' } });
    await act(flushMicrotasks);

    expect(screen.getByText('儲存失敗')).toBeInTheDocument();
    expect(screen.getByText('自動儲存失敗')).toHaveAttribute('aria-live', 'assertive');
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(editor.updateJourney).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(flushMicrotasks);
    expect(outbox.put).toHaveBeenCalledTimes(2);
    expect(editor.updateJourney).toHaveBeenCalledWith(
      'private-tokyo',
      { title: '保留在記憶體' },
      { expectedUpdatedAt: story.journey.updatedAt },
    );
  });

  it('keeps one autosave owner and protects a newer generation across mobile guidance changes', async () => {
    const media = controllableMatchMedia(false);
    vi.stubGlobal('matchMedia', media.matchMedia);
    const firstWrite = deferred<Journey>();
    let persisted = story.journey;
    const getPrivateJourneyStory = vi.fn(async () => ({ ...story, journey: persisted }));
    const updateJourney = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementation(async (_id: string, patch: JourneyPatch) => {
        persisted = { ...persisted, ...patch, updatedAt: versionAfter(persisted.updatedAt) };
        return persisted;
      });
    const editor = editorStub({ getPrivateJourneyStory, updateJourney });
    const outbox = outboxStub();
    renderRoute(editor, '/studio/journeys/private-tokyo', outbox);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '第一個版本' } });
    await act(flushMicrotasks);
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);
    const firstGeneration = outbox.peek('private-tokyo')!.generation;
    const readsBeforeResponsiveChange = getPrivateJourneyStory.mock.calls.length;

    act(() => media.setMatches(true));
    expect(screen.getByRole('heading', { name: '請使用電腦整理旅程' })).toBeInTheDocument();
    act(() => media.setMatches(false));
    expect(screen.getByLabelText('旅程標題')).toHaveValue('第一個版本');
    expect(getPrivateJourneyStory).toHaveBeenCalledTimes(readsBeforeResponsiveChange);
    expect(outbox.peek('private-tokyo')?.generation).toBe(firstGeneration);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '響應式切換後的新版本' } });
    await act(flushMicrotasks);
    expect(outbox.peek('private-tokyo')?.generation).not.toBe(firstGeneration);

    persisted = {
      ...persisted,
      title: '第一個版本',
      updatedAt: versionAfter(persisted.updatedAt),
    };
    await act(async () => { firstWrite.resolve(persisted); await firstWrite.promise; await flushMicrotasks(); });
    expect(screen.getByLabelText('旅程標題')).toHaveValue('響應式切換後的新版本');
    expect(outbox.peek('private-tokyo')).toBeDefined();
    expect(outbox.peek('private-tokyo')?.generation).not.toBe(firstGeneration);

    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(2);
    expect(outbox.peek('private-tokyo')).toBeUndefined();
  });

  it('does not let an old editor instance clear a newer remount generation', async () => {
    const oldWrite = deferred<Journey>();
    let persisted = story.journey;
    const getPrivateJourneyStory = vi.fn(async () => ({ ...story, journey: persisted }));
    const updateJourney = vi.fn()
      .mockImplementationOnce(() => oldWrite.promise)
      .mockImplementation(async (_id: string, patch: JourneyPatch) => {
        persisted = { ...persisted, ...patch, updatedAt: versionAfter(persisted.updatedAt) };
        return persisted;
      });
    const editor = editorStub({ getPrivateJourneyStory, updateJourney });
    const outbox = outboxStub();
    const oldView = renderRoute(editor, '/studio/journeys/private-tokyo', outbox);
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '跨實例復原' } });
    await act(flushMicrotasks);
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);
    const oldGeneration = outbox.peek('private-tokyo')!.generation;
    oldView.unmount();

    renderRoute(editor, '/studio/journeys/private-tokyo', outbox);
    await act(flushMicrotasks);
    expect(screen.getByLabelText('旅程標題')).toHaveValue('跨實例復原');
    const remountOwnerId = window.sessionStorage.getItem(ownerStorageKey)!;
    expect(remountOwnerId).not.toBe(ownerA);
    const newerGeneration = outbox.peek('private-tokyo', remountOwnerId)!.generation;
    expect(newerGeneration).not.toBe(oldGeneration);

    persisted = {
      ...persisted,
      title: '跨實例復原',
      updatedAt: versionAfter(persisted.updatedAt),
    };
    await act(async () => { oldWrite.resolve(persisted); await oldWrite.promise; await flushMicrotasks(); });
    expect(outbox.peek('private-tokyo', remountOwnerId)?.generation).toBe(newerGeneration);

    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);
    expect(updateJourney).toHaveBeenCalledTimes(1);
    expect(outbox.peek('private-tokyo', remountOwnerId)).toBeUndefined();
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
    const journeyRegion = within(screen.getByRole('region', { name: '旅程資料' }));
    fireEvent.change(journeyRegion.getByLabelText('城市'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '新增城市' }));
    expect(editor.updateJourney).not.toHaveBeenCalled();
    fireEvent.change(journeyRegion.getByLabelText('城市'), { target: { value: '台北' } });
    fireEvent.click(screen.getByRole('button', { name: '新增城市' }));
    await waitFor(() => expect(editor.updateJourney).toHaveBeenCalledWith(
      'private-tokyo',
      { cityLabels: ['東京', '台北'] },
      expect.objectContaining({ expectedUpdatedAt: expect.any(String) }),
    ));
  });

  it('requires confirmation before deletion and selects the nearest remaining moment', async () => {
    const secondMoment = {
      ...story.moments[0],
      id: 'moment-2',
      songReferenceId: 'song-2',
      sortOrder: 1,
      song: { ...story.moments[0].song, id: 'song-2', title: 'Second Song' },
    };
    const thirdMoment = {
      ...story.moments[0],
      id: 'moment-3',
      songReferenceId: 'song-3',
      sortOrder: 2,
      song: { ...story.moments[0].song, id: 'song-3', title: 'Third Song' },
    };
    let currentStory = { ...story, moments: [story.moments[0], secondMoment, thirdMoment] };
    const getPrivateJourneyStory = vi.fn(async () => currentStory);
    const deleteMoment = vi.fn(async (id: string) => {
      currentStory = { ...currentStory, moments: currentStory.moments.filter((item) => item.id !== id) };
    });
    const editor = editorStub({ getPrivateJourneyStory, deleteMoment });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderRoute(editor);
    await screen.findByRole('heading', { name: '東京夜行' });

    const momentList = within(screen.getByRole('list', { name: '時刻排序' }));
    fireEvent.click(within(momentList.getAllByRole('listitem')[1]).getByRole('button', { name: /選取/ }));
    await waitFor(() => expect(screen.getByLabelText('歌名')).toHaveValue('Second Song'));
    fireEvent.click(screen.getByRole('button', { name: '刪除時刻' }));
    expect(confirm).toHaveBeenCalled();
    expect(deleteMoment).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '刪除時刻' }));
    await waitFor(() => expect(deleteMoment).toHaveBeenCalledWith('moment-2'));
    expect(screen.getByLabelText('歌名')).toHaveValue('Third Song');
    expect(momentList.getAllByRole('listitem').map((item) => item.dataset.id)).toEqual(['moment-1', 'moment-3']);
  });

  it('flushes a debounced moment edit before reorder persistence and keeps both changes after reload', async () => {
    const secondMoment = {
      ...story.moments[0],
      id: 'moment-2',
      photoUrl: '/second.jpg',
      photoAlt: 'Second moment',
      songReferenceId: 'song-2',
      sortOrder: 1,
      song: { ...story.moments[0].song, id: 'song-2', title: 'Second Song' },
    };
    let persistedStory: JourneyStory = {
      journey: { ...story.journey, cityLabels: [...story.journey.cityLabels] },
      moments: [
        { ...story.moments[0], song: { ...story.moments[0].song } },
        secondMoment,
      ],
    };
    const momentWrite = deferred();
    const reorderWrite = deferred();
    const operations: string[] = [];
    const snapshot = (): JourneyStory => ({
      journey: { ...persistedStory.journey, cityLabels: [...persistedStory.journey.cityLabels] },
      moments: persistedStory.moments.map((moment) => ({ ...moment, song: { ...moment.song } })),
    });
    const getPrivateJourneyStory = vi.fn(async (id: string) => (
      id === persistedStory.journey.id ? snapshot() : undefined
    ));
    const updateMoment = vi.fn(async (
      id: string,
      patch: MomentPatch,
      options?: UpdateMomentOptions,
    ): Promise<Moment> => {
      operations.push('moment:start');
      const current = persistedStory.moments.find((moment) => moment.id === id);
      if (!current) throw new Error(`Missing moment ${id}`);
      if (options?.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== current.updatedAt) {
        throw new MomentVersionConflictError(id, options.expectedUpdatedAt, current.updatedAt);
      }
      await momentWrite.promise;
      const { song: songPatch, ...momentPatch } = patch;
      const updated = {
        ...current,
        ...momentPatch,
        updatedAt: versionAfter(current.updatedAt),
        song: songPatch ? { ...current.song, ...songPatch } : current.song,
      };
      persistedStory = {
        journey: {
          ...persistedStory.journey,
          updatedAt: versionAfter(persistedStory.journey.updatedAt),
        },
        moments: persistedStory.moments.map((moment) => moment.id === id ? updated : moment),
      };
      operations.push('moment:commit');
      return updated;
    });
    const reorderMoments = vi.fn(async (journeyId: string, orderedIds: string[]) => {
      if (journeyId !== persistedStory.journey.id) throw new Error(`Missing journey ${journeyId}`);
      operations.push('reorder:start');
      await reorderWrite.promise;
      const momentsById = new Map(persistedStory.moments.map((moment) => [moment.id, moment]));
      persistedStory = {
        journey: {
          ...persistedStory.journey,
          updatedAt: versionAfter(persistedStory.journey.updatedAt),
        },
        moments: orderedIds.map((id, sortOrder) => {
          const moment = momentsById.get(id);
          if (!moment) throw new Error(`Missing moment ${id}`);
          return { ...moment, sortOrder, updatedAt: versionAfter(moment.updatedAt) };
        }),
      };
      operations.push('reorder:commit');
    });
    const editor = editorStub({ getPrivateJourneyStory, updateMoment, reorderMoments });
    const view = renderRoute(editor);
    await screen.findByRole('heading', { name: story.journey.title });
    vi.useFakeTimers();

    const nextCaption = 'Saved before reorder';
    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: nextCaption } });
    const momentList = screen.getByRole('list', { name: '時刻排序' });
    const selectedRow = momentList.querySelector<HTMLElement>('[data-moment-row][data-id="moment-1"]');
    const moveDown = selectedRow?.querySelector<HTMLButtonElement>('.moment-order-actions button:last-child');
    expect(moveDown).not.toBeNull();
    fireEvent.click(moveDown!);
    await act(flushMicrotasks);

    expect(momentList.querySelectorAll('[data-moment-row]')).toHaveLength(2);
    expect(within(momentList).getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      'moment-2',
      'moment-1',
    ]);
    expect(operations).toEqual(['moment:start']);
    expect(updateMoment).toHaveBeenCalledWith(
      'moment-1',
      { caption: nextCaption },
      { expectedUpdatedAt: story.moments[0].updatedAt },
    );
    expect(reorderMoments).not.toHaveBeenCalled();

    await act(async () => {
      momentWrite.resolve();
      await momentWrite.promise;
      await flushMicrotasks();
    });
    expect(operations).toEqual(['moment:start', 'moment:commit', 'reorder:start']);
    expect(reorderMoments).toHaveBeenCalledWith(story.journey.id, ['moment-2', 'moment-1']);

    await act(async () => {
      reorderWrite.resolve();
      await reorderWrite.promise;
      await flushMicrotasks();
    });
    expect(operations).toEqual(['moment:start', 'moment:commit', 'reorder:start', 'reorder:commit']);
    expect(within(momentList).getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      'moment-2',
      'moment-1',
    ]);
    expect(screen.getByLabelText('時刻文案')).toHaveValue(nextCaption);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重試儲存' })).not.toBeInTheDocument();
    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(reorderMoments).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(flushMicrotasks);
    renderRoute(editor);
    await act(flushMicrotasks);

    const reloadedList = screen.getByRole('list', { name: '時刻排序' });
    expect(within(reloadedList).getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      'moment-2',
      'moment-1',
    ]);
    fireEvent.click(reloadedList.querySelector<HTMLButtonElement>('[data-moment-select][data-id="moment-1"]')!);
    expect(screen.getByLabelText('時刻文案')).toHaveValue(nextCaption);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    vi.useRealTimers();
    fireEvent.click(screen.getByRole('link', { name: '整理' }));
    expect(await screen.findByRole('heading', { name: '整理旅程' })).toBeInTheDocument();
    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(reorderMoments).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected position aligned with the committed order when refresh returns stale ordering', async () => {
    const secondMoment = {
      ...story.moments[0],
      id: 'moment-2',
      songReferenceId: 'song-2',
      sortOrder: 1,
      song: { ...story.moments[0].song, id: 'song-2', title: 'Second Song' },
    };
    const staleStory = { ...story, moments: [story.moments[0], secondMoment] };
    const getPrivateJourneyStory = vi.fn(async () => staleStory);
    const reorderMoments = vi.fn(async () => undefined);
    renderRoute(editorStub({ getPrivateJourneyStory, reorderMoments }));
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    await waitFor(() => expect(getPrivateJourneyStory).toHaveBeenCalledTimes(2));

    const momentList = within(screen.getByRole('list', { name: '時刻排序' }));
    expect(momentList.getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      secondMoment.id,
      story.moments[0].id,
    ]);
    expect(screen.getByText('第 2 則')).toBeInTheDocument();
  });

  it('does not let an in-flight reorder refresh roll back a newer optimistic order', async () => {
    const firstRefresh = deferred<JourneyStory | undefined>();
    const secondWrite = deferred<void>();
    const secondMoment = {
      ...story.moments[0],
      id: 'moment-2',
      songReferenceId: 'song-2',
      sortOrder: 1,
      song: { ...story.moments[0].song, id: 'song-2', title: 'Second Song' },
    };
    const thirdMoment = {
      ...story.moments[0],
      id: 'moment-3',
      songReferenceId: 'song-3',
      sortOrder: 2,
      song: { ...story.moments[0].song, id: 'song-3', title: 'Third Song' },
    };
    const threeMomentStory = { ...story, moments: [story.moments[0], secondMoment, thirdMoment] };
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(threeMomentStory)
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockResolvedValue(threeMomentStory);
    const reorderMoments = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => secondWrite.promise);
    renderRoute(editorStub({ getPrivateJourneyStory, reorderMoments }));
    await screen.findByRole('heading', { name: story.journey.title });

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    await waitFor(() => expect(getPrivateJourneyStory).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: '將第三則上移' }));
    const momentList = within(screen.getByRole('list', { name: '時刻排序' }));
    expect(momentList.getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      secondMoment.id,
      thirdMoment.id,
      story.moments[0].id,
    ]);
    await waitFor(() => expect(screen.getByText('第 3 則')).toBeInTheDocument());

    await act(async () => {
      firstRefresh.resolve(threeMomentStory);
      await firstRefresh.promise;
      await flushMicrotasks();
    });
    expect(reorderMoments).toHaveBeenCalledTimes(2);
    expect(momentList.getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      secondMoment.id,
      thirdMoment.id,
      story.moments[0].id,
    ]);
    expect(screen.getByText('第 3 則')).toBeInTheDocument();

    await act(async () => {
      secondWrite.resolve();
      await secondWrite.promise;
      await flushMicrotasks();
    });
  });

  it('waits for an in-flight moment refresh before reordering without losing the committed draft', async () => {
    const olderRefresh = deferred<JourneyStory | undefined>();
    const secondMoment = {
      ...story.moments[0],
      id: 'moment-2',
      songReferenceId: 'song-2',
      sortOrder: 1,
      song: { ...story.moments[0].song, id: 'song-2', title: 'Second Song' },
    };
    const twoMomentStory = { ...story, moments: [story.moments[0], secondMoment] };
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(twoMomentStory)
      .mockImplementationOnce(() => olderRefresh.promise)
      .mockResolvedValue(twoMomentStory);
    const committedMoment = {
      ...story.moments[0],
      caption: '已提交的新文案',
      updatedAt: '2024-05-01T00:00:00.001Z',
    };
    const updateMoment = vi.fn(async () => committedMoment);
    const reorderMoments = vi.fn(async () => undefined);
    renderRoute(editorStub({ getPrivateJourneyStory, updateMoment, reorderMoments }));
    await screen.findByRole('heading', { name: '東京夜行' });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: committedMoment.caption } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });
    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(getPrivateJourneyStory).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    await act(flushMicrotasks);
    expect(reorderMoments).not.toHaveBeenCalled();
    expect(getPrivateJourneyStory).toHaveBeenCalledTimes(2);

    await act(async () => {
      olderRefresh.resolve(twoMomentStory);
      await olderRefresh.promise;
      await flushMicrotasks();
    });
    expect(reorderMoments).toHaveBeenCalledTimes(1);
    expect(getPrivateJourneyStory).toHaveBeenCalledTimes(3);

    const momentList = within(screen.getByRole('list', { name: '時刻排序' }));
    expect(momentList.getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      secondMoment.id,
      story.moments[0].id,
    ]);
    expect(screen.getByText('第 2 則')).toBeInTheDocument();
    expect(screen.getByLabelText('時刻文案')).toHaveValue(committedMoment.caption);
  });

  it('keeps the first committed upload visible and selected when its story refresh fails', async () => {
    const created: Moment = {
      id: 'moment-uploaded',
      journeyId: story.journey.id,
      photoAssetId: 'photo-uploaded',
      photoAlt: '新時刻.jpg',
      songReferenceId: 'song-uploaded',
      localDate: story.journey.startDate,
      cityLabel: story.journey.cityLabels[0],
      placeLabel: '',
      caption: '',
      reason: '',
      reasonStatus: 'needs_review',
      sortOrder: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const getPrivateJourneyStory = vi.fn()
      .mockResolvedValueOnce(story)
      .mockRejectedValueOnce(new Error('refresh failed'));
    const addMoments = vi.fn(async () => [created]);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 100,
      height: 80,
      close: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['normalized'], { type: 'image/webp' }));
    });
    renderRoute(editorStub({ getPrivateJourneyStory, addMoments }));
    await screen.findByRole('heading', { name: '東京夜行' });

    fireEvent.change(screen.getByLabelText('加入照片'), {
      target: { files: [new File(['photo'], '新時刻.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByText('照片已加入但重新載入失敗。')).toBeInTheDocument();
    expect(addMoments).toHaveBeenCalledTimes(1);
    const momentList = within(screen.getByRole('list', { name: '時刻排序' }));
    expect(momentList.getAllByRole('listitem').map((item) => item.dataset.id)).toEqual([
      story.moments[0].id,
      created.id,
    ]);
    expect(screen.getByText('第 2 則')).toBeInTheDocument();
    expect(screen.getByLabelText('歌名')).toHaveValue('');
  });

  it('defines the exact wide grid and stacks preview above the form on narrow desktop', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/styles/global.css', 'utf8');
    document.head.append(style);

    try {
      const rules = style.sheet!.cssRules;
      const desktop = findMediaRule(rules, '(min-width: 1040px)');
      expect(findStyleRule(desktop!.cssRules, '.journey-editor-workspace')?.style.getPropertyValue(
        'grid-template-columns',
      )).toBe('minmax(220px, 0.7fr) minmax(320px, 1.2fr) minmax(300px, 0.9fr)');

      const tablet = findMediaRule(rules, '(min-width: 641px) and (max-width: 1039px)');
      expect(findStyleRule(tablet!.cssRules, '.journey-editor-workspace')?.style.getPropertyValue(
        'grid-template-areas',
      )).toBe('"list preview" "list details"');
    } finally {
      style.remove();
    }
  });

  it('keeps conflict actions and the editor header contained across desktop and tablet CSS', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/styles/global.css', 'utf8');
    document.head.append(style);

    try {
      const rules = style.sheet!.cssRules;
      const saveStatus = findStyleRule(rules, '.journey-save-status');
      const saveActions = findStyleRule(rules, '.journey-save-actions');
      const title = findStyleRule(rules, '.journey-editor-header h1');
      expect(saveStatus?.style.getPropertyValue('flex')).toBe('0 0 168px');
      expect(saveStatus?.style.getPropertyValue('width')).toBe('168px');
      expect(saveStatus?.style.getPropertyValue('flex-wrap')).toBe('wrap');
      expect(saveStatus?.style.getPropertyValue('row-gap')).toBe('4px');
      expect(saveActions?.style.getPropertyValue('display')).toBe('flex');
      expect(saveActions?.style.getPropertyValue('gap')).toBe('4px');
      expect(saveActions?.style.getPropertyValue('justify-content')).toBe('flex-end');
      expect(title?.style.getPropertyValue('overflow')).toBe('hidden');
      expect(title?.style.getPropertyValue('text-overflow')).toBe('ellipsis');
      expect(title?.style.getPropertyValue('white-space')).toBe('nowrap');

      const tablet = findMediaRule(rules, '(min-width: 641px) and (max-width: 1039px)');
      expect(findStyleRule(tablet!.cssRules, '.journey-editor-header')?.style.getPropertyValue('gap')).toBe('16px');
      expect(findStyleRule(tablet!.cssRules, '.journey-editor-meta')?.style.getPropertyValue('gap')).toBe('10px');
    } finally {
      style.remove();
    }
  });

  it('shows only desktop guidance on mobile', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    renderRoute();
    expect(document.querySelector('main')?.textContent).toBe('請使用電腦整理旅程');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
