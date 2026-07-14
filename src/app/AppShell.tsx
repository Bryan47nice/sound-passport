import { Globe2 } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { GuardedLink } from './navigationGuard';

export function AppShell({ children }: PropsWithChildren) {
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
        <span className="status-label">本機預覽</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
