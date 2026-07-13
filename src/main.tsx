import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { createCombinedJourneyRepository } from './data/combinedJourneyRepository';
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

renderApp({ query: fixtureJourneyRepository });

void openSoundPassportDb()
  .then((db) => {
    const privateRepository = createIndexedDbJourneyRepository({ db });
    renderApp({
      query: createCombinedJourneyRepository(fixtureJourneyRepository, privateRepository),
      editor: privateRepository,
      photos: privateRepository,
      privateData: privateRepository,
    });
  })
  .catch(() => {
    // Fixture query pages remain available when IndexedDB cannot be opened.
  });
