import type { PropsWithChildren } from 'react';
import { GuardedLink } from './navigationGuard';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <GuardedLink className="brand" to="/">Sound Passport</GuardedLink>
        <nav className="app-navigation" aria-label="主要導覽">
          <GuardedLink to="/">世界地圖</GuardedLink>
          <GuardedLink to="/studio">整理</GuardedLink>
        </nav>
        <span className="status-label">本機預覽</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
