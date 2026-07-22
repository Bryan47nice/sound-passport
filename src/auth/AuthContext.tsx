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

function authMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : error instanceof Error ? error.message : '';

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
    (user) => setState(user ? { kind: 'signed-in', user } : { kind: 'signed-out' }),
    () => setState({ kind: 'signed-out' }),
  ), [port]);

  const run = useCallback(async (command: () => Promise<void>) => {
    if (commandPending.current) return;

    commandPending.current = true;
    setBusy(true);
    setCommandError('');
    try {
      await command();
    } catch (error) {
      setCommandError(authMessage(error));
    } finally {
      commandPending.current = false;
      setBusy(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    busy,
    commandError,
    clearCommandError: () => setCommandError(''),
    signInWithGoogle: () => run(() => port.signInWithGoogle()),
    signOut: () => run(() => port.signOut()),
  }), [busy, commandError, port, run, state]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthContext is not available');
  return value;
}
