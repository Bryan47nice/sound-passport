import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveSaveContext {
  revision: number;
}

export interface AutosaveRecoveryContext extends AutosaveSaveContext {
  generation: string;
}

export interface AutosaveRecoveryPersistence<T> {
  put(value: T, context: AutosaveRecoveryContext): Promise<void>;
  compareAndDelete(generation: string): Promise<boolean>;
}

type AutosaveSave<T> = (value: T, context: AutosaveSaveContext) => Promise<void>;
type SaveMode = 'normal' | 'force';

interface UseAutosaveOptions<T> {
  save: AutosaveSave<T>;
  forceSave?: AutosaveSave<T>;
  delay: number;
  merge?: (current: T, next: T) => T;
  recovery?: AutosaveRecoveryPersistence<T>;
}

interface RevisionedValue<T> {
  value: T;
  revision: number;
  ready: boolean;
  mode: SaveMode;
}

interface InFlightValue<T> extends RevisionedValue<T> {
  generation: string;
}

interface RecoveryEntry<T> {
  value: T;
  revision: number;
  generation: string;
  status: 'pending' | 'persisted' | 'failed';
  error?: unknown;
  promise: Promise<void>;
}

interface FlushWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface CleanupFailure {
  generation: string;
  error: unknown;
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
let fallbackGeneration = 0;

function createGenerationToken() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  fallbackGeneration += 1;
  return `autosave-${Date.now()}-${fallbackGeneration}`;
}

export function useAutosave<T>({
  save,
  forceSave,
  delay,
  merge = latestValue,
  recovery,
}: UseAutosaveOptions<T>): AutosaveResult<T> {
  const [view, setView] = useState<AutosaveViewState>({
    state: 'idle',
    dirty: false,
    errorAnnouncement: '',
  });
  const saveRef = useRef(save);
  const forceSaveRef = useRef(forceSave);
  const mergeRef = useRef(merge);
  const recoveryPersistenceRef = useRef(recovery);
  const delayRef = useRef(delay);
  const pendingRef = useRef<RevisionedValue<T> | undefined>(undefined);
  const inFlightRef = useRef<InFlightValue<T> | undefined>(undefined);
  const recoveryEntryRef = useRef<RecoveryEntry<T> | undefined>(undefined);
  const recoveryTailRef = useRef<Promise<void> | undefined>(undefined);
  const cleanupFailureRef = useRef<CleanupFailure | undefined>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const waitersRef = useRef<FlushWaiter[]>([]);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const startingRef = useRef(false);
  const startNextRef = useRef<() => void>(() => undefined);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const retryCleanupRef = useRef<() => void>(() => undefined);

  saveRef.current = save;
  forceSaveRef.current = forceSave;
  mergeRef.current = merge;
  recoveryPersistenceRef.current = recovery;
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
    cleanupFailureRef.current === undefined &&
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

  const publishFailure = useCallback((error: unknown) => {
    publish((current) => ({
      ...current,
      state: 'error',
      dirty: true,
      error,
      errorAnnouncement: '自動儲存失敗',
    }));
    rejectFlushes(error);
  }, [publish, rejectFlushes]);

  const queueRecoveryOperation = useCallback((operation: () => Promise<void>) => {
    const previous = recoveryTailRef.current;
    let queued: Promise<void>;
    if (previous) {
      queued = previous.then(operation, operation);
    } else {
      try {
        queued = Promise.resolve(operation());
      } catch (error) {
        queued = Promise.reject(error);
      }
    }

    const tail = queued.then(() => undefined, () => undefined);
    recoveryTailRef.current = tail;
    void tail.then(() => {
      if (recoveryTailRef.current === tail) recoveryTailRef.current = undefined;
    });
    return queued;
  }, []);

  const currentUnsaved = useCallback(() => {
    const inFlight = inFlightRef.current;
    const pending = pendingRef.current;
    if (inFlight && pending) {
      return {
        value: mergeRef.current(inFlight.value, pending.value),
        revision: pending.revision,
      };
    }
    if (pending) return { value: pending.value, revision: pending.revision };
    if (inFlight) return { value: inFlight.value, revision: inFlight.revision };
    return undefined;
  }, []);

  const persistCurrentRecovery = useCallback((force = false) => {
    const persistence = recoveryPersistenceRef.current;
    const unsaved = currentUnsaved();
    if (!persistence || !unsaved) return undefined;

    const current = recoveryEntryRef.current;
    if (!force && current?.revision === unsaved.revision && current.status !== 'failed') return current;

    const entry = {} as RecoveryEntry<T>;
    entry.value = unsaved.value;
    entry.revision = unsaved.revision;
    entry.generation = createGenerationToken();
    entry.status = 'pending';
    entry.promise = queueRecoveryOperation(() => persistence.put(entry.value, {
      generation: entry.generation,
      revision: entry.revision,
    }));
    recoveryEntryRef.current = entry;

    void entry.promise.then(() => {
      entry.status = 'persisted';
      if (
        recoveryEntryRef.current === entry &&
        pendingRef.current?.ready &&
        !inFlightRef.current &&
        !startingRef.current
      ) startNextRef.current();
    }, (error: unknown) => {
      entry.status = 'failed';
      entry.error = error;
      if (recoveryEntryRef.current !== entry) return;
      cancelDebounce();
      publishFailure(error);
    });

    return entry;
  }, [cancelDebounce, currentUnsaved, publishFailure, queueRecoveryOperation]);

  const startNext = useCallback(() => {
    const pending = pendingRef.current;
    if (startingRef.current || inFlightRef.current || !pending?.ready) return;

    const beginSave = (generation: string) => {
      if (pendingRef.current !== pending || inFlightRef.current) return;
      pendingRef.current = undefined;
      const inFlight: InFlightValue<T> = { ...pending, generation };
      inFlightRef.current = inFlight;
      publish((current) => ({
        ...current,
        state: 'saving',
        dirty: true,
        error: undefined,
        errorAnnouncement: '',
      }));

      const requestedOperation = inFlight.mode === 'force' ? forceSaveRef.current : saveRef.current;
      const operation = requestedOperation ?? saveRef.current;
      let saveResult: Promise<void>;
      try {
        saveResult = Promise.resolve(operation(inFlight.value, { revision: inFlight.revision }));
      } catch (error) {
        saveResult = Promise.reject(error);
      }

      void saveResult.then(async () => {
        if (inFlightRef.current !== inFlight) return;
        let cleanupError: unknown;
        const persistence = recoveryPersistenceRef.current;
        if (persistence) {
          try {
            await queueRecoveryOperation(async () => {
              await persistence.compareAndDelete(inFlight.generation);
            });
          } catch (error) {
            cleanupError = error;
          }
        }
        if (inFlightRef.current !== inFlight) return;

        inFlightRef.current = undefined;
        persistedRevisionRef.current = Math.max(persistedRevisionRef.current, inFlight.revision);
        if (cleanupError !== undefined) {
          cleanupFailureRef.current = { generation: inFlight.generation, error: cleanupError };
          cancelDebounce();
          publishFailure(cleanupError);
          return;
        }

        const queued = pendingRef.current;
        if (queued) {
          persistCurrentRecovery(true);
          publish((current) => ({
            ...current,
            state: queued.ready ? 'saving' : 'idle',
            dirty: true,
            error: undefined,
            errorAnnouncement: '',
          }));
          if (!recoveryPersistenceRef.current && queued.ready) startNextRef.current();
          return;
        }

        recoveryEntryRef.current = undefined;
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
        if (inFlightRef.current !== inFlight) return;
        inFlightRef.current = undefined;
        cancelDebounce();

        const queued = pendingRef.current;
        pendingRef.current = queued
          ? {
              value: mergeRef.current(inFlight.value, queued.value),
              revision: queued.revision,
              ready: false,
              mode: queued.mode,
            }
          : {
              value: inFlight.value,
              revision: inFlight.revision,
              ready: false,
              mode: inFlight.mode,
            };
        publishFailure(error);
      });
    };

    const persistence = recoveryPersistenceRef.current;
    if (!persistence) {
      beginSave(createGenerationToken());
      return;
    }

    let entry = recoveryEntryRef.current;
    if (!entry || entry.revision !== pending.revision) entry = persistCurrentRecovery(true);
    if (!entry) return;
    if (entry.status === 'failed') {
      rejectFlushes(entry.error);
      return;
    }
    if (entry.status === 'persisted') {
      beginSave(entry.generation);
      return;
    }

    startingRef.current = true;
    void entry.promise.then(() => {
      startingRef.current = false;
      if (recoveryEntryRef.current !== entry) {
        startNextRef.current();
        return;
      }
      beginSave(entry.generation);
    }, (error: unknown) => {
      startingRef.current = false;
      rejectFlushes(error);
    });
  }, [cancelDebounce, persistCurrentRecovery, publish, publishFailure, queueRecoveryOperation, rejectFlushes, resolveFlushesIfClean]);

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
      mode: queued?.mode ?? 'normal',
    };
    cleanupFailureRef.current = undefined;
    persistCurrentRecovery();

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
  }, [cancelDebounce, persistCurrentRecovery, publish, schedulePending]);

  const enqueue = useCallback((value: T) => queueValue(value, false), [queueValue]);

  const saveNow = useCallback((value?: T) => {
    if (value !== undefined) return queueValue(value, true);
    cancelDebounce();
    if (!pendingRef.current) return undefined;
    pendingRef.current.ready = true;
    const revision = pendingRef.current.revision;
    startNextRef.current();
    return revision;
  }, [cancelDebounce, queueValue]);

  const retryCleanup = useCallback(() => {
    const failure = cleanupFailureRef.current;
    const persistence = recoveryPersistenceRef.current;
    if (!failure || !persistence || pendingRef.current) return;
    const cleanup = queueRecoveryOperation(async () => {
      await persistence.compareAndDelete(failure.generation);
    });
    void cleanup.then(() => {
      if (cleanupFailureRef.current !== failure) return;
      cleanupFailureRef.current = undefined;
      recoveryEntryRef.current = undefined;
      publish((current) => ({
        ...current,
        state: 'saved',
        dirty: false,
        savedAt: new Date(),
        error: undefined,
        errorAnnouncement: '',
      }));
      resolveFlushesIfClean();
    }, (error: unknown) => {
      if (cleanupFailureRef.current !== failure) return;
      cleanupFailureRef.current = { generation: failure.generation, error };
      publishFailure(error);
    });
  }, [publish, publishFailure, queueRecoveryOperation, resolveFlushesIfClean]);

  retryCleanupRef.current = retryCleanup;

  const retryWithMode = useCallback((mode?: SaveMode) => {
    cancelDebounce();
    const pending = pendingRef.current;
    if (!pending) {
      retryCleanupRef.current();
      return;
    }
    cleanupFailureRef.current = undefined;
    if (mode) pending.mode = mode;
    pending.ready = true;
    const entry = persistCurrentRecovery(true);
    if (!entry) startNextRef.current();
  }, [cancelDebounce, persistCurrentRecovery]);

  const retry = useCallback(() => retryWithMode(), [retryWithMode]);

  const forceRetry = useCallback(() => {
    if (!forceSaveRef.current) return;
    retryWithMode('force');
  }, [retryWithMode]);

  const flush = useCallback(() => {
    cancelDebounce();
    if (pendingRef.current) pendingRef.current.ready = true;
    if (isClean()) return Promise.resolve();

    const result = new Promise<void>((resolve, reject) => {
      waitersRef.current.push({ resolve, reject });
    });
    if (cleanupFailureRef.current && !pendingRef.current) {
      retryCleanupRef.current();
      return result;
    }
    if (recoveryEntryRef.current?.status === 'failed') persistCurrentRecovery(true);
    startNextRef.current();
    return result;
  }, [cancelDebounce, isClean, persistCurrentRecovery]);

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
