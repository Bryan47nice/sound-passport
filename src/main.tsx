import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { bootstrapRepositoryServices } from './bootstrap';
import { openSoundPassportDb } from './data/indexedDb';
import { createIndexedDbJourneyRepository } from './data/indexedDbJourneyRepository';
import { RepositoryProvider, type RepositoryServices } from './data/RepositoryContext';
import { fixtureJourneyRepository } from './data/fixtureJourneyRepository';
import './styles/tokens.css';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

function renderApp(services: RepositoryServices) {
  root.render(
    <React.StrictMode>
      <RepositoryProvider services={services}>
        <BrowserRouter><App /></BrowserRouter>
      </RepositoryProvider>
    </React.StrictMode>,
  );
}

void bootstrapRepositoryServices({
  fixtureRepository: fixtureJourneyRepository,
  renderServices: renderApp,
  openDatabase: openSoundPassportDb,
  createPrivateRepository: (db) => createIndexedDbJourneyRepository({ db }),
});
