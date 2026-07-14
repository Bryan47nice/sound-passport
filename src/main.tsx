import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { AuthProvider } from './auth/AuthContext';
import { createFirebaseAuthPort, createUnavailableAuthPort, firebaseAuthDriver } from './auth/firebaseAuthPort';
import { BackupService } from './backup/backupService';
import { bootstrapRepositoryServices } from './bootstrap';
import { openSoundPassportDb } from './data/indexedDb';
import { createIndexedDbJourneyRepository } from './data/indexedDbJourneyRepository';
import { RepositoryProvider, type RepositoryServices } from './data/RepositoryContext';
import { fixtureJourneyRepository } from './data/fixtureJourneyRepository';
import { createFirebaseRuntime } from './firebase/runtime';
import './styles/tokens.css';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const firebaseRuntime = createFirebaseRuntime();
const authPort = firebaseRuntime
  ? createFirebaseAuthPort(firebaseAuthDriver(firebaseRuntime.auth))
  : createUnavailableAuthPort();

function renderApp(services: RepositoryServices) {
  root.render(
    <React.StrictMode>
      <AuthProvider port={authPort}>
        <RepositoryProvider services={services}>
          <BrowserRouter><App /></BrowserRouter>
        </RepositoryProvider>
      </AuthProvider>
    </React.StrictMode>,
  );
}

void bootstrapRepositoryServices({
  fixtureRepository: fixtureJourneyRepository,
  renderServices: renderApp,
  openDatabase: openSoundPassportDb,
  createPrivateRepository: (db) => createIndexedDbJourneyRepository({ db }),
  createBackupService: (privateData) => new BackupService(privateData),
});
