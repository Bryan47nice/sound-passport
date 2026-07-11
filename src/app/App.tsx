import { Route, Routes } from 'react-router';
import { AtlasPage } from '../features/atlas/AtlasPage';
import { CountryPage } from '../features/country/CountryPage';
import { JourneyPage } from '../features/journey/JourneyPage';
import { AppShell } from './AppShell';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route index element={<AtlasPage />} />
        <Route path="countries/:countryCode" element={<CountryPage />} />
        <Route path="journeys/:journeyId" element={<JourneyPage />} />
      </Routes>
    </AppShell>
  );
}
