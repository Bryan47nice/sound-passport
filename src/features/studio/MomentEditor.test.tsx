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
) {
  const onMomentChange = vi.fn();
  const onDelete = vi.fn(async () => undefined);
  const view = render(
    <MomentEditor
      moment={moment}
      position={1}
      repository={{ updateMoment }}
      onMomentChange={onMomentChange}
      onDelete={onDelete}
      onSaved={onSaved}
    />,
  );
  const rerenderMoment = (nextMoment: JourneyMoment) => view.rerender(
    <MomentEditor
      moment={nextMoment}
      position={1}
      repository={{ updateMoment }}
      onMomentChange={onMomentChange}
      onDelete={onDelete}
      onSaved={onSaved}
    />,
  );
  return { onDelete, onMomentChange, rerenderMoment, updateMoment };
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

  it('keeps a conflicting local draft visible and retries against the same accepted version', async () => {
    vi.useFakeTimers();
    const actualUpdatedAt = '2026-07-13T00:00:00.010Z';
    const updateMoment = vi.fn(async () => {
      throw new MomentVersionConflictError(moment.id, moment.updatedAt, actualUpdatedAt);
    });
    const { rerenderMoment } = renderEditor(updateMoment);

    fireEvent.change(screen.getByLabelText('時刻文案'), { target: { value: '本機衝突文案' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
    });

    expect(screen.getByText('時刻內容已在其他位置更新，本機草稿尚未覆寫。')).toBeInTheDocument();
    rerenderMoment({ ...moment, caption: '外部版本', updatedAt: actualUpdatedAt });
    expect(screen.getByLabelText('時刻文案')).toHaveValue('本機衝突文案');

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(flushMicrotasks);
    expect(updateMoment).toHaveBeenCalledTimes(2);
    expect(updateMoment).toHaveBeenLastCalledWith(
      moment.id,
      { caption: '本機衝突文案' },
      { expectedUpdatedAt: moment.updatedAt },
    );
    expect(screen.getByText('時刻內容已在其他位置更新，本機草稿尚未覆寫。')).toBeInTheDocument();
  });
});
