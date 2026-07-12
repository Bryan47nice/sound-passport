import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { RepositoryProvider } from './data/RepositoryContext';
import { fixtureJourneyRepository } from './data/fixtureJourneyRepository';
import './styles/tokens.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RepositoryProvider repository={fixtureJourneyRepository}>
      <BrowserRouter><App /></BrowserRouter>
    </RepositoryProvider>
  </React.StrictMode>,
);
