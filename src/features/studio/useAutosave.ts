import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutosaveOptions<T> {
  value: T;
  save: (value: T) => Promise<void>;
  delay: number;
}

interface QueuedValue<T> {
  hasValue: boolean;
  value?: T;
}

export interface AutosaveResult<T> {
  state: AutosaveState;
  savedAt?: Date;
  errorAnnouncement: string;
  retry: () => void;
  saveNow: (value?: T) => void;
}

export function useAutosave<T>({ value, save, delay }: UseAutosaveOptions<T>): AutosaveResult<T> {
  const [state, setState] = useState<AutosaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date>();
  const [errorAnnouncement, setErrorAnnouncement] = useState('');
  const saveRef = useRef(save);
  const latestValueRef = useRef(value);
  const previousValueRef = useRef(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<QueuedValue<T>>({ hasValue: false });
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);

  saveRef.current = save;

  const runSave = useCallback((nextValue: T) => {
    latestValueRef.current = nextValue;
    if (inFlightRef.current) {
      queuedRef.current = { hasValue: true, value: nextValue };
      return;
    }

    inFlightRef.current = true;
    if (mountedRef.current) {
      setState('saving');
      setErrorAnnouncement('');
    }

    void Promise.resolve()
      .then(() => saveRef.current(nextValue))
      .then(() => {
        inFlightRef.current = false;
        if (queuedRef.current.hasValue) {
          const queuedValue = queuedRef.current.value as T;
          queuedRef.current = { hasValue: false };
          runSave(queuedValue);
          return;
        }
        if (mountedRef.current) {
          setSavedAt(new Date());
          setState('saved');
        }
      })
      .catch(() => {
        inFlightRef.current = false;
        queuedRef.current = { hasValue: false };
        if (mountedRef.current) {
          setState('error');
          setErrorAnnouncement('自動儲存失敗');
        }
      });
  }, []);

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current === undefined) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = undefined;
  }, []);

  const saveNow = useCallback((nextValue?: T) => {
    cancelDebounce();
    runSave(nextValue === undefined ? latestValueRef.current : nextValue);
  }, [cancelDebounce, runSave]);

  const retry = useCallback(() => {
    saveNow(latestValueRef.current);
  }, [saveNow]);

  useEffect(() => {
    latestValueRef.current = value;
    if (Object.is(previousValueRef.current, value)) return;
    previousValueRef.current = value;
    cancelDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      runSave(latestValueRef.current);
    }, delay);
  }, [cancelDebounce, delay, runSave, value]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;

    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      const cleanupLifecycle = lifecycleRef.current;
      queueMicrotask(() => {
        if (mountedRef.current || lifecycleRef.current !== cleanupLifecycle) return;
        if (debounceRef.current !== undefined) {
          cancelDebounce();
          runSave(latestValueRef.current);
        }
      });
    };
  }, [cancelDebounce, runSave]);

  return { state, savedAt, errorAnnouncement, retry, saveNow };
}
