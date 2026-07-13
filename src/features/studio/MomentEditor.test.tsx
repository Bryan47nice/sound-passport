import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MomentVersionConflictError, type UpdateMomentOptions } from '../../data/ports';
import { STORAGE_CAPACITY_GUIDANCE, StorageCapacityError } from '../../data/storageErrors';
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
    recoveryClaimOwner?: (ownerId: string) => Promise<{ ownerId: string; release(): Promise<void> } | undefined>;
    recoveryOwnerId?: string;
    strict?: boolean;
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
    recoveryClaimOwner: options.recoveryClaimOwner,
    recoveryOwnerId: options.recoveryOwnerId,
  };
  const editor = <MomentEditor {...(props as any)} />;
  const view = render(options.strict ? <StrictMode>{editor}</StrictMode> : editor);
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

  it('shows centralized backup and deletion guidance when moment storage is full', async () => {
    vi.useFakeTimers();
    const updateMoment = vi.fn(async () => {
      throw new StorageCapacityError(new DOMException('quota', 'QuotaExceededError'));
    });
    renderEditor(updateMoment);

    fireEvent.change(screen.getByLabelText('時刻文案'), {
      target: { value: '需要保留的本機文案' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(updateMoment).toHaveBeenCalledOnce();
    expect(screen.getByText('時刻儲存失敗').closest('.moment-save-status')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(STORAGE_CAPACITY_GUIDANCE);
    expect(screen.getByRole('button', { name: '重試儲存' })).toBeInTheDocument();
  });

  it('keeps generic moment save failures concise while retaining retry', async () => {
    vi.useFakeTimers();
    const updateMoment = vi.fn(async () => {
      throw new Error('offline');
    });
    renderEditor(updateMoment);

    fireEvent.change(screen.getByLabelText('時刻文案'), {
      target: { value: '尚未送出的文案' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(screen.getByText('時刻儲存失敗')).toBeInTheDocument();
    expect(screen.queryByText(STORAGE_CAPACITY_GUIDANCE)).not.toBeInTheDocument();
    expect(screen.queryByText('自動儲存失敗')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重試儲存' })).toBeInTheDocument();
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
      listMomentOutboxesByJourney: vi.fn(async () => []),
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

    await act(flushMicrotasks);
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
      listMomentOutboxesByJourney: vi.fn(async () => []),
      putMomentOutbox: vi.fn(async (record: any) => { stored = record; }),
      compareAndDeleteMomentOutbox: vi.fn(async () => false),
    };
    const never = deferred<JourneyMoment>();
    const updateMoment = vi.fn(() => never.promise);
    const first = renderEditor(updateMoment, undefined, {
      recovery,
      recoveryOwnerId: 'owner-a',
    });

    await act(flushMicrotasks);
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

  it('does not write a stale same-field recovered patch before an explicit overwrite choice', async () => {
    vi.useFakeTimers();
    const remote = {
      ...moment,
      caption: '其他位置已儲存的文案',
      updatedAt: '2026-07-13T00:00:00.010Z',
    };
    const recovered = {
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: 'owner-a',
      generation: 'recovered-generation',
      envelope: {
        patch: { caption: '重新開啟後的本機文案' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:00.005Z',
    };
    const committed = {
      ...remote,
      caption: recovered.envelope.patch.caption,
      updatedAt: '2026-07-13T00:00:00.011Z',
    };
    const updateMoment = vi.fn(async () => committed);
    const recovery = {
      getMomentOutbox: vi.fn(async () => recovered),
      listMomentOutboxesByJourney: vi.fn(async () => []),
      adoptMomentOutbox: vi.fn(),
      putMomentOutbox: vi.fn(async () => undefined),
      compareAndDeleteMomentOutbox: vi.fn(async () => true),
    };
    renderEditor(updateMoment, undefined, {
      getPrivateJourneyStory: vi.fn(async () => storyWithMoment(remote)),
      recovery,
      recoveryOwnerId: recovered.ownerId,
    });

    await act(flushMicrotasks);
    expect(screen.getByLabelText('時刻文案')).toHaveValue('重新開啟後的本機文案');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(updateMoment).not.toHaveBeenCalled();
    expect(screen.getByText('時刻內容已在其他位置更新，本機草稿尚未覆寫。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '覆寫遠端內容' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '捨棄並重新載入' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '覆寫遠端內容' }));
    await act(flushMicrotasks);

    expect(updateMoment).toHaveBeenCalledOnce();
    expect(updateMoment).toHaveBeenCalledWith(
      moment.id,
      recovered.envelope.patch,
      { expectedUpdatedAt: remote.updatedAt },
    );
  });

  it('rebases recovered fields onto the latest moment and auto-merges only non-overlapping changes', async () => {
    vi.useFakeTimers();
    const remote = {
      ...moment,
      cityLabel: '新北',
      updatedAt: '2026-07-13T00:00:00.010Z',
    };
    const recovered = {
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: 'owner-a',
      generation: 'non-overlap-generation',
      envelope: {
        patch: { caption: '本機保留文案' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:00.005Z',
    };
    const updateMoment = vi.fn(async () => ({
      ...remote,
      caption: recovered.envelope.patch.caption,
      updatedAt: '2026-07-13T00:00:00.011Z',
    }));
    const recovery = {
      getMomentOutbox: vi.fn(async () => recovered),
      listMomentOutboxesByJourney: vi.fn(async () => []),
      adoptMomentOutbox: vi.fn(),
      putMomentOutbox: vi.fn(async () => undefined),
      compareAndDeleteMomentOutbox: vi.fn(async () => true),
    };
    renderEditor(updateMoment, undefined, {
      getPrivateJourneyStory: vi.fn(async () => storyWithMoment(remote)),
      recovery,
      recoveryOwnerId: recovered.ownerId,
    });

    await act(flushMicrotasks);

    expect(screen.getByLabelText('城市')).toHaveValue('新北');
    expect(screen.getByLabelText('時刻文案')).toHaveValue('本機保留文案');
    expect(updateMoment).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(updateMoment).toHaveBeenCalledWith(
      moment.id,
      recovered.envelope.patch,
      { expectedUpdatedAt: remote.updatedAt },
    );
  });

  it('shows a no-lock recovery prompt and performs zero writes before a choice', async () => {
    const pending = {
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: '11111111-1111-4111-8111-111111111111',
      generation: 'pending-generation',
      envelope: {
        patch: { caption: '另一個分頁的未儲存文案' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:00.005Z',
    };
    const recovery = {
      getMomentOutbox: vi.fn(async () => undefined),
      listMomentOutboxesByJourney: vi.fn(async () => [pending]),
      adoptMomentOutbox: vi.fn(async () => ({ ...pending, ownerId: 'owner-current' })),
      putMomentOutbox: vi.fn(async () => undefined),
      compareAndDeleteMomentOutbox: vi.fn(async () => true),
    };
    const updateMoment = vi.fn(async () => moment);
    const { onMomentChange } = renderEditor(updateMoment, undefined, {
      recovery,
      recoveryClaimOwner: vi.fn(async () => undefined),
      recoveryOwnerId: 'owner-current',
    });

    await act(flushMicrotasks);

    expect(screen.getByRole('heading', { name: '找到未儲存的時刻內容' })).toBeInTheDocument();
    expect(screen.getByText('另一個分頁可能仍在編輯這則時刻。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '復原未儲存內容' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '忽略' })).toBeEnabled();
    expect(screen.queryByLabelText('時刻文案')).not.toBeInTheDocument();
    expect(recovery.adoptMomentOutbox).not.toHaveBeenCalled();
    expect(recovery.putMomentOutbox).not.toHaveBeenCalled();
    expect(recovery.compareAndDeleteMomentOutbox).not.toHaveBeenCalled();
    expect(updateMoment).not.toHaveBeenCalled();
    expect(onMomentChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '忽略' }));
    expect(screen.getByLabelText('時刻文案')).toHaveValue(moment.caption);
    expect(recovery.adoptMomentOutbox).not.toHaveBeenCalled();
    expect(recovery.putMomentOutbox).not.toHaveBeenCalled();
  });

  it('adopts an explicitly recovered no-lock candidate exactly once under StrictMode', async () => {
    const currentOwner = '33333333-3333-4333-8333-333333333333';
    let stored = {
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: '11111111-1111-4111-8111-111111111111',
      generation: 'abandoned-generation',
      envelope: {
        patch: { caption: '確認後找回的文案' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:00.005Z',
    };
    const recovery = {
      getMomentOutbox: vi.fn(async (_momentId: string, ownerId: string) => (
        stored.ownerId === ownerId ? stored : undefined
      )),
      listMomentOutboxesByJourney: vi.fn(async () => [stored]),
      adoptMomentOutbox: vi.fn(async (
        _momentId: string,
        _journeyId: string,
        fromOwnerId: string,
        toOwnerId: string,
        generation: string,
      ) => {
        if (stored.ownerId !== fromOwnerId || stored.generation !== generation) return undefined;
        stored = { ...stored, ownerId: toOwnerId };
        return stored;
      }),
      putMomentOutbox: vi.fn(async () => undefined),
      compareAndDeleteMomentOutbox: vi.fn(async () => true),
    };
    const { onMomentChange } = renderEditor(vi.fn(async () => moment), undefined, {
      recovery,
      recoveryClaimOwner: vi.fn(async () => undefined),
      recoveryOwnerId: currentOwner,
      strict: true,
    });

    await act(flushMicrotasks);
    fireEvent.click(screen.getByRole('button', { name: '復原未儲存內容' }));
    await act(flushMicrotasks);

    expect(screen.getByLabelText('時刻文案')).toHaveValue('確認後找回的文案');
    expect(recovery.listMomentOutboxesByJourney).toHaveBeenCalledOnce();
    expect(recovery.adoptMomentOutbox).toHaveBeenCalledOnce();
    expect(recovery.adoptMomentOutbox).toHaveBeenCalledWith(
      moment.id,
      moment.journeyId,
      '11111111-1111-4111-8111-111111111111',
      currentOwner,
      'abandoned-generation',
    );
    expect(onMomentChange).toHaveBeenCalledOnce();
  });

  it('requires deterministic explicit selection when several recovery candidates exist', async () => {
    const older = {
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: '11111111-1111-4111-8111-111111111111',
      generation: 'older-generation',
      envelope: {
        patch: { caption: '較舊版本' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:00.005Z',
    };
    const newer = {
      ...older,
      ownerId: '22222222-2222-4222-8222-222222222222',
      generation: 'newer-generation',
      envelope: {
        patch: { caption: '較新版本' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:01.005Z',
    };
    const recovery = {
      getMomentOutbox: vi.fn(async () => undefined),
      listMomentOutboxesByJourney: vi.fn(async () => [older, newer]),
      adoptMomentOutbox: vi.fn(async (
        _momentId: string,
        _journeyId: string,
        fromOwnerId: string,
        toOwnerId: string,
      ) => ({ ...(fromOwnerId === older.ownerId ? older : newer), ownerId: toOwnerId })),
      putMomentOutbox: vi.fn(async () => undefined),
      compareAndDeleteMomentOutbox: vi.fn(async () => true),
    };
    renderEditor(vi.fn(async () => moment), undefined, {
      recovery,
      recoveryClaimOwner: vi.fn(async () => undefined),
      recoveryOwnerId: 'owner-current',
    });

    await act(flushMicrotasks);
    const recover = screen.getByRole('button', { name: '復原未儲存內容' });
    expect(recover).toBeDisabled();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText(older.ownerId)).not.toBeInTheDocument();
    expect(screen.queryByText(newer.ownerId)).not.toBeInTheDocument();
    expect(recovery.adoptMomentOutbox).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: '選擇復原版本 2' }));
    expect(recover).toBeEnabled();
    expect(recovery.adoptMomentOutbox).not.toHaveBeenCalled();
    fireEvent.click(recover);
    await act(flushMicrotasks);

    expect(screen.getByLabelText('時刻文案')).toHaveValue('較舊版本');
    expect(recovery.adoptMomentOutbox).toHaveBeenCalledOnce();
    expect(recovery.adoptMomentOutbox).toHaveBeenCalledWith(
      moment.id,
      moment.journeyId,
      older.ownerId,
      'owner-current',
      older.generation,
    );
  });

  it('reloads saved content without writing when a competing recovery adopter wins', async () => {
    const pending = {
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: '11111111-1111-4111-8111-111111111111',
      generation: 'lost-generation',
      envelope: {
        patch: { caption: '競爭中的未儲存文案' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:00.005Z',
    };
    const remote = {
      ...moment,
      caption: '其他分頁已儲存的最新文案',
      updatedAt: '2026-07-13T00:00:01.000Z',
    };
    const recovery = {
      getMomentOutbox: vi.fn(async () => undefined),
      listMomentOutboxesByJourney: vi.fn(async () => [pending]),
      adoptMomentOutbox: vi.fn(async () => undefined),
      putMomentOutbox: vi.fn(async () => undefined),
      compareAndDeleteMomentOutbox: vi.fn(async () => true),
    };
    const updateMoment = vi.fn(async () => remote);
    renderEditor(updateMoment, undefined, {
      getPrivateJourneyStory: vi.fn(async () => storyWithMoment(remote)),
      recovery,
      recoveryClaimOwner: vi.fn(async () => undefined),
      recoveryOwnerId: 'owner-current',
    });

    await act(flushMicrotasks);
    fireEvent.click(screen.getByRole('button', { name: '復原未儲存內容' }));
    await act(flushMicrotasks);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '未儲存內容已由其他分頁處理，已重新載入最新儲存內容。',
    );
    expect(screen.getByLabelText('時刻文案')).toHaveValue(remote.caption);
    expect(recovery.adoptMomentOutbox).toHaveBeenCalledOnce();
    expect(recovery.putMomentOutbox).not.toHaveBeenCalled();
    expect(recovery.compareAndDeleteMomentOutbox).not.toHaveBeenCalled();
    expect(updateMoment).not.toHaveBeenCalled();
  });

  it('keeps an adopted recovery protected when refreshing its saved base fails', async () => {
    const pending = {
      momentId: moment.id,
      journeyId: moment.journeyId,
      ownerId: '11111111-1111-4111-8111-111111111111',
      generation: 'protected-generation',
      envelope: {
        patch: { caption: '仍需保護的未儲存文案' },
        base: { caption: moment.caption },
      },
      updatedAt: '2026-07-13T00:00:00.005Z',
    };
    const recovery = {
      getMomentOutbox: vi.fn(async () => undefined),
      listMomentOutboxesByJourney: vi.fn(async () => [pending]),
      adoptMomentOutbox: vi.fn(async () => ({ ...pending, ownerId: 'owner-current' })),
      putMomentOutbox: vi.fn(async () => undefined),
      compareAndDeleteMomentOutbox: vi.fn(async () => true),
    };
    const updateMoment = vi.fn(async () => moment);
    renderEditor(updateMoment, undefined, {
      getPrivateJourneyStory: vi.fn(async () => undefined),
      recovery,
      recoveryClaimOwner: vi.fn(async () => undefined),
      recoveryOwnerId: 'owner-current',
    });

    await act(flushMicrotasks);
    fireEvent.click(screen.getByRole('button', { name: '復原未儲存內容' }));
    await act(flushMicrotasks);

    expect(screen.getByRole('alert')).toHaveTextContent('無法處理未儲存內容');
    expect(screen.getByRole('button', { name: '重新檢查' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '忽略' })).not.toBeInTheDocument();
    expect(recovery.adoptMomentOutbox).toHaveBeenCalledOnce();
    expect(recovery.putMomentOutbox).not.toHaveBeenCalled();
    expect(updateMoment).not.toHaveBeenCalled();
  });
});
