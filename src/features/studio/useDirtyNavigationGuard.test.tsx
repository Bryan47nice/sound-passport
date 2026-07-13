import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDirtyNavigationGuard } from './useDirtyNavigationGuard';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function GuardHarness({ dirty, flush }: { dirty: boolean; flush: () => Promise<void> }) {
  useDirtyNavigationGuard({ dirty, flush });
  const location = useLocation();
  return (
    <>
      <output aria-label="目前路徑">{location.pathname}</output>
      <Link to="/next">前往下一頁</Link>
    </>
  );
}

function renderGuard(dirty: boolean, flush: () => Promise<void>) {
  return render(
    <MemoryRouter initialEntries={['/current']}>
      <GuardHarness dirty={dirty} flush={flush} />
    </MemoryRouter>,
  );
}

describe('useDirtyNavigationGuard', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('holds an internal same-origin link until flush succeeds', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    renderGuard(true, flush);

    fireEvent.click(screen.getByRole('link', { name: '前往下一頁' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('目前路徑')).toHaveTextContent('/current');

    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(screen.getByLabelText('目前路徑')).toHaveTextContent('/next');
  });

  it('keeps the current route when an internal navigation flush fails', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    renderGuard(true, flush);

    fireEvent.click(screen.getByRole('link', { name: '前往下一頁' }));
    await act(async () => {
      pending.reject(new Error('write failed'));
      try {
        await pending.promise;
      } catch {}
    });

    expect(screen.getByLabelText('目前路徑')).toHaveTextContent('/current');
  });

  it('registers beforeunload while dirty and removes the exact listeners when clean', () => {
    const addWindowListener = vi.spyOn(window, 'addEventListener');
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const addDocumentListener = vi.spyOn(document, 'addEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const flush = vi.fn(async () => undefined);
    const view = renderGuard(true, flush);

    const beforeUnloadListener = addWindowListener.mock.calls
      .find(([eventName]) => eventName === 'beforeunload')?.[1] as EventListener;
    const clickListener = addDocumentListener.mock.calls
      .find(([eventName, _listener, capture]) => eventName === 'click' && capture === true)?.[1] as EventListener;
    expect(beforeUnloadListener).toBeTypeOf('function');
    expect(clickListener).toBeTypeOf('function');

    const event = new Event('beforeunload', { cancelable: true });
    beforeUnloadListener(event);
    expect(event.defaultPrevented).toBe(true);

    view.rerender(
      <MemoryRouter initialEntries={['/current']}>
        <GuardHarness dirty={false} flush={flush} />
      </MemoryRouter>,
    );
    expect(removeWindowListener).toHaveBeenCalledWith('beforeunload', beforeUnloadListener);
    expect(removeDocumentListener).toHaveBeenCalledWith('click', clickListener, true);
  });
});
