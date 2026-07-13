import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GuardedLink,
  NavigationGuardProvider,
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

function GuardHarness({ dirty, flush }: { dirty: boolean; flush: () => Promise<void> }) {
  useDirtyNavigationGuard({ dirty, flush });
  const actualLocation = useLocation();
  const routeLocation = useGuardedRouteLocation();
  const navigate = useGuardedNavigate();
  const rawNavigate = useNavigate();

  return (
    <>
      <output aria-label="瀏覽器路徑">{actualLocation.pathname}</output>
      <output aria-label="畫面路徑">{routeLocation.pathname}</output>
      <GuardedLink to="/next">連結前往下一頁</GuardedLink>
      <button type="button" onClick={() => navigate('/next')}>程式前往下一頁</button>
      <button type="button" onClick={() => navigate('/next', { replace: true })}>程式取代下一頁</button>
      <button type="button" onClick={() => rawNavigate(-1)}>瀏覽器上一頁</button>
      <Routes location={routeLocation}>
        <Route path="/previous" element={<h1>上一頁</h1>} />
        <Route path="/current" element={<h1>編輯頁</h1>} />
        <Route path="/next" element={<h1>下一頁</h1>} />
      </Routes>
    </>
  );
}

function GuardTree({ dirty, flush }: { dirty: boolean; flush: () => Promise<void> }) {
  return (
    <NavigationGuardProvider>
      <GuardHarness dirty={dirty} flush={flush} />
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
