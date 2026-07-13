import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function renderEditor(updateMoment = vi.fn(async (_id: string, _patch: MomentPatch) => moment)) {
  const onMomentChange = vi.fn();
  const onDelete = vi.fn(async () => undefined);
  render(
    <MomentEditor
      moment={moment}
      position={1}
      repository={{ updateMoment }}
      onMomentChange={onMomentChange}
      onDelete={onDelete}
    />,
  );
  return { onDelete, onMomentChange, updateMoment };
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
    expect(updateMoment).toHaveBeenCalledWith('moment-1', {
      caption: '新的時刻文案',
      reason: '新的選歌原因',
      reasonStatus: 'complete',
      song: {
        title: '新的歌名',
        artist: '新的歌手',
        sourceUrl: invalidUrl,
      },
    });
  });

  it('persists date and optional time changes immediately', async () => {
    const { updateMoment } = renderEditor();

    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-07-14' } });
    await act(flushMicrotasks);
    expect(updateMoment).toHaveBeenCalledWith('moment-1', { localDate: '2026-07-14' });

    fireEvent.change(screen.getByLabelText('時間'), { target: { value: '' } });
    await act(flushMicrotasks);
    expect(updateMoment).toHaveBeenLastCalledWith('moment-1', { localTime: undefined });
  });
});
