import { CircleAlert, Globe2, LogIn, LogOut, X } from 'lucide-react';
import { type PropsWithChildren, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { GuardedLink, useGuardedAsyncCommand } from './navigationGuard';

export function AppShell({ children }: PropsWithChildren) {
  const { state, busy, commandError, clearCommandError, signInWithGoogle, signOut } = useAuth();
  const runGuardedCommand = useGuardedAsyncCommand();
  const [guardError, setGuardError] = useState('');
  const [signOutPending, setSignOutPending] = useState(false);
  const signOutPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const visibleError = guardError || commandError;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setGuardError('');
  }, [state]);

  const handleSignOut = async () => {
    if (signOutPendingRef.current) return;
    signOutPendingRef.current = true;
    setSignOutPending(true);
    setGuardError('');
    clearCommandError();
    try {
      await runGuardedCommand(signOut);
    } catch {
      if (mountedRef.current) {
        setGuardError('目前的變更無法儲存，因此尚未登出。請稍後再試一次。');
      }
    } finally {
      signOutPendingRef.current = false;
      if (mountedRef.current) setSignOutPending(false);
    }
  };

  const dismissError = () => {
    setGuardError('');
    clearCommandError();
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <GuardedLink className="brand" to="/">
          <span className="brand-passport-mark" aria-hidden="true">
            <Globe2 size={15} strokeWidth={1.8} />
          </span>
          <span className="brand-name">Sound Passport</span>
        </GuardedLink>
        <nav className="app-navigation" aria-label="主要導覽">
          <GuardedLink to="/">世界地圖</GuardedLink>
          <GuardedLink to="/studio">整理</GuardedLink>
        </nav>
        {state.kind === 'signed-out' && (
          <button className="header-auth-command" type="button" disabled={busy} onClick={() => void signInWithGoogle()}>
            <LogIn size={17} aria-hidden="true" />
            {busy ? '登入中...' : '使用 Google 登入'}
          </button>
        )}
        {state.kind === 'signed-in' && (
          <details className="account-menu">
            <summary aria-label="帳戶選單">
              {state.user.photoURL
                ? <img src={state.user.photoURL} alt="" referrerPolicy="no-referrer" />
                : <span aria-hidden="true">{(state.user.displayName ?? state.user.email ?? '使用者').slice(0, 1)}</span>}
            </summary>
            <div className="account-menu-popover">
              <strong>{state.user.displayName ?? state.user.email ?? '使用者'}</strong>
              <GuardedLink to="/demo">探索示範</GuardedLink>
              <button type="button" disabled={busy || signOutPending} onClick={() => void handleSignOut()}>
                <LogOut size={16} aria-hidden="true" />
                登出
              </button>
            </div>
          </details>
        )}
      </header>
      {visibleError && (
        <div className="auth-error-band" aria-live="assertive" aria-atomic="true">
          <CircleAlert size={17} aria-hidden="true" />
          <span>{visibleError}</span>
          <button type="button" aria-label="關閉登入錯誤" onClick={dismissError}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}
