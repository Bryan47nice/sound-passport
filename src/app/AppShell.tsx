import type { PropsWithChildren } from 'react';
import { Link } from 'react-router';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">Sound Passport</Link>
        <nav className="app-navigation" aria-label="主要導覽">
          <Link to="/">世界地圖</Link>
          <Link to="/studio">整理</Link>
        </nav>
        <span className="status-label">本機預覽</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
