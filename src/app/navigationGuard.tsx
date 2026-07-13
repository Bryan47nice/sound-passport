import {
  createContext,
  type MouseEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
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
  type To,
  useLocation,
  useNavigate,
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
  requestNavigation: (commit: () => void) => void;
  updateGuard: (owner: symbol, registration: NavigationGuardRegistration | undefined) => void;
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
  return state?.key === location.key && typeof state.idx === 'number' ? state.idx : undefined;
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function NavigationGuardProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const rawNavigate = useNavigate();
  const [routeLocation, setRouteLocation] = useState(location);
  const [guardDirty, setGuardDirty] = useState(false);
  const guardRef = useRef<OwnedNavigationGuard | undefined>(undefined);
  const routeLocationRef = useRef(routeLocation);
  const actualLocationRef = useRef(location);
  const acceptedHistoryIndexRef = useRef(browserHistoryIndex(location));
  const approvedNavigationRef = useRef(false);
  const transitionRef = useRef<Promise<void> | undefined>(undefined);

  routeLocationRef.current = routeLocation;
  actualLocationRef.current = location;

  const acceptLocation = useCallback((nextLocation: Location) => {
    routeLocationRef.current = nextLocation;
    acceptedHistoryIndexRef.current = browserHistoryIndex(nextLocation);
    setRouteLocation(nextLocation);
  }, []);

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

  const requestNavigation = useCallback((commit: () => void) => {
    if (transitionRef.current) return;
    const guard = guardRef.current?.registration;
    if (!guard?.dirty) {
      commit();
      return;
    }

    let flushResult: Promise<void>;
    try {
      flushResult = guard.flush();
    } catch {
      return;
    }

    const transition = flushResult
      .then(() => {
        approvedNavigationRef.current = true;
        commit();
      })
      .catch(() => {
        // The mounted editor keeps the retryable failure visible.
      });
    transitionRef.current = transition;
    void transition.then(() => {
      if (transitionRef.current === transition) transitionRef.current = undefined;
    });
  }, []);

  useEffect(() => {
    if (sameRoute(location, routeLocationRef.current)) return;
    if (approvedNavigationRef.current) {
      approvedNavigationRef.current = false;
      acceptLocation(location);
      return;
    }

    const guard = guardRef.current?.registration;
    if (!guard?.dirty) {
      acceptLocation(location);
      return;
    }
    if (transitionRef.current) return;

    const attemptedLocation = location;
    const acceptedLocation = routeLocationRef.current;
    const attemptedHistoryIndex = browserHistoryIndex(attemptedLocation);
    let flushResult: Promise<void>;
    try {
      flushResult = guard.flush();
    } catch {
      flushResult = Promise.reject();
    }

    const transition = flushResult
      .then(() => {
        if (sameRoute(actualLocationRef.current, attemptedLocation)) acceptLocation(attemptedLocation);
      })
      .catch(() => {
        const acceptedHistoryIndex = acceptedHistoryIndexRef.current;
        const delta = acceptedHistoryIndex !== undefined && attemptedHistoryIndex !== undefined
          ? acceptedHistoryIndex - attemptedHistoryIndex
          : 0;
        if (delta !== 0) rawNavigate(delta);
        else rawNavigate(routePath(acceptedLocation), { replace: true });
      });
    transitionRef.current = transition;
    void transition.then(() => {
      if (transitionRef.current === transition) transitionRef.current = undefined;
    });
  }, [acceptLocation, location, rawNavigate]);

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
    requestNavigation(() => rawNavigate(to, options));
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
