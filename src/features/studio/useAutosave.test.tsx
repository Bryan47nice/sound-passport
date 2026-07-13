import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function AutosaveHarness({ save }: { save: (value: string) => Promise<void> }) {
  const [title, setTitle] = useState('東京夜行');
  const autosave = useAutosave({ value: title, save, delay: 500 });

  return (
    <>
      <label>旅程標題<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <output>{autosave.state}</output>
      <div aria-live="assertive">{autosave.errorAnnouncement}</div>
      {autosave.state === 'error' && <button type="button" onClick={autosave.retry}>重試儲存</button>}
    </>
  );
}

function SaveNowHarness({ save }: { save: (value: string) => Promise<void> }) {
  const autosave = useAutosave({ value: 'debounced value', save, delay: 500 });
  return (
    <>
      <button type="button" onClick={() => autosave.saveNow('immediate value')}>立即儲存</button>
      {autosave.state === 'error' && <button type="button" onClick={autosave.retry}>重試儲存</button>}
    </>
  );
}

describe('useAutosave', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('debounces an edit for exactly 500ms', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '東京夜行曲' } });
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('東京夜行曲');
  });

  it('does not create an initial or duplicate write under StrictMode', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    render(<StrictMode><AutosaveHarness save={save} /></StrictMode>);

    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '嚴格模式更新' } });
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('嚴格模式更新');
  });

  it('cancels only the pending debounce when a second edit arrives', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '第一版' } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    fireEvent.change(titleInput, { target: { value: '第二版' } });
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('第二版');
  });

  it('serializes saves and coalesces in-flight edits to the latest value', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '第一版' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(titleInput, { target: { value: '第二版' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(titleInput, { target: { value: '最終版' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => { first.resolve(); await first.promise; });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('最終版');
    await act(async () => { second.resolve(); await second.promise; });
    expect(screen.getByText('saved')).toBeInTheDocument();
  });

  it('retains the latest value after failure and retries it with one live announcement', async () => {
    vi.useFakeTimers();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    render(<AutosaveHarness save={save} />);
    const titleInput = screen.getByLabelText('旅程標題');

    fireEvent.change(titleInput, { target: { value: '保留這個標題' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(titleInput).toHaveValue('保留這個標題');
    expect(screen.getByText('自動儲存失敗')).toBeInTheDocument();
    expect(screen.getAllByText('自動儲存失敗')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(async () => undefined);
    expect(save).toHaveBeenLastCalledWith('保留這個標題');
    expect(screen.getByText('saved')).toBeInTheDocument();
  });

  it('retries the latest explicit saveNow value after a failed rerender', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    render(<SaveNowHarness save={save} />);

    fireEvent.click(screen.getByRole('button', { name: '立即儲存' }));
    expect(await screen.findByRole('button', { name: '重試儲存' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(async () => undefined);

    expect(save).toHaveBeenLastCalledWith('immediate value');
  });

  it('flushes a pending value once when unmounted', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const view = render(<AutosaveHarness save={save} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '離開前儲存' } });
    view.unmount();
    await act(async () => { await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('離開前儲存');
  });
});
