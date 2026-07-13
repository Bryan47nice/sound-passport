import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

interface SaveContext {
  revision: number;
}

type Save = (value: string, context: SaveContext) => Promise<void>;
type AutosaveApi = ReturnType<typeof useAutosave<string>>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const replaceLatest = (_current: string, next: string) => next;

function AutosaveHarness({
  save,
  forceSave,
  onUnsavedChange,
  capture,
}: {
  save: Save;
  forceSave?: Save;
  onUnsavedChange?: (value: string | undefined) => void;
  capture?: (api: AutosaveApi) => void;
}) {
  const [title, setTitle] = useState('東京夜行');
  const autosave = useAutosave({ save, forceSave, delay: 500, merge: replaceLatest, onUnsavedChange });
  capture?.(autosave);

  return (
    <>
      <label>旅程標題
        <input
          value={title}
          onChange={(event) => {
            const nextTitle = event.target.value;
            setTitle(nextTitle);
            autosave.enqueue(nextTitle);
          }}
        />
      </label>
      <output aria-label="儲存狀態">{autosave.state}</output>
      <output aria-label="是否有未儲存變更">{String(autosave.dirty)}</output>
      <div aria-live="assertive">{autosave.errorAnnouncement}</div>
      <button type="button" onClick={() => autosave.saveNow()}>立即儲存</button>
      {autosave.state === 'error' && (
        <>
          <button type="button" onClick={autosave.retry}>重試儲存</button>
          {forceSave && <button type="button" onClick={autosave.forceRetry}>重試並套用</button>}
        </>
      )}
    </>
  );
}

describe('useAutosave', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces an edit for exactly 500ms', async () => {
    vi.useFakeTimers();
    const save = vi.fn<Save>(async () => undefined);
    render(<AutosaveHarness save={save} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '東京夜行曲' } });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('true');
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('東京夜行曲', { revision: 1 });
  });

  it('does not create an initial or duplicate write under StrictMode', async () => {
    vi.useFakeTimers();
    const save = vi.fn<Save>(async () => undefined);
    render(<StrictMode><AutosaveHarness save={save} /></StrictMode>);

    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '嚴格模式更新' } });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancels only the pending debounce when a second edit arrives', async () => {
    vi.useFakeTimers();
    const save = vi.fn<Save>(async () => undefined);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '第一版' } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    fireEvent.change(titleInput, { target: { value: '第二版' } });
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('第二版', { revision: 2 });
  });

  it('never reports saved when an older completion leaves a newer edit debouncing', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const save = vi.fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '第一版' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(titleInput, { target: { value: '第二版' } });
    await act(async () => { first.resolve(undefined); await first.promise; });

    expect(screen.getByLabelText('儲存狀態')).not.toHaveTextContent('saved');
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('true');
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('第二版', { revision: 2 });

    await act(async () => { second.resolve(undefined); await second.promise; });
    expect(screen.getByLabelText('儲存狀態')).toHaveTextContent('saved');
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('false');
  });

  it('serializes saves and coalesces ready in-flight edits to the latest value', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const save = vi.fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '第一版' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(titleInput, { target: { value: '第二版' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.change(titleInput, { target: { value: '最終版' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => { first.resolve(undefined); await first.promise; });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('最終版', { revision: 3 });
    await act(async () => { second.resolve(undefined); await second.promise; });
    expect(screen.getByLabelText('儲存狀態')).toHaveTextContent('saved');
  });

  it('rejects a failed flush, retains the latest value, and retries it explicitly', async () => {
    vi.useFakeTimers();
    const failed = deferred();
    const retried = deferred();
    const save = vi.fn<Save>()
      .mockImplementationOnce(() => failed.promise)
      .mockImplementationOnce(() => retried.promise);
    let autosave!: AutosaveApi;
    render(<AutosaveHarness save={save} capture={(api) => { autosave = api; }} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '離開前最新版' } });
    let flushResult: Promise<void>;
    act(() => { flushResult = autosave.flush(); });
    expect(save).toHaveBeenCalledWith('離開前最新版', { revision: 1 });

    const diskError = new Error('disk full');
    let flushError: unknown;
    await act(async () => {
      failed.reject(diskError);
      try {
        await flushResult!;
      } catch (error) {
        flushError = error;
      }
    });
    expect(flushError).toBe(diskError);
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('true');
    expect(screen.getAllByText('自動儲存失敗')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    expect(save).toHaveBeenLastCalledWith('離開前最新版', { revision: 1 });
    await act(async () => { retried.resolve(undefined); await retried.promise; });
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('false');
  });

  it('merges a newer edit into failed in-flight work before retrying', async () => {
    vi.useFakeTimers();
    const failed = deferred();
    const save = vi.fn<Save>()
      .mockImplementationOnce(() => failed.promise)
      .mockResolvedValueOnce(undefined);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '失敗版本' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(titleInput, { target: { value: '失敗後最新版' } });
    await act(async () => { failed.reject(new Error('write failed')); try { await failed.promise; } catch {} });
    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(async () => undefined);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('失敗後最新版', { revision: 2 });
  });

  it('flushes all newer work before resolving', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const save = vi.fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    let autosave!: AutosaveApi;
    render(<AutosaveHarness save={save} capture={(api) => { autosave = api; }} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '第一版' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(titleInput, { target: { value: '最新版' } });
    let didFlush = false;
    let flushResult: Promise<void>;
    act(() => {
      flushResult = autosave.flush().then(() => { didFlush = true; });
    });

    await act(async () => { first.resolve(undefined); await first.promise; });
    expect(save).toHaveBeenCalledTimes(2);
    expect(didFlush).toBe(false);
    await act(async () => { second.resolve(undefined); await second.promise; await flushResult!; });
    expect(didFlush).toBe(true);
  });

  it('turns a pending debounce into one immediate write without a catch-up duplicate', async () => {
    vi.useFakeTimers();
    const save = vi.fn<Save>(async () => undefined);
    render(<AutosaveHarness save={save} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '立即版本' } });
    fireEvent.click(screen.getByRole('button', { name: '立即儲存' }));
    await act(async () => undefined);
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('立即版本', { revision: 1 });
  });

  it('uses the latest save callback identity when queued work starts', async () => {
    vi.useFakeTimers();
    const firstSave = vi.fn<Save>(async () => undefined);
    const nextSave = vi.fn<Save>(async () => undefined);
    const view = render(<AutosaveHarness save={firstSave} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '替換 callback' } });
    view.rerender(<AutosaveHarness save={nextSave} />);
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(firstSave).not.toHaveBeenCalled();
    expect(nextSave).toHaveBeenCalledWith('替換 callback', { revision: 1 });
  });

  it('attempts one pending flush on bare unmount and ignores its later completion', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const save = vi.fn<Save>(() => pending.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<AutosaveHarness save={save} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '離開前儲存' } });
    view.unmount();
    await act(async () => { await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('離開前儲存', { revision: 1 });
    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reruns an ordinary retry through the conflict-safe save and uses force save only explicitly', async () => {
    vi.useFakeTimers();
    const save = vi.fn<Save>()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockRejectedValueOnce(new Error('field conflict'));
    const forceSave = vi.fn<Save>(async () => undefined);
    render(<AutosaveHarness save={save} forceSave={forceSave} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '保留本機標題' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole('button', { name: '重試儲存' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: '重試並套用' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('保留本機標題', { revision: 1 });
    expect(forceSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重試並套用' }));
    await act(async () => undefined);
    expect(forceSave).toHaveBeenCalledTimes(1);
    expect(forceSave).toHaveBeenCalledWith('保留本機標題', { revision: 1 });
  });

  it('returns monotonic revisions for queued edits', () => {
    const save = vi.fn<Save>(async () => undefined);
    let autosave!: AutosaveApi;
    render(<AutosaveHarness save={save} capture={(api) => { autosave = api; }} />);

    expect(autosave.enqueue('第一版')).toBe(1);
    expect(autosave.saveNow('第二版')).toBe(2);
  });

  it('publishes the latest unsaved value and clears it only after confirmed persistence', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const save = vi.fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onUnsavedChange = vi.fn<(value: string | undefined) => void>();
    render(<AutosaveHarness save={save} onUnsavedChange={onUnsavedChange} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '第一版' } });
    expect(onUnsavedChange).toHaveBeenLastCalledWith('第一版');
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '未確認最新版' } });
    expect(onUnsavedChange).toHaveBeenLastCalledWith('未確認最新版');

    await act(async () => { first.resolve(undefined); await first.promise; });
    expect(onUnsavedChange).toHaveBeenLastCalledWith('未確認最新版');
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(async () => { second.resolve(undefined); await second.promise; });
    expect(onUnsavedChange).toHaveBeenLastCalledWith(undefined);
  });
});
