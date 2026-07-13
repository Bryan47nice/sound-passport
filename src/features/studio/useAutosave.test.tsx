import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_CAPACITY_GUIDANCE, StorageCapacityError } from '../../data/storageErrors';
import { useAutosave, type AutosaveRecoveryPersistence } from './useAutosave';

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

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

const replaceLatest = (_current: string, next: string) => next;

function AutosaveHarness({
  save,
  forceSave,
  recovery,
  capture,
}: {
  save: Save;
  forceSave?: Save;
  recovery?: AutosaveRecoveryPersistence<string>;
  capture?: (api: AutosaveApi) => void;
}) {
  const [title, setTitle] = useState('東京夜行');
  const autosave = useAutosave({ save, forceSave, delay: 500, merge: replaceLatest, recovery });
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

  it('announces centralized backup and deletion guidance when autosave exceeds storage capacity', async () => {
    vi.useFakeTimers();
    const save = vi.fn<Save>().mockRejectedValue(
      new StorageCapacityError(new DOMException('quota', 'QuotaExceededError')),
    );
    render(<AutosaveHarness save={save} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '需要更多空間' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);

    expect(screen.getByText(STORAGE_CAPACITY_GUIDANCE)).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('true');
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

  it('persists a unique recovery generation before saving and compare-deletes it after success', async () => {
    vi.useFakeTimers();
    const recoveryWrite = deferred();
    const repositoryWrite = deferred();
    const recovery: AutosaveRecoveryPersistence<string> = {
      put: vi.fn(() => recoveryWrite.promise),
      compareAndDelete: vi.fn(async () => true),
    };
    const save = vi.fn<Save>(() => repositoryWrite.promise);
    render(<AutosaveHarness save={save} recovery={recovery} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: '第一版' } });
    expect(recovery.put).toHaveBeenCalledWith('第一版', {
      generation: expect.any(String),
      revision: 1,
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).not.toHaveBeenCalled();

    await act(async () => { recoveryWrite.resolve(undefined); await recoveryWrite.promise; await flushMicrotasks(); });
    expect(save).toHaveBeenCalledWith('第一版', { revision: 1 });
    const generation = vi.mocked(recovery.put).mock.calls[0][1].generation;

    await act(async () => { repositoryWrite.resolve(undefined); await repositoryWrite.promise; await flushMicrotasks(); });
    expect(recovery.compareAndDelete).toHaveBeenCalledWith(generation);
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('false');
  });

  it('surfaces outbox persistence failure and retries it before the normal save', async () => {
    vi.useFakeTimers();
    const persistenceFailure = new Error('IndexedDB unavailable');
    const recovery: AutosaveRecoveryPersistence<string> = {
      put: vi.fn()
        .mockRejectedValueOnce(persistenceFailure)
        .mockResolvedValueOnce(undefined),
      compareAndDelete: vi.fn(async () => true),
    };
    const save = vi.fn<Save>(async () => undefined);
    render(<AutosaveHarness save={save} recovery={recovery} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: 'Still in memory' } });
    await act(flushMicrotasks);
    expect(screen.getByLabelText('儲存狀態')).toHaveTextContent('error');
    expect(screen.getAllByText('自動儲存失敗')).toHaveLength(1);
    expect(screen.getByLabelText('是否有未儲存變更')).toHaveTextContent('true');
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(flushMicrotasks);
    expect(recovery.put).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith('Still in memory', { revision: 1 });
  });

  it('retains explicit force mode when its outbox retry fails before the repository call', async () => {
    vi.useFakeTimers();
    const recovery: AutosaveRecoveryPersistence<string> = {
      put: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('outbox write failed'))
        .mockResolvedValueOnce(undefined),
      compareAndDelete: vi.fn(async () => true),
    };
    const save = vi.fn<Save>().mockRejectedValueOnce(new Error('field conflict'));
    const forceSave = vi.fn<Save>(async () => undefined);
    render(<AutosaveHarness save={save} forceSave={forceSave} recovery={recovery} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: 'Force this value' } });
    await act(flushMicrotasks);
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(flushMicrotasks);

    fireEvent.click(screen.getByRole('button', { name: '重試並套用' }));
    await act(flushMicrotasks);
    expect(forceSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(flushMicrotasks);
    expect(recovery.put).toHaveBeenCalledTimes(3);
    expect(forceSave).toHaveBeenCalledWith('Force this value', { revision: 1 });
  });

  it('preserves force for an unchanged revision when flush observes a failed preflight', async () => {
    const preflightFailure = new Error('outbox write failed');
    const recovery: AutosaveRecoveryPersistence<string> = {
      put: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(preflightFailure)
        .mockResolvedValueOnce(undefined),
      compareAndDelete: vi.fn(async () => true),
    };
    const save = vi.fn<Save>().mockRejectedValueOnce(new Error('field conflict'));
    const forceSave = vi.fn<Save>(async () => undefined);
    let autosave!: AutosaveApi;
    render(<AutosaveHarness
      save={save}
      forceSave={forceSave}
      recovery={recovery}
      capture={(api) => { autosave = api; }}
    />);

    act(() => { autosave.saveNow('Force this unchanged revision'); });
    await act(flushMicrotasks);
    act(() => autosave.forceRetry());
    await act(flushMicrotasks);

    await act(async () => { await autosave.flush(); });
    expect(forceSave).toHaveBeenCalledWith('Force this unchanged revision', { revision: 1 });
  });

  const forcePreflightSupersessionCases = [
    ['later saveNow', 'immediate'],
    ['later saveNow of the current envelope', 'current'],
    ['navigation flush', 'navigation'],
    ['unmount flush', 'unmount'],
  ] as const;

  it.each(['pending', 'failed'] as const)(
    'binds force to its exact envelope when preflight is %s',
    async (preflightState) => {
      vi.useFakeTimers();

      for (const [pathName, path] of forcePreflightSupersessionCases) {
        const forcePreflight = deferred();
        const recovery: AutosaveRecoveryPersistence<string> = {
          put: vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockImplementationOnce(() => forcePreflight.promise)
            .mockResolvedValue(undefined),
          compareAndDelete: vi.fn(async () => true),
        };
        const save = vi.fn<Save>()
          .mockRejectedValueOnce(new Error('initial conflict'))
          .mockResolvedValue(undefined);
        const forceSave = vi.fn<Save>(async () => undefined);
        let autosave!: AutosaveApi;
        const view = render(
          <AutosaveHarness
            save={save}
            forceSave={forceSave}
            recovery={recovery}
            capture={(api) => { autosave = api; }}
          />,
        );

        act(() => { autosave.saveNow('Force candidate'); });
        await act(flushMicrotasks);
        expect(save, pathName).toHaveBeenCalledTimes(1);

        act(() => autosave.forceRetry());
        await act(flushMicrotasks);
        expect(recovery.put, pathName).toHaveBeenCalledTimes(2);
        expect(forceSave, pathName).not.toHaveBeenCalled();

        if (preflightState === 'failed') {
          await act(async () => {
            forcePreflight.reject(new Error('force preflight failed'));
            await forcePreflight.promise.catch(() => undefined);
            await flushMicrotasks();
          });
        }

        let navigationFlush: Promise<void> | undefined;
        if (path === 'immediate') {
          act(() => { autosave.saveNow('Later immediate value'); });
        } else if (path === 'current') {
          act(() => { autosave.saveNow(); });
        } else if (path === 'navigation') {
          act(() => {
            autosave.enqueue('Later navigation value');
            navigationFlush = autosave.flush();
          });
        } else {
          act(() => { autosave.enqueue('Later unmount value'); });
          view.unmount();
        }

        if (preflightState === 'pending') {
          await act(async () => {
            forcePreflight.resolve(undefined);
            await forcePreflight.promise;
            await flushMicrotasks();
          });
        } else {
          await act(flushMicrotasks);
        }
        if (navigationFlush) await act(async () => { await navigationFlush; });
        await act(flushMicrotasks);

        expect(save, pathName).toHaveBeenCalledTimes(2);
        expect(save, pathName).toHaveBeenLastCalledWith(
          path === 'immediate'
            ? 'Later immediate value'
            : path === 'current'
              ? 'Force candidate'
            : path === 'navigation'
              ? 'Later navigation value'
              : 'Later unmount value',
          { revision: path === 'current' ? 1 : 2 },
        );
        expect(forceSave, pathName).not.toHaveBeenCalled();

        view.unmount();
        await act(flushMicrotasks);
        vi.clearAllTimers();
      }
    },
  );

  const forceFailureCases = [
    ['generic failure', new Error('repository unavailable')],
    [
      'conflict failure',
      Object.assign(new Error('field conflict'), { name: 'JourneyVersionConflictError' }),
    ],
  ] as const;

  const postForcePaths = [
    {
      name: 'ordinary retry',
      expectedValue: 'Force candidate',
      continue: async (autosave: AutosaveApi) => {
        act(() => autosave.retry());
        await act(flushMicrotasks);
      },
    },
    {
      name: 'later immediate edit',
      expectedValue: 'Later immediate value',
      continue: async (autosave: AutosaveApi) => {
        act(() => { autosave.saveNow('Later immediate value'); });
        await act(flushMicrotasks);
      },
    },
    {
      name: 'later debounced edit',
      expectedValue: 'Later debounced value',
      continue: async (autosave: AutosaveApi) => {
        act(() => { autosave.enqueue('Later debounced value'); });
        await act(() => vi.advanceTimersByTimeAsync(500));
        await act(flushMicrotasks);
      },
    },
    {
      name: 'navigation flush',
      expectedValue: 'Force candidate',
      continue: async (autosave: AutosaveApi) => {
        let flushResult!: Promise<void>;
        act(() => { flushResult = autosave.flush(); });
        await act(async () => { await flushResult; });
      },
    },
    {
      name: 'unmount flush',
      expectedValue: 'Force candidate',
      continue: async (_autosave: AutosaveApi, unmount: () => void) => {
        unmount();
        await act(flushMicrotasks);
      },
    },
  ];

  it.each(forceFailureCases)(
    'consumes force after a %s across every later save path',
    async (_failureName, forceFailure) => {
      vi.useFakeTimers();

      for (const path of postForcePaths) {
        const recovery: AutosaveRecoveryPersistence<string> = {
          put: vi.fn(async () => undefined),
          compareAndDelete: vi.fn(async () => true),
        };
        const save = vi.fn<Save>()
          .mockRejectedValueOnce(new Error('initial conflict'))
          .mockResolvedValueOnce(undefined);
        const forceSave = vi.fn<Save>().mockRejectedValueOnce(forceFailure);
        let autosave!: AutosaveApi;
        const view = render(
          <AutosaveHarness
            save={save}
            forceSave={forceSave}
            recovery={recovery}
            capture={(api) => { autosave = api; }}
          />,
        );

        act(() => { autosave.saveNow('Force candidate'); });
        await act(flushMicrotasks);
        act(() => autosave.forceRetry());
        await act(flushMicrotasks);
        expect(forceSave, path.name).toHaveBeenCalledTimes(1);

        await path.continue(autosave, view.unmount);

        expect(save, path.name).toHaveBeenCalledTimes(2);
        expect(save, path.name).toHaveBeenLastCalledWith(path.expectedValue, { revision: expect.any(Number) });
        expect(forceSave, path.name).toHaveBeenCalledTimes(1);
        view.unmount();
        await act(flushMicrotasks);
        vi.clearAllTimers();
      }
    },
  );

  it('keeps a newer recovery generation when an older save completes', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    let storedGeneration: string | undefined;
    const recovery: AutosaveRecoveryPersistence<string> = {
      put: vi.fn(async (_value, context) => { storedGeneration = context.generation; }),
      compareAndDelete: vi.fn(async (generation) => {
        if (storedGeneration !== generation) return false;
        storedGeneration = undefined;
        return true;
      }),
    };
    const save = vi.fn<Save>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<AutosaveHarness save={save} recovery={recovery} />);

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: 'First value' } });
    await act(flushMicrotasks);
    await act(() => vi.advanceTimersByTimeAsync(500));
    const firstGeneration = vi.mocked(recovery.put).mock.calls[0][1].generation;

    fireEvent.change(screen.getByLabelText('旅程標題'), { target: { value: 'Newer value' } });
    await act(flushMicrotasks);
    expect(storedGeneration).not.toBe(firstGeneration);

    await act(async () => { first.resolve(undefined); await first.promise; await flushMicrotasks(); });
    expect(recovery.compareAndDelete).toHaveBeenCalledWith(firstGeneration);
    expect(storedGeneration).toEqual(expect.any(String));
    expect(storedGeneration).not.toBe(firstGeneration);

    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(async () => { second.resolve(undefined); await second.promise; await flushMicrotasks(); });
    expect(storedGeneration).toBeUndefined();
  });
});
