import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

interface DirtyNavigationGuardOptions {
  dirty: boolean;
  flush: () => Promise<void>;
}

function isPlainPrimaryClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function useDirtyNavigationGuard({ dirty, flush }: DirtyNavigationGuardOptions) {
  const navigate = useNavigate();
  const flushRef = useRef(flush);
  const navigateRef = useRef(navigate);
  const mountedRef = useRef(false);
  const navigationRef = useRef<Promise<void> | undefined>(undefined);

  flushRef.current = flush;
  navigateRef.current = navigate;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!dirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isPlainPrimaryClick(event) || !(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || !['http:', 'https:'].includes(destination.protocol)) return;

      event.preventDefault();
      event.stopPropagation();
      if (navigationRef.current) return;

      const path = `${destination.pathname}${destination.search}${destination.hash}`;
      let flushResult: Promise<void>;
      try {
        flushResult = flushRef.current();
      } catch {
        return;
      }
      const navigation = flushResult
        .then(() => {
          if (mountedRef.current) navigateRef.current(path);
        })
        .catch(() => {
          // The autosave surface retains and displays the retryable failure.
        });
      navigationRef.current = navigation;
      void navigation.then(() => {
        if (navigationRef.current === navigation) navigationRef.current = undefined;
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
    };
  }, [dirty]);
}
