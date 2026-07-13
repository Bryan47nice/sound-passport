import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveSaveContext {
  revision: number;
}

type AutosaveSave<T> = (value: T, context: AutosaveSaveContext) => Promise<void>;

interface UseAutosaveOptions<T> {
  save: AutosaveSave<T>;
  forceSave?: AutosaveSave<T>;
  delay: number;
  merge?: (current: T, next: T) => T;
  onUnsavedChange?: (value: T | undefined) => void;
}

interface RevisionedValue<T> {
  value: T;
  revision: number;
  ready: boolean;
}

interface FlushWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface AutosaveViewState {
  state: AutosaveState;
  dirty: boolean;
  savedAt?: Date;
  error?: unknown;
  errorAnnouncement: string;
}

export interface AutosaveResult<T> extends AutosaveViewState {
  enqueue: (value: T) => number;
  retry: () => void;
  forceRetry: () => void;
  saveNow: (value?: T) => number | undefined;
  flush: () => Promise<void>;
}

const latestValue = <T,>(_current: T, next: T) => next;

export function useAutosave<T>({
  save,
  forceSave,
  delay,
  merge = latestValue,
  onUnsavedChange,
}: UseAutosaveOptions<T>): AutosaveResult<T> {
  const [view, setView] = useState<AutosaveViewState>({
    state: 'idle',
    dirty: false,
    errorAnnouncement: '',
  });
  const saveRef = useRef(save);
  const forceSaveRef = useRef(forceSave);
  const mergeRef = useRef(merge);
  const onUnsavedChangeRef = useRef(onUnsavedChange);
  const delayRef = useRef(delay);
  const pendingRef = useRef<RevisionedValue<T> | undefined>(undefined);
  const inFlightRef = useRef<RevisionedValue<T> | undefined>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const waitersRef = useRef<FlushWaiter[]>([]);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const startNextRef = useRef<(saveOperation?: AutosaveSave<T>) => void>(() => undefined);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());

  saveRef.current = save;
  forceSaveRef.current = forceSave;
  mergeRef.current = merge;
  onUnsavedChangeRef.current = onUnsavedChange;
  delayRef.current = delay;

  const publish = useCallback((update: (current: AutosaveViewState) => AutosaveViewState) => {
    if (mountedRef.current) setView(update);
  }, []);

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current === undefined) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = undefined;
  }, []);

  const isClean = useCallback(() => (
    pendingRef.current === undefined &&
    inFlightRef.current === undefined &&
    persistedRevisionRef.current === latestRevisionRef.current
  ), []);

  const resolveFlushesIfClean = useCallback(() => {
    if (!isClean()) return;
    const waiters = waitersRef.current.splice(0);
    waiters.forEach(({ resolve }) => resolve());
  }, [isClean]);

  const rejectFlushes = useCallback((error: unknown) => {
    const waiters = waitersRef.current.splice(0);
    waiters.forEach(({ reject }) => reject(error));
  }, []);

  const notifyUnsavedChange = useCallback(() => {
    const inFlight = inFlightRef.current;
    const pending = pendingRef.current;
    const unsaved = inFlight && pending
      ? mergeRef.current(inFlight.value, pending.value)
      : inFlight?.value ?? pending?.value;
    try {
      onUnsavedChangeRef.current?.(unsaved);
    } catch {
      // Recovery persistence must not interrupt the underlying save queue.
    }
  }, []);

  const startNext = useCallback((saveOperation?: AutosaveSave<T>) => {
    const pending = pendingRef.current;
    if (inFlightRef.current || !pending?.ready) return;

    pendingRef.current = undefined;
    inFlightRef.current = pending;
    publish((current) => ({
      ...current,
      state: 'saving',
      dirty: true,
      error: undefined,
      errorAnnouncement: '',
    }));

    let saveResult: Promise<void>;
    try {
      const operation = saveOperation ?? saveRef.current;
      saveResult = Promise.resolve(operation(pending.value, { revision: pending.revision }));
    } catch (error) {
      saveResult = Promise.reject(error);
    }

    void saveResult.then(() => {
      if (inFlightRef.current !== pending) return;
      inFlightRef.current = undefined;
      persistedRevisionRef.current = Math.max(persistedRevisionRef.current, pending.revision);
      notifyUnsavedChange();

      const queued = pendingRef.current;
      if (queued) {
        if (queued.ready) {
          startNextRef.current();
        } else {
          publish((current) => ({
            ...current,
            state: 'idle',
            dirty: true,
            error: undefined,
            errorAnnouncement: '',
          }));
        }
        return;
      }

      publish((current) => ({
        ...current,
        state: 'saved',
        dirty: false,
        savedAt: new Date(),
        error: undefined,
        errorAnnouncement: '',
      }));
      resolveFlushesIfClean();
    }).catch((error: unknown) => {
      if (inFlightRef.current !== pending) return;
      inFlightRef.current = undefined;
      cancelDebounce();

      const queued = pendingRef.current;
      pendingRef.current = queued
        ? {
            value: mergeRef.current(pending.value, queued.value),
            revision: queued.revision,
            ready: false,
          }
        : { ...pending, ready: false };
      notifyUnsavedChange();

      publish((current) => ({
        ...current,
        state: 'error',
        dirty: true,
        error,
        errorAnnouncement: '自動儲存失敗',
      }));
      rejectFlushes(error);
    });
  }, [cancelDebounce, notifyUnsavedChange, publish, rejectFlushes, resolveFlushesIfClean]);

  startNextRef.current = startNext;

  const schedulePending = useCallback(() => {
    cancelDebounce();
    const pending = pendingRef.current;
    if (!pending) return;

    if (waitersRef.current.length > 0) {
      pending.ready = true;
      startNextRef.current();
      return;
    }

    pending.ready = false;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      if (!pendingRef.current) return;
      pendingRef.current.ready = true;
      startNextRef.current();
    }, delayRef.current);
  }, [cancelDebounce]);

  const queueValue = useCallback((value: T, immediate: boolean) => {
    const revision = latestRevisionRef.current + 1;
    latestRevisionRef.current = revision;
    const queued = pendingRef.current;
    pendingRef.current = {
      value: queued ? mergeRef.current(queued.value, value) : value,
      revision,
      ready: immediate || waitersRef.current.length > 0,
    };
    notifyUnsavedChange();

    publish((current) => ({
      ...current,
      state: inFlightRef.current ? 'saving' : current.state === 'error' ? 'error' : 'idle',
      dirty: true,
    }));

    if (pendingRef.current.ready) {
      cancelDebounce();
      startNextRef.current();
    } else {
      schedulePending();
    }
    return revision;
  }, [cancelDebounce, notifyUnsavedChange, publish, schedulePending]);

  const enqueue = useCallback((value: T) => {
    return queueValue(value, false);
  }, [queueValue]);

  const saveNow = useCallback((value?: T) => {
    if (value !== undefined) {
      return queueValue(value, true);
    }
    cancelDebounce();
    if (!pendingRef.current) return undefined;
    pendingRef.current.ready = true;
    const revision = pendingRef.current.revision;
    startNextRef.current();
    return revision;
  }, [cancelDebounce, queueValue]);

  const retry = useCallback(() => {
    cancelDebounce();
    if (!pendingRef.current) return;
    pendingRef.current.ready = true;
    startNextRef.current();
  }, [cancelDebounce]);

  const forceRetry = useCallback(() => {
    cancelDebounce();
    const operation = forceSaveRef.current;
    if (!pendingRef.current || !operation) return;
    pendingRef.current.ready = true;
    startNextRef.current(operation);
  }, [cancelDebounce]);

  const flush = useCallback(() => {
    cancelDebounce();
    if (pendingRef.current) pendingRef.current.ready = true;
    if (isClean()) return Promise.resolve();

    const result = new Promise<void>((resolve, reject) => {
      waitersRef.current.push({ resolve, reject });
    });
    startNextRef.current();
    return result;
  }, [cancelDebounce, isClean]);

  flushRef.current = flush;

  useEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;

    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      const cleanupLifecycle = lifecycleRef.current;
      cancelDebounce();
      queueMicrotask(() => {
        if (mountedRef.current || lifecycleRef.current !== cleanupLifecycle) return;
        void flushRef.current().catch(() => undefined);
      });
    };
  }, [cancelDebounce]);

  return { ...view, enqueue, retry, forceRetry, saveNow, flush };
}
