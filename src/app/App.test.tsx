import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthPort, AuthUser } from '../auth/ports';
import { fixtureJourneyRepository } from '../data/fixtureJourneyRepository';
import { RepositoryProvider, type RepositoryServices } from '../data/RepositoryContext';
import type { JourneyEditorRepository, JourneyRepository } from '../data/ports';
import { App } from './App';

vi.mock('../features/atlas/WorldMap', () => ({
  WorldMap: ({ countries }: { countries: Array<{ countryCode: string; countryName: string; journeyCount: number }> }) => (
    <div aria-label="world-map">{countries.map((country) => <span key={country.countryCode}>{country.countryName}:{country.journeyCount}</span>)}</div>
  ),
}));

type TestAuthPort = AuthPort & {
  signInWithGoogle: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

function createAuthPort(user: AuthUser | null): TestAuthPort {
  return {
    observe: vi.fn((listener) => {
      listener(user);
      return vi.fn();
    }),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  };
}

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

function renderApp({
  authPort = createAuthPort(null),
  initialEntries,
  services = { query: fixtureJourneyRepository },
}: {
  authPort?: TestAuthPort;
  initialEntries?: string[];
  services?: RepositoryServices;
} = {}) {
  return render(
    <AuthProvider port={authPort}>
      <RepositoryProvider services={services}>
        <MemoryRouter initialEntries={initialEntries}>
          <CurrentPath />
          <App />
        </MemoryRouter>
      </RepositoryProvider>
    </AuthProvider>,
  );
}

describe('App', () => {
  afterEach(cleanup);

  it('renders the shell and a Google sign-in command for signed-out users', async () => {
    renderApp();

    expect(screen.getByRole('banner')).toHaveTextContent('Sound Passport');
    expect(screen.getByRole('link', { name: 'Sound Passport' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: '使用 Google 登入' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(await screen.findByLabelText('world-map')).toBeInTheDocument();
    expect(screen.getByText('日本:2')).toBeInTheDocument();
  });

  it.each([
    '/studio',
    '/studio/journeys/new',
    '/studio/journeys/journey-a/preview',
    '/studio/journeys/journey-a',
  ])('keeps a signed-out Studio request at %s and shows the sign-in wall', (path) => {
    renderApp({ initialEntries: [path] });

    expect(screen.getByTestId('current-path')).toHaveTextContent(path);
    expect(screen.getByRole('heading', { name: '請先登入以使用創作工坊' })).toBeInTheDocument();
  });

  it('uses only the signed-in private repository on the root route', async () => {
    const privateRepository: JourneyRepository = {
      listCountrySummaries: vi.fn(async () => []),
      listJourneysByCountry: vi.fn(async () => []),
      getJourneyStory: vi.fn(async () => undefined),
    };

    renderApp({
      authPort: createAuthPort({ uid: 'user-a', displayName: 'Private User', email: 'private@example.com', photoURL: null }),
      services: { query: privateRepository, fixtures: fixtureJourneyRepository },
    });

    expect(await screen.findByRole('heading', { name: '還沒有私人旅程' })).toBeInTheDocument();
    expect(privateRepository.listCountrySummaries).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('日本')).not.toBeInTheDocument();
  });

  it('uses fixtures and labels the signed-in demo route as 探索示範', async () => {
    const privateRepository: JourneyRepository = {
      listCountrySummaries: vi.fn(async () => []),
      listJourneysByCountry: vi.fn(async () => []),
      getJourneyStory: vi.fn(async () => undefined),
    };

    renderApp({
      authPort: createAuthPort({ uid: 'user-a', displayName: 'Private User', email: 'private@example.com', photoURL: null }),
      initialEntries: ['/demo'],
      services: { query: privateRepository, fixtures: fixtureJourneyRepository },
    });

    expect(await screen.findByText('探索示範')).toBeInTheDocument();
    expect(await screen.findByText('日本')).toBeInTheDocument();
    expect(privateRepository.listCountrySummaries).not.toHaveBeenCalled();
  });

  it('renders a signed-in private preview through the existing Studio route', async () => {
    const fixtureStory = await fixtureJourneyRepository.getJourneyStory('seoul-2025');
    const privateStory = {
      ...fixtureStory!,
      journey: {
        ...fixtureStory!.journey,
        id: 'private-preview',
        title: 'Private Preview',
        source: 'private' as const,
        status: 'draft' as const,
      },
    };
    const editor: JourneyEditorRepository = {
      listPrivateJourneys: vi.fn(),
      createJourney: vi.fn(),
      updateJourney: vi.fn(),
      deleteJourney: vi.fn(),
      getPrivateJourneyStory: vi.fn(async () => privateStory),
      addMoments: vi.fn(),
      updateMoment: vi.fn(),
      deleteMoment: vi.fn(),
      reorderMoments: vi.fn(),
      setJourneyStatus: vi.fn(),
    };

    renderApp({
      authPort: createAuthPort({ uid: 'user-a', displayName: '使用者 A', email: 'a@example.com', photoURL: null }),
      initialEntries: ['/studio/journeys/private-preview/preview'],
      services: { query: fixtureJourneyRepository, editor },
    });

    expect(await screen.findByRole('heading', { name: 'Private Preview' })).toBeInTheDocument();
    expect(editor.getPrivateJourneyStory).toHaveBeenCalledWith('private-preview');
    expect(screen.queryByRole('heading', { name: '請先登入以使用創作工坊' })).not.toBeInTheDocument();
  });

  it('shows an accessible account menu and delegates its sign-out command', async () => {
    const user = userEvent.setup();
    const authPort = createAuthPort({ uid: 'user-a', displayName: '使用者 A', email: 'a@example.com', photoURL: null });
    renderApp({ authPort });

    await user.click(screen.getByLabelText('帳戶選單'));
    expect(screen.getByText('使用者 A')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '探索示範' })).toHaveAttribute('href', '/demo');
    await user.click(screen.getByRole('button', { name: '登出' }));

    expect(authPort.signOut).toHaveBeenCalledTimes(1);
  });

  it('renders the existing not-found route', () => {
    renderApp({ initialEntries: ['/not-found'] });

    expect(screen.getByRole('heading', { name: '找不到這個頁面' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到世界地圖' })).toHaveAttribute('href', '/');
  });
});
