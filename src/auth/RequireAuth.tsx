import { LogIn } from 'lucide-react';
import { Outlet } from 'react-router';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const { state, busy, commandError, signInWithGoogle } = useAuth();

  if (state.kind === 'loading') {
    return <section className="page" aria-label="正在確認登入狀態" />;
  }

  if (state.kind === 'signed-in') return <Outlet />;

  return (
    <section className="page auth-required">
      <h1 className="page-title">請先登入以使用創作工坊</h1>
      <p className="muted">登入後即可建立、編輯及預覽你的旅程。</p>
      <button className="primary-command" type="button" disabled={busy} onClick={() => void signInWithGoogle()}>
        <LogIn size={17} aria-hidden="true" />
        {busy ? '登入中...' : '使用 Google 登入'}
      </button>
      {commandError && <p className="field-error" role="alert">{commandError}</p>}
    </section>
  );
}
