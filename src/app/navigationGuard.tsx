import {
  createContext,
  type MouseEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Link,
  type LinkProps,
  type Location,
  type NavigateFunction,
  type NavigateOptions,
  NavigationType,
  type To,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router';

interface NavigationGuardRegistration {
  dirty: boolean;
  flush: () => Promise<void>;
}

interface OwnedNavigationGuard {
  owner: symbol;
  registration: NavigationGuardRegistration;
}

interface NavigationGuardContextValue {
  routeLocation: Location;
  requestNavigation: (request: AppNavigationRequest) => void;
  updateGuard: (owner: symbol, registration: NavigationGuardRegistration | undefined) => void;
}

interface HistoryEntry {
  location: Location;
  index: number | undefined;
}

interface AppNavigationRequest {
  kind: 'app';
  action: NavigationType.Push | NavigationType.Replace;
  commit: () => void;
}

interface PopNavigationRequest {
  kind: 'pop';
  entry: HistoryEntry;
}

type DesiredTransition = AppNavigationRequest | PopNavigationRequest;

interface ActiveTransition {
  token: symbol;
  committed: HistoryEntry;
  desired: DesiredTransition;
  flushPromise: Promise<void> | undefined;
  phase: 'flushing' | 'settling-success' | 'settling-failure' | 'applying';
}

interface NavigationSuppression {
  token: symbol;
  transitionToken: symbol;
  action: NavigationType;
  target?: HistoryEntry;
  resume: (entry: HistoryEntry) => void;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

function routePath(location: Location) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function sameRoute(left: Location, right: Location) {
  return routePath(left) === routePath(right);
}

function browserHistoryIndex(location: Location) {
  const state = window.history.state as { idx?: unknown; key?: unknown } | null;
  if (typeof state?.idx !== 'number') return undefined;
  if (state.key === location.key) return state.idx;
  return location.key === 'default' && state.key === undefined ? state.idx : undefined;
}

function historyEntry(location: Location): HistoryEntry {
  return { location, index: browserHistoryIndex(location) };
}

function sameHistoryEntry(left: HistoryEntry, right: HistoryEntry) {
  if (left.index !== undefined && right.index !== undefined) {
    return left.index === right.index && sameRoute(left.location, right.location);
  }
  return left.location.key === right.location.key && sameRoute(left.location, right.location);
}

function matchesHistoryTarget(actual: HistoryEntry, target: HistoryEntry) {
  if (actual.index !== undefined && target.index !== undefined) {
    return actual.index === target.index && sameRoute(actual.location, target.location);
  }
  return sameRoute(actual.location, target.location);
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function NavigationGuardProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const rawNavigate = useNavigate();
  const [routeLocation, setRouteLocation] = useState(location);
  const [guardDirty, setGuardDirty] = useState(false);
  const guardRef = useRef<OwnedNavigationGuard | undefined>(undefined);
  const committedEntryRef = useRef(historyEntry(location));
  const actualEntryRef = useRef(historyEntry(location));
  const transitionRef = useRef<ActiveTransition | undefined>(undefined);
  const suppressionRef = useRef<NavigationSuppression | undefined>(undefined);
  const mountedRef = useRef(true);
  const settleTransitionRef = useRef<(transition: ActiveTransition, succeeded: boolean) => void>(() => {});
  const applySuccessfulTransitionRef = useRef<(transition: ActiveTransition) => void>(() => {});
  const startTransitionRef = useRef<(desired: DesiredTransition) => void>(() => {});

  actualEntryRef.current = historyEntry(location);

  const acceptEntry = useCallback((entry: HistoryEntry) => {
    if (!mountedRef.current) return;
    committedEntryRef.current = entry;
    setRouteLocation(entry.location);
  }, []);

  const finishTransition = useCallback((transition: ActiveTransition) => {
    if (transitionRef.current?.token !== transition.token) return;
    if (suppressionRef.current?.transitionToken === transition.token) {
      suppressionRef.current = undefined;
    }
    transitionRef.current = undefined;
  }, []);

  const navigateWithoutFlush = useCallback((
    transition: ActiveTransition,
    target: HistoryEntry,
    resume: (entry: HistoryEntry) => void,
  ) => {
    if (transitionRef.current?.token !== transition.token) return;
    const actual = actualEntryRef.current;
    if (sameHistoryEntry(actual, target)) {
      resume(actual);
      return;
    }

    const delta = actual.index !== undefined && target.index !== undefined
      ? target.index - actual.index
      : 0;
    const action = delta === 0 ? NavigationType.Replace : NavigationType.Pop;
    const suppression: NavigationSuppression = {
      token: Symbol('navigation-suppression'),
      transitionToken: transition.token,
      action,
      target,
      resume,
    };
    suppressionRef.current = suppression;

    try {
      if (delta !== 0) rawNavigate(delta);
      else rawNavigate(routePath(target.location), {
        replace: true,
        state: target.location.state,
      });
    } catch {
      if (suppressionRef.current?.token === suppression.token) suppressionRef.current = undefined;
      finishTransition(transition);
    }
  }, [finishTransition, rawNavigate]);

  const applySuccessfulTransition = useCallback((transition: ActiveTransition) => {
    if (!mountedRef.current || transitionRef.current?.token !== transition.token) return;
    const desired = transition.desired;
    const actual = actualEntryRef.current;

    if (desired.kind === 'pop') {
      if (sameHistoryEntry(actual, desired.entry)) {
        acceptEntry(actual);
        finishTransition(transition);
        return;
      }
      transition.phase = 'applying';
      navigateWithoutFlush(transition, desired.entry, (entry) => {
        acceptEntry(entry);
        finishTransition(transition);
      });
      return;
    }

    if (!sameHistoryEntry(actual, transition.committed)) {
      transition.phase = 'settling-success';
      navigateWithoutFlush(transition, transition.committed, (entry) => {
        transition.committed = entry;
        acceptEntry(entry);
        applySuccessfulTransitionRef.current(transition);
      });
      return;
    }

    transition.phase = 'applying';
    const suppression: NavigationSuppression = {
      token: Symbol('navigation-suppression'),
      transitionToken: transition.token,
      action: desired.action,
      resume: (entry) => {
        acceptEntry(entry);
        finishTransition(transition);
      },
    };
    suppressionRef.current = suppression;
    try {
      desired.commit();
    } catch {
      if (suppressionRef.current?.token === suppression.token) suppressionRef.current = undefined;
      finishTransition(transition);
    }
  }, [acceptEntry, finishTransition, navigateWithoutFlush]);
  applySuccessfulTransitionRef.current = applySuccessfulTransition;

  const settleTransition = useCallback((transition: ActiveTransition, succeeded: boolean) => {
    if (!mountedRef.current || transitionRef.current?.token !== transition.token) return;
    if (succeeded) {
      transition.phase = 'settling-success';
      applySuccessfulTransitionRef.current(transition);
      return;
    }

    transition.phase = 'settling-failure';
    const actual = actualEntryRef.current;
    if (sameHistoryEntry(actual, transition.committed)) {
      acceptEntry(actual);
      finishTransition(transition);
      return;
    }
    navigateWithoutFlush(transition, transition.committed, (entry) => {
      transition.committed = entry;
      acceptEntry(entry);
      finishTransition(transition);
    });
  }, [acceptEntry, finishTransition, navigateWithoutFlush]);
  settleTransitionRef.current = settleTransition;

  const startTransition = useCallback((desired: DesiredTransition) => {
    const guard = guardRef.current?.registration;
    if (!guard?.dirty) {
      if (desired.kind === 'app') desired.commit();
      else acceptEntry(desired.entry);
      return;
    }

    const transition: ActiveTransition = {
      token: Symbol('navigation-transition'),
      committed: committedEntryRef.current,
      desired,
      flushPromise: undefined,
      phase: 'flushing',
    };
    transitionRef.current = transition;
    try {
      const flushPromise = guard.flush();
      transition.flushPromise = flushPromise;
      void flushPromise.then(
        () => settleTransitionRef.current(transition, true),
        () => settleTransitionRef.current(transition, false),
      );
    } catch {
      settleTransitionRef.current(transition, false);
    }
  }, [acceptEntry]);
  startTransitionRef.current = startTransition;

  const updateGuard = useCallback((
    owner: symbol,
    registration: NavigationGuardRegistration | undefined,
  ) => {
    if (!registration) {
      if (guardRef.current?.owner !== owner) return;
      guardRef.current = undefined;
      setGuardDirty(false);
      return;
    }
    guardRef.current = { owner, registration };
    setGuardDirty(registration.dirty);
  }, []);

  const requestNavigation = useCallback((request: AppNavigationRequest) => {
    const activeTransition = transitionRef.current;
    if (activeTransition) {
      if (activeTransition.phase === 'flushing' || activeTransition.phase === 'settling-success') {
        activeTransition.desired = request;
      }
      return;
    }
    const guard = guardRef.current?.registration;
    if (!guard?.dirty) {
      request.commit();
      return;
    }
    startTransitionRef.current(request);
  }, []);

  useLayoutEffect(() => {
    const actual = historyEntry(location);
    actualEntryRef.current = actual;
    const suppression = suppressionRef.current;
    if (
      suppression &&
      suppression.action === navigationType &&
      (!suppression.target || matchesHistoryTarget(actual, suppression.target))
    ) {
      suppressionRef.current = undefined;
      const transition = transitionRef.current;
      if (transition?.token === suppression.transitionToken) suppression.resume(actual);
      return;
    }

    const activeTransition = transitionRef.current;
    if (activeTransition) {
      if (
        navigationType === NavigationType.Pop &&
        (activeTransition.phase === 'flushing' || activeTransition.phase === 'settling-success')
      ) {
        activeTransition.desired = { kind: 'pop', entry: actual };
      }
      return;
    }

    if (sameHistoryEntry(actual, committedEntryRef.current)) return;
    const guard = guardRef.current?.registration;
    if (!guard?.dirty) {
      acceptEntry(actual);
      return;
    }
    startTransitionRef.current({ kind: 'pop', entry: actual });
  }, [acceptEntry, location, navigationType]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      transitionRef.current = undefined;
      suppressionRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!guardDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [guardDirty]);

  const value = useMemo<NavigationGuardContextValue>(() => ({
    routeLocation,
    requestNavigation,
    updateGuard,
  }), [requestNavigation, routeLocation, updateGuard]);

  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>;
}

export function useNavigationGuardRegistration() {
  return useContext(NavigationGuardContext)?.updateGuard;
}

export function useGuardedRouteLocation() {
  const location = useLocation();
  return useContext(NavigationGuardContext)?.routeLocation ?? location;
}

export function useGuardedNavigate(): NavigateFunction {
  const rawNavigate = useNavigate();
  const requestNavigation = useContext(NavigationGuardContext)?.requestNavigation;

  return useCallback(((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') {
      rawNavigate(to);
      return;
    }
    if (!requestNavigation) {
      rawNavigate(to, options);
      return;
    }
    requestNavigation({
      kind: 'app',
      action: options?.replace ? NavigationType.Replace : NavigationType.Push,
      commit: () => rawNavigate(to, options),
    });
  }) as NavigateFunction, [rawNavigate, requestNavigation]);
}

export function GuardedLink({
  onClick,
  reloadDocument,
  replace,
  state,
  preventScrollReset,
  relative,
  viewTransition,
  target,
  to,
  ...props
}: LinkProps) {
  const navigate = useGuardedNavigate();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      reloadDocument ||
      !isPlainPrimaryClick(event) ||
      (target && target !== '_self')
    ) return;
    event.preventDefault();
    navigate(to, { replace, state, preventScrollReset, relative, viewTransition });
  };

  return (
    <Link
      {...props}
      reloadDocument={reloadDocument}
      replace={replace}
      state={state}
      preventScrollReset={preventScrollReset}
      relative={relative}
      viewTransition={viewTransition}
      target={target}
      to={to}
      onClick={handleClick}
    />
  );
}
