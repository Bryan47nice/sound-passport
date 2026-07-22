import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import type { AuthPort, AuthUser } from './ports';

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'observer-failed'; message: string }
  | { kind: 'signed-in'; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  busy: boolean;
  commandError: string;
  clearCommandError(): void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

const Context = createContext<AuthContextValue | null>(null);
export const AUTH_OBSERVER_ERROR_MESSAGE = '無法確認登入狀態。請檢查網路連線後再試一次。';

type AuthCommand = 'sign-in' | 'sign-out';

function authMessage(error: unknown, command: AuthCommand) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : error instanceof Error ? error.message : '';

  if (command === 'sign-out') return '登出失敗，私人資料仍保持登入狀態。請再試一次。';
  if (code === 'auth/popup-blocked') return '瀏覽器封鎖了登入視窗。請允許彈出式視窗後再試一次。';
  if (code === 'auth/popup-closed-by-user') return '你已關閉登入視窗，請再試一次。';
  if (code === 'FIREBASE_NOT_CONFIGURED') return 'Google 登入目前尚未設定。';
  return '登入時發生問題，請再試一次。';
}

export function AuthProvider({ port, children }: PropsWithChildren<{ port: AuthPort }>) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState('');
  const commandPending = useRef(false);

  useEffect(() => port.observe(
    (user) => {
      setState(user ? { kind: 'signed-in', user } : { kind: 'signed-out' });
      setCommandError('');
    },
    () => {
      setState({ kind: 'observer-failed', message: AUTH_OBSERVER_ERROR_MESSAGE });
      setCommandError(AUTH_OBSERVER_ERROR_MESSAGE);
    },
  ), [port]);

  const run = useCallback(async (kind: AuthCommand, command: () => Promise<void>) => {
    if (commandPending.current) return;

    commandPending.current = true;
    setBusy(true);
    setCommandError('');
    try {
      await command();
    } catch (error) {
      setCommandError(authMessage(error, kind));
    } finally {
      commandPending.current = false;
      setBusy(false);
    }
  }, []);

  const clearCommandError = useCallback(() => setCommandError(''), []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    busy,
    commandError,
    clearCommandError,
    signInWithGoogle: () => run('sign-in', () => port.signInWithGoogle()),
    signOut: () => run('sign-out', () => port.signOut()),
  }), [busy, clearCommandError, commandError, port, run, state]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthContext is not available');
  return value;
}
