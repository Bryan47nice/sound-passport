import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MomentVersionConflictError, type UpdateMomentOptions } from '../../data/ports';
import type { JourneyMoment, MomentPatch } from '../../domain/model';
import { MomentEditor } from './MomentEditor';

const moment: JourneyMoment = {
  id: 'moment-1',
  journeyId: 'journey-1',
  photoAssetId: 'photo-1',
  photoAlt: '台北夜景',
  songReferenceId: 'song-1',
  localDate: '2026-07-13',
  localTime: '21:30',
  cityLabel: '台北',
  placeLabel: '中山站',
  caption: '原本的時刻文案',
  reason: '原本的選歌原因',
  reasonStatus: 'complete',
  sortOrder: 0,
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  song: {
    id: 'song-1',
    provider: 'manual',
    title: '原本歌名',
    artist: '原本歌手',
    availability: 'needs_link',
  },
};

function storyWithMoment(storyMoment: JourneyMoment) {
  return {
    journey: {
      id: 'journey-1',
      title: '台北聲音旅程',
      countryCode: 'TW',
      countryName: '臺灣',
      countryCoordinates: [121.5654, 25.033] as [number, number],
      cityLabels: ['台北'],
      startDate: '2026-07-13',
      endDate: '2026-07-15',
      summary: '',
      status: 'draft' as const,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: storyMoment.updatedAt,
      source: 'private' as const,
    },
    moments: [storyMoment],
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderEditor(
  updateMoment = vi.fn(async (
    _id: string,
    _patch: MomentPatch,
    _options?: UpdateMomentOptions,
  ) => moment),
  onSaved?: () => void | Promise<void>,
  options: {
    getPrivateJourneyStory?: () => Promise<ReturnType<typeof storyWithMoment> | undefined>;
    recovery?: object;
    recoveryOwnerId?: string;
  } = {},
) {
  const onMomentChange = vi.fn();
  const onDelete = vi.fn(async () => undefined);
  const props = {
    moment,
    position: 1,
    repository: {
      updateMoment,
      getPrivateJourneyStory: options.getPrivateJourneyStory ?? vi.fn(async () => storyWithMoment(moment)),
    },
    onMomentChange,
    onDelete,
    onSaved,
    recovery: options.recovery,
    recoveryOwnerId: options.recoveryOwnerId,
  };
  const view = render(<MomentEditor {...(props as any)} />);
  const rerenderMoment = (nextMoment: JourneyMoment) => view.rerender(
    <MomentEditor {...({ ...props, moment: nextMoment } as any)} />,
  );
  return { onDelete, onMomentChange, rerenderMoment, updateMoment, view };
}

describe('MomentEditor', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps caption and reason separate while marking only completion requirements as required', () => {
    renderEditor();

    expect(screen.getByLabelText('時刻文案')).toHaveValue('原本的時刻文案');
    expect(screen.getByLabelText('選歌原因')).toHaveValue('原本的選歌原因');
    expect(screen.getByLabelText('日期')).toBeRequired();
    expect(screen.getByLabelText('歌名')).toBeRequired();
    expect(screen.getByLabelText('歌手')).toBeRequired();
    expect(screen.getByLabelText('YouTube 連結')).not.toBeRequired();
    expect(screen.getByLabelText('時刻文案')).not.toBeRequired();
    expect(screen.getByLabelText('選歌原因')).not.toBeRequired();
  });

  it('debounces text for 500ms and preserves every field when YouTube is invalid', async () => {
    vi.useFakeTimers();
    const { updateMoment } = renderEditor();
    const youtubeInput = screen.getByLabelText('YouTube 連結');
    const validUrl = 'https://www.youtube.com/watch?v=M7lc1UVf-VE';
    const invalidUrl = 'https://example.com/not-youtube';

    expect(youtubeInput).toHaveAttribute('data-link-state', 'needs_link');
    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '新的時刻文案' } });
    fireEvent.change(screen.getByLabelText('選歌原因'), { target: { value: '新的選歌原因' } });
    fireEvent.change(screen.getByLabelText('歌名'), { target: { value: '新的歌名' } });
    fireEvent.change(screen.getByLabelText('歌手'), { target: { value: '新的歌手' } });
    fireEvent.change(youtubeInput, { target: { value: validUrl } });
    expect(youtubeInput).toHaveAttribute('data-link-state', 'available');
    fireEvent.change(youtubeInput, { target: { value: invalidUrl } });

    expect(screen.getByText('連結格式不正確')).toBeInTheDocument();
    expect(youtubeInput).toHaveAttribute('data-link-state', 'invalid_link');
    expect(screen.getByText('連結格式不正確')).toHaveAttribute('data-link-state', 'invalid_link');
    expect(screen.getByLabelText('時刻文案')).toHaveValue('新的時刻文案');
    expect(screen.getByLabelText('選歌原因')).toHaveValue('新的選歌原因');
    expect(screen.getByLabelText('歌名')).toHaveValue('新的歌名');
    expect(screen.getByLabelText('歌手')).toHaveValue('新的歌手');
    expect(updateMoment).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(updateMoment).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
    });

    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(updateMoment).toHaveBeenCalledWith(
      'moment-1',
      {
        caption: '新的時刻文案',
        reason: '新的選歌原因',
        reasonStatus: 'complete',
        song: {
          title: '新的歌名',
          artist: '新的歌手',
          sourceUrl: invalidUrl,
        },
      },
      { expectedUpdatedAt: moment.updatedAt },
    );
  });

  it('persists date and optional time changes immediately', async () => {
    const { updateMoment } = renderEditor();

    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-07-14' } });
    await act(flushMicrotasks);
    expect(updateMoment).toHaveBeenCalledWith(
      'moment-1',
      { localDate: '2026-07-14' },
      { expectedUpdatedAt: moment.updatedAt },
    );

    fireEvent.change(screen.getByLabelText('時間'), { target: { value: '' } });
    await act(flushMicrotasks);
    expect(updateMoment).toHaveBeenLastCalledWith(
      'moment-1',
      { localTime: undefined },
      { expectedUpdatedAt: moment.updatedAt },
    );
  });

  it('advances the accepted version across serialized saves without replacing a newer local field', async () => {
    vi.useFakeTimers();
    const firstWrite = deferred<JourneyMoment>();
    const refresh = deferred<void>();
    const firstCommitted = {
      ...moment,
      caption: '第一版文案',
      updatedAt: '2026-07-13T00:00:00.001Z',
    };
    const secondCommitted = {
      ...firstCommitted,
      reason: '更新中的選歌原因',
      updatedAt: '2026-07-13T00:00:00.002Z',
    };
    const updateMoment = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(secondCommitted);
    const onSaved = vi.fn()
      .mockImplementationOnce(() => refresh.promise)
      .mockResolvedValueOnce(undefined);
    const { rerenderMoment } = renderEditor(updateMoment, onSaved);

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '第一版文案' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(updateMoment).toHaveBeenNthCalledWith(
      1,
      moment.id,
      { caption: '第一版文案' },
      { expectedUpdatedAt: moment.updatedAt },
    );

    fireEvent.change(screen.getByLabelText('選歌原因'), { target: { value: '更新中的選歌原因' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(updateMoment).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstWrite.resolve(firstCommitted);
      await firstWrite.promise;
      await flushMicrotasks();
    });
    rerenderMoment({ ...firstCommitted, reason: moment.reason });
    expect(screen.getByLabelText('選歌原因')).toHaveValue('更新中的選歌原因');

    await act(async () => {
      refresh.resolve();
      await refresh.promise;
      await flushMicrotasks();
    });
    await act(flushMicrotasks);
    expect(updateMoment).toHaveBeenCalledTimes(2);
    expect(updateMoment).toHaveBeenNthCalledWith(
      2,
      moment.id,
      { reason: '更新中的選歌原因', reasonStatus: 'complete' },
      { expectedUpdatedAt: firstCommitted.updatedAt },
    );
  });

  it('treats a committed save as successful when refresh fails and retries refresh only', async () => {
    vi.useFakeTimers();
    const committed = {
      ...moment,
      caption: '已提交文案',
      updatedAt: '2026-07-13T00:00:00.001Z',
    };
    const updateMoment = vi.fn(async () => committed);
    const onSaved = vi.fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(undefined);
    renderEditor(updateMoment, onSaved);

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '已提交文案' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(screen.getByText('時刻已儲存，但重新載入失敗。')).toBeInTheDocument();
    expect(screen.getByText('時刻已儲存')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    await act(flushMicrotasks);

    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('時刻已儲存，但重新載入失敗。')).not.toBeInTheDocument();
  });

  it('auto-rebases a non-overlapping remote edit and retries with the fresh version', async () => {
    vi.useFakeTimers();
    const actualUpdatedAt = '2026-07-13T00:00:00.010Z';
    const remote = { ...moment, cityLabel: '新北', updatedAt: actualUpdatedAt };
    const committed = {
      ...remote,
      caption: '本機文案',
      updatedAt: '2026-07-13T00:00:00.011Z',
    };
    const updateMoment = vi.fn()
      .mockRejectedValueOnce(new MomentVersionConflictError(moment.id, moment.updatedAt, actualUpdatedAt))
      .mockResolvedValueOnce(committed);
    const getPrivateJourneyStory = vi.fn(async () => storyWithMoment(remote));
    renderEditor(updateMoment, undefined, { getPrivateJourneyStory });

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '本機文案' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(getPrivateJourneyStory).toHaveBeenCalledWith(moment.journeyId);
    expect(updateMoment).toHaveBeenCalledTimes(2);
    expect(updateMoment).toHaveBeenNthCalledWith(
      2,
      moment.id,
      { caption: '本機文案' },
      { expectedUpdatedAt: actualUpdatedAt },
    );
    expect(screen.getByLabelText('城市')).toHaveValue('新北');
    expect(screen.getByLabelText('時刻文案')).toHaveValue('本機文案');
    expect(screen.queryByText('時刻內容已在其他位置更新，本機草稿尚未覆寫。')).not.toBeInTheDocument();
  });

  it('offers overwrite and discard choices for a same-field conflict', async () => {
    vi.useFakeTimers();
    const actualUpdatedAt = '2026-07-13T00:00:00.010Z';
    const remote = { ...moment, caption: '遠端文案', updatedAt: actualUpdatedAt };
    const committed = {
      ...remote,
      caption: '本機衝突文案',
      updatedAt: '2026-07-13T00:00:00.011Z',
    };
    const updateMoment = vi.fn()
      .mockRejectedValueOnce(new MomentVersionConflictError(moment.id, moment.updatedAt, actualUpdatedAt))
      .mockResolvedValueOnce(committed);
    const getPrivateJourneyStory = vi.fn(async () => storyWithMoment(remote));
    renderEditor(updateMoment, undefined, { getPrivateJourneyStory });

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '本機衝突文案' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(screen.getByText('時刻內容已在其他位置更新，本機草稿尚未覆寫。')).toBeInTheDocument();
    expect(screen.getByLabelText('時刻文案')).toHaveValue('本機衝突文案');
    expect(screen.getByRole('button', { name: '覆寫遠端內容' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '捨棄並重新載入' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '覆寫遠端內容' }));
    await act(flushMicrotasks);
    expect(updateMoment).toHaveBeenCalledTimes(2);
    expect(updateMoment).toHaveBeenLastCalledWith(
      moment.id,
      { caption: '本機衝突文案' },
      { expectedUpdatedAt: actualUpdatedAt },
    );
    expect(screen.queryByText('時刻內容已在其他位置更新，本機草稿尚未覆寫。')).not.toBeInTheDocument();
  });

  it('discards a same-field conflict only after deleting its durable recovery', async () => {
    vi.useFakeTimers();
    const actualUpdatedAt = '2026-07-13T00:00:00.010Z';
    const remote = { ...moment, caption: '遠端保留文案', updatedAt: actualUpdatedAt };
    let stored: any;
    const recovery = {
      getMomentOutbox: vi.fn(async () => stored),
      putMomentOutbox: vi.fn(async (record: any) => { stored = record; }),
      compareAndDeleteMomentOutbox: vi.fn(async (_momentId: string, _ownerId: string, generation: string) => {
        if (stored?.generation !== generation) return false;
        stored = undefined;
        return true;
      }),
    };
    const updateMoment = vi.fn().mockRejectedValue(
      new MomentVersionConflictError(moment.id, moment.updatedAt, actualUpdatedAt),
    );
    renderEditor(updateMoment, undefined, {
      getPrivateJourneyStory: vi.fn(async () => storyWithMoment(remote)),
      recovery,
      recoveryOwnerId: 'owner-a',
    });

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '本機待捨棄文案' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });
    fireEvent.click(screen.getByRole('button', { name: '捨棄並重新載入' }));
    await act(flushMicrotasks);

    expect(recovery.compareAndDeleteMomentOutbox).toHaveBeenCalledWith(
      moment.id,
      'owner-a',
      expect.any(String),
    );
    expect(screen.getByLabelText('時刻文案')).toHaveValue('遠端保留文案');
    expect(stored).toBeUndefined();
  });

  it('restores an unsaved moment envelope after reload', async () => {
    vi.useFakeTimers();
    let stored: any;
    const recovery = {
      getMomentOutbox: vi.fn(async () => stored),
      putMomentOutbox: vi.fn(async (record: any) => { stored = record; }),
      compareAndDeleteMomentOutbox: vi.fn(async () => false),
    };
    const never = deferred<JourneyMoment>();
    const updateMoment = vi.fn(() => never.promise);
    const first = renderEditor(updateMoment, undefined, {
      recovery,
      recoveryOwnerId: 'owner-a',
    });

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '重新載入後仍要保留' } });
    await act(flushMicrotasks);
    expect(recovery.putMomentOutbox).toHaveBeenCalled();
    expect(stored).toMatchObject({
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: 'owner-a',
      envelope: {
        patch: { caption: '重新載入後仍要保留' },
        base: { caption: moment.caption },
      },
    });

    first.view.unmount();
    renderEditor(updateMoment, undefined, {
      recovery,
      recoveryOwnerId: 'owner-a',
    });

    await act(flushMicrotasks);
    expect(screen.getByLabelText('時刻文案')).toHaveValue('重新載入後仍要保留');
  });
});
