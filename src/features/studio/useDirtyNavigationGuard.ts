import { useLayoutEffect, useRef } from 'react';
import { useNavigationGuardRegistration } from '../../app/navigationGuard';

interface DirtyNavigationGuardOptions {
  dirty: boolean;
  flush: () => Promise<void>;
}

export function useDirtyNavigationGuard({ dirty, flush }: DirtyNavigationGuardOptions) {
  const updateGuard = useNavigationGuardRegistration();
  const ownerRef = useRef(Symbol('dirty-navigation-owner'));
  const flushRef = useRef(flush);
  const registrationRef = useRef({ dirty, flush: () => flushRef.current() });
  flushRef.current = flush;
  registrationRef.current.dirty = dirty;

  useLayoutEffect(() => {
    if (!updateGuard) return;
    const owner = ownerRef.current;
    updateGuard(owner, registrationRef.current);
  }, [dirty, updateGuard]);

  useLayoutEffect(() => {
    if (!updateGuard) return;
    const owner = ownerRef.current;
    return () => updateGuard(owner, undefined);
  }, [updateGuard]);
}
