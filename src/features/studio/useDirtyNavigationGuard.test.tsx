import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GuardedLink,
  NavigationGuardProvider,
  useGuardedAsyncCommand,
  useGuardedNavigate,
  useGuardedRouteLocation,
} from '../../app/navigationGuard';
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

function GuardHarness({
  dirty,
  flush,
  onActualPathCommit,
}: {
  dirty: boolean;
  flush: () => Promise<void>;
  onActualPathCommit?: (pathname: string) => void;
}) {
  useDirtyNavigationGuard({ dirty, flush });
  const actualLocation = useLocation();
  const routeLocation = useGuardedRouteLocation();
  const navigate = useGuardedNavigate();
  const rawNavigate = useNavigate();

  useLayoutEffect(() => {
    onActualPathCommit?.(actualLocation.pathname);
  }, [actualLocation.pathname, onActualPathCommit]);

  return (
    <>
      <output aria-label="瀏覽器路徑">{actualLocation.pathname}</output>
      <output aria-label="畫面路徑">{routeLocation.pathname}</output>
      <GuardedLink to="/next">連結前往下一頁</GuardedLink>
      <button type="button" onClick={() => navigate('/next')}>程式前往下一頁</button>
      <button type="button" onClick={() => navigate('/middle')}>程式前往中間頁</button>
      <button type="button" onClick={() => navigate('/current')}>程式回到編輯頁</button>
      <button type="button" onClick={() => navigate('/next', { replace: true })}>程式取代下一頁</button>
      <button type="button" onClick={() => rawNavigate(-1)}>瀏覽器上一頁</button>
      <Routes location={routeLocation}>
        <Route path="/previous" element={<h1>上一頁</h1>} />
        <Route path="/middle" element={<h1>中間頁</h1>} />
        <Route path="/current" element={<h1>編輯頁</h1>} />
        <Route path="/next" element={<h1>下一頁</h1>} />
      </Routes>
    </>
  );
}

function CommandHarness({
  flush,
  command,
}: {
  flush: () => Promise<void>;
  command: () => Promise<void>;
}) {
  useDirtyNavigationGuard({ dirty: true, flush });
  const runGuardedCommand = useGuardedAsyncCommand();
  const routeLocation = useGuardedRouteLocation();

  return (
    <>
      <button type="button" onClick={() => { void runGuardedCommand(command).catch(() => undefined); }}>執行受保護命令</button>
      <GuardedLink to="/next">連結前往下一頁</GuardedLink>
      <Routes location={routeLocation}>
        <Route path="/current" element={<h1>編輯頁</h1>} />
        <Route path="/next" element={<h1>下一頁</h1>} />
      </Routes>
    </>
  );
}

function GuardTree({
  dirty,
  flush,
  onActualPathCommit,
}: {
  dirty: boolean;
  flush: () => Promise<void>;
  onActualPathCommit?: (pathname: string) => void;
}) {
  return (
    <NavigationGuardProvider>
      <GuardHarness dirty={dirty} flush={flush} onActualPathCommit={onActualPathCommit} />
    </NavigationGuardProvider>
  );
}

function renderGuard(dirty: boolean, flush: () => Promise<void>) {
  return render(
    <MemoryRouter initialEntries={['/previous', '/current']} initialIndex={1}>
      <GuardTree dirty={dirty} flush={flush} />
    </MemoryRouter>,
  );
}

async function renderBrowserHistory(
  flush: () => Promise<void>,
  onActualPathCommit?: (pathname: string) => void,
) {
  window.history.replaceState(null, '', '/previous');
  const view = render(
    <BrowserRouter>
      <GuardTree dirty={false} flush={flush} onActualPathCommit={onActualPathCommit} />
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: '程式前往中間頁' }));
  await waitFor(() => expect(window.location.pathname).toBe('/middle'));
  fireEvent.click(screen.getByRole('button', { name: '程式回到編輯頁' }));
  await waitFor(() => expect(window.location.pathname).toBe('/current'));
  view.rerender(
    <BrowserRouter>
      <GuardTree dirty flush={flush} onActualPathCommit={onActualPathCommit} />
    </BrowserRouter>,
  );
  return view;
}

describe('useDirtyNavigationGuard', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('holds an app link until flush succeeds', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    renderGuard(true, flush);

    fireEvent.click(screen.getByRole('link', { name: '連結前往下一頁' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/current');
    expect(screen.getByRole('heading', { name: '編輯頁' })).toBeInTheDocument();

    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/next');
    expect(screen.getByRole('heading', { name: '下一頁' })).toBeInTheDocument();
  });

  it('does not run an async command while a navigation transition already owns the flush', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const command = vi.fn(async () => undefined);
    render(
      <MemoryRouter initialEntries={['/previous', '/current']} initialIndex={1}>
        <NavigationGuardProvider>
          <CommandHarness flush={flush} command={command} />
        </NavigationGuardProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: '連結前往下一頁' }));
    fireEvent.click(screen.getByRole('button', { name: '執行受保護命令' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '下一頁' })).toBeInTheDocument();
  });

  it('cancels an async command when navigation starts during its dirty flush', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const command = vi.fn(async () => undefined);
    render(
      <MemoryRouter initialEntries={['/previous', '/current']} initialIndex={1}>
        <NavigationGuardProvider>
          <CommandHarness flush={flush} command={command} />
        </NavigationGuardProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '執行受保護命令' }));
    fireEvent.click(screen.getByRole('link', { name: '連結前往下一頁' }));
    expect(command).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '下一頁' })).toBeInTheDocument();
  });

  it('does not run an async command after the provider unmounts during flush', async () => {
    const pending = deferred();
    const command = vi.fn(async () => undefined);
    const view = render(
      <MemoryRouter initialEntries={['/current']}>
        <NavigationGuardProvider>
          <CommandHarness flush={() => pending.promise} command={command} />
        </NavigationGuardProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '執行受保護命令' }));
    view.unmount();
    await act(async () => { pending.resolve(undefined); await pending.promise; });

    expect(command).not.toHaveBeenCalled();
  });

  it('guards app programmatic PUSH navigation on success and failure', async () => {
    const failed = deferred();
    const flush = vi.fn(() => failed.promise);
    const view = renderGuard(true, flush);

    fireEvent.click(screen.getByRole('button', { name: '程式前往下一頁' }));
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/current');
    await act(async () => {
      failed.reject(new Error('write failed'));
      try { await failed.promise; } catch {}
    });
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/current');
    expect(screen.getByRole('heading', { name: '編輯頁' })).toBeInTheDocument();

    const succeeded = deferred();
    const nextFlush = vi.fn(() => succeeded.promise);
    view.rerender(
      <MemoryRouter initialEntries={['/previous', '/current']} initialIndex={1}>
        <GuardTree dirty flush={nextFlush} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '程式前往下一頁' }));
    await act(async () => { succeeded.resolve(undefined); await succeeded.promise; });
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/next');
    expect(screen.getByRole('heading', { name: '下一頁' })).toBeInTheDocument();
  });

  it('guards app programmatic REPLACE navigation before changing routes', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    renderGuard(true, flush);

    fireEvent.click(screen.getByRole('button', { name: '程式取代下一頁' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/current');

    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/next');
  });

  it('replaces an active app transition with the latest PUSH or REPLACE request', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    renderGuard(true, flush);

    fireEvent.click(screen.getByRole('button', { name: '程式前往中間頁' }));
    fireEvent.click(screen.getByRole('button', { name: '程式取代下一頁' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/current');

    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/next');
    expect(screen.getByRole('heading', { name: '下一頁' })).toBeInTheDocument();
  });

  it('keeps the current route mounted during POP and accepts it after flush succeeds', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    renderGuard(true, flush);

    fireEvent.click(screen.getByRole('button', { name: '瀏覽器上一頁' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/previous');
    expect(screen.getByLabelText('畫面路徑')).toHaveTextContent('/current');
    expect(screen.getByRole('heading', { name: '編輯頁' })).toBeInTheDocument();

    await act(async () => { pending.resolve(undefined); await pending.promise; });
    expect(screen.getByLabelText('畫面路徑')).toHaveTextContent('/previous');
    expect(screen.getByRole('heading', { name: '上一頁' })).toBeInTheDocument();
  });

  it('restores a failed POP to the editor route', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    renderGuard(true, flush);

    fireEvent.click(screen.getByRole('button', { name: '瀏覽器上一頁' }));
    await act(async () => {
      pending.reject(new Error('write failed'));
      try { await pending.promise; } catch {}
    });

    expect(screen.getByLabelText('瀏覽器路徑')).toHaveTextContent('/current');
    expect(screen.getByLabelText('畫面路徑')).toHaveTextContent('/current');
    expect(screen.getByRole('heading', { name: '編輯頁' })).toBeInTheDocument();
  });

  it('restores a rejected BrowserRouter history POP without unmounting the accepted route', async () => {
    window.history.replaceState(null, '', '/previous');
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const view = render(
      <BrowserRouter>
        <GuardTree dirty={false} flush={flush} />
      </BrowserRouter>,
    );
    const locations = () => view.container.querySelectorAll('output');

    fireEvent.click(view.container.querySelector('a')!);
    await waitFor(() => expect(window.location.pathname).toBe('/next'));
    expect(window.history.state).toMatchObject({ idx: expect.any(Number), key: expect.any(String) });
    view.rerender(
      <BrowserRouter>
        <GuardTree dirty flush={flush} />
      </BrowserRouter>,
    );

    act(() => window.history.back());
    await waitFor(() => expect(locations()[0]).toHaveTextContent('/previous'));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(locations()[1]).toHaveTextContent('/next');
    expect(screen.getByRole('heading')).toHaveTextContent(/.+/);

    await act(async () => {
      pending.reject(new Error('write failed'));
      try { await pending.promise; } catch {}
    });

    await waitFor(() => expect(window.location.pathname).toBe('/next'));
    expect(locations()[0]).toHaveTextContent('/next');
    expect(locations()[1]).toHaveTextContent('/next');
    expect(screen.getByRole('heading')).toHaveTextContent(/.+/);
  });

  it('uses the latest observed target when BrowserRouter receives two POPs during one flush', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const view = await renderBrowserHistory(flush);
    const locations = () => view.container.querySelectorAll('output');

    act(() => window.history.back());
    await waitFor(() => expect(locations()[0]).toHaveTextContent('/middle'));
    act(() => window.history.back());
    await waitFor(() => expect(locations()[0]).toHaveTextContent('/previous'));
    expect(locations()[1]).toHaveTextContent('/current');
    expect(flush).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(undefined); await pending.promise; });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/previous');
      expect(locations()[0]).toHaveTextContent('/previous');
      expect(locations()[1]).toHaveTextContent('/previous');
      expect(screen.getByRole('heading', { name: '上一頁' })).toBeInTheDocument();
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('uses a second POP committed immediately before the active flush resolves', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    let resolveOnPreviousCommit = false;
    const view = await renderBrowserHistory(flush, (pathname) => {
      if (resolveOnPreviousCommit && pathname === '/previous') pending.resolve(undefined);
    });
    const locations = () => view.container.querySelectorAll('output');

    act(() => window.history.back());
    await waitFor(() => expect(locations()[0]).toHaveTextContent('/middle'));
    expect(flush).toHaveBeenCalledTimes(1);

    resolveOnPreviousCommit = true;
    act(() => window.history.back());

    await waitFor(() => {
      expect(window.location.pathname).toBe('/previous');
      expect(locations()[0]).toHaveTextContent('/previous');
      expect(locations()[1]).toHaveTextContent('/previous');
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('lets the latest BrowserRouter POP supersede an app PUSH during the active flush', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const view = await renderBrowserHistory(flush);
    const locations = () => view.container.querySelectorAll('output');

    fireEvent.click(screen.getByRole('button', { name: '程式前往下一頁' }));
    expect(flush).toHaveBeenCalledTimes(1);
    act(() => window.history.back());
    await waitFor(() => expect(locations()[0]).toHaveTextContent('/middle'));
    expect(locations()[1]).toHaveTextContent('/current');

    await act(async () => { pending.resolve(undefined); await pending.promise; });

    await waitFor(() => expect(window.location.pathname).toBe('/middle'));
    expect(locations()[1]).toHaveTextContent('/middle');
    expect(screen.getByRole('heading', { name: '中間頁' })).toBeInTheDocument();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('reconciles a failed BrowserRouter double POP to the editor URL without loops', async () => {
    const pending = deferred();
    const flush = vi.fn(() => pending.promise);
    const view = await renderBrowserHistory(flush);
    const locations = () => view.container.querySelectorAll('output');

    act(() => window.history.back());
    await waitFor(() => expect(locations()[0]).toHaveTextContent('/middle'));
    act(() => window.history.back());
    await waitFor(() => expect(locations()[0]).toHaveTextContent('/previous'));

    await act(async () => {
      pending.reject(new Error('write failed'));
      try { await pending.promise; } catch {}
    });

    await waitFor(() => expect(window.location.pathname).toBe('/current'));
    expect(locations()[0]).toHaveTextContent('/current');
    expect(locations()[1]).toHaveTextContent('/current');
    expect(screen.getByRole('heading', { name: '編輯頁' })).toBeInTheDocument();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('registers only beforeunload globally while dirty and removes it when clean', () => {
    const addWindowListener = vi.spyOn(window, 'addEventListener');
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const addDocumentListener = vi.spyOn(document, 'addEventListener');
    const flush = vi.fn(async () => undefined);
    const view = renderGuard(true, flush);

    const beforeUnloadListener = addWindowListener.mock.calls
      .find(([eventName]) => eventName === 'beforeunload')?.[1] as EventListener;
    expect(beforeUnloadListener).toBeTypeOf('function');
    expect(addDocumentListener.mock.calls.some(([eventName]) => eventName === 'click')).toBe(false);

    const event = new Event('beforeunload', { cancelable: true });
    beforeUnloadListener(event);
    expect(event.defaultPrevented).toBe(true);

    view.rerender(
      <MemoryRouter initialEntries={['/previous', '/current']} initialIndex={1}>
        <GuardTree dirty={false} flush={flush} />
      </MemoryRouter>,
    );
    expect(removeWindowListener).toHaveBeenCalledWith('beforeunload', beforeUnloadListener);
  });
});
