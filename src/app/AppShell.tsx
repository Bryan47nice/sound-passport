import type { PropsWithChildren } from 'react';
import { Link } from 'react-router';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">Sound Passport</Link>
        <span className="status-label">LOCAL PREVIEW</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
