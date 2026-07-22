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
const runtime = createFirebaseRuntime();
const authPort = runtime
  ? createFirebaseAuthPort(firebaseAuthDriver(runtime.auth))
  : createUnavailableAuthPort();

root.render(
  <React.StrictMode>
    <AuthProvider port={authPort}>
      <RepositorySessionProvider>
        <BrowserRouter><App /></BrowserRouter>
      </RepositorySessionProvider>
    </AuthProvider>
  </React.StrictMode>,
);
