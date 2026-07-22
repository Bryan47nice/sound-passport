import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { AuthProvider } from './auth/AuthContext';
import { createFirebaseAuthPort, createUnavailableAuthPort, firebaseAuthDriver } from './auth/firebaseAuthPort';
import { RepositorySessionProvider } from './data/RepositorySessionProvider';
import { createFirebaseRuntime } from './firebase/runtime';
import './styles/tokens.css';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

async function resolveAuthPort() {
  if (import.meta.env.MODE === 'e2e') {
    const { createE2eAuthPort } = await import('./auth/e2eAuthPort');
    return createE2eAuthPort();
  }
  const runtime = createFirebaseRuntime();
  return runtime
    ? createFirebaseAuthPort(firebaseAuthDriver(runtime.auth))
    : createUnavailableAuthPort();
}

function renderApp(authPort: Awaited<ReturnType<typeof resolveAuthPort>>) {
  root.render(
    <React.StrictMode>
      <AuthProvider port={authPort}>
        <RepositorySessionProvider>
          <BrowserRouter><App /></BrowserRouter>
        </RepositorySessionProvider>
      </AuthProvider>
    </React.StrictMode>,
  );
}

function renderBootstrapFailure(error: unknown) {
  console.error('Unable to bootstrap Sound Passport.', error);
  root.render(
    <main className="page auth-required">
      <h1 className="page-title">無法啟動 Sound Passport</h1>
      <p className="muted">請重新整理頁面後再試一次。</p>
    </main>,
  );
}

async function bootstrap() {
  try {
    renderApp(await resolveAuthPort());
  } catch (error) {
    renderBootstrapFailure(error);
  }
}

void bootstrap();
