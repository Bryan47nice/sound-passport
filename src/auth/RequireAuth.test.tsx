import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthContext';
import { RequireAuth } from './RequireAuth';
import type { AuthPort, AuthUser } from './ports';

function authPort(user: AuthUser | null): AuthPort {
  return {
    observe: vi.fn((listener) => {
      listener(user);
      return vi.fn();
    }),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  };
}

function observerErrorPort(): AuthPort {
  return {
    observe: vi.fn((_listener, onError) => {
      onError(new Error('observer failed'));
      return vi.fn();
    }),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  };
}

function renderRoute(user: AuthUser | null) {
  return render(
    <AuthProvider port={authPort(user)}>
      <MemoryRouter initialEntries={['/studio']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="studio" element={<h1>創作工坊</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('RequireAuth', () => {
  afterEach(cleanup);

  it('keeps the protected route mounted and shows a sign-in wall for signed-out users', () => {
    renderRoute(null);

    expect(screen.getByRole('heading', { name: '登入以整理私人旅程' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 Google 登入' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '創作工坊' })).not.toBeInTheDocument();
  });

  it('renders the protected outlet for signed-in users', () => {
    renderRoute({ uid: 'user-a', displayName: '使用者 A', email: 'a@example.com', photoURL: null });

    expect(screen.getByRole('heading', { name: '創作工坊' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '登入以整理私人旅程' })).not.toBeInTheDocument();
  });

  it('renders a locked error instead of private or signed-out controls after observer failure', () => {
    render(
      <AuthProvider port={observerErrorPort()}>
        <MemoryRouter initialEntries={['/studio']}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="studio" element={<h1>創作工坊</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByRole('heading', { name: '無法確認登入狀態' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '創作工坊' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用 Google 登入' })).not.toBeInTheDocument();
  });
});
