import { Link, Route, Routes } from 'react-router';
import { AtlasPage } from '../features/atlas/AtlasPage';
import { CountryPage } from '../features/country/CountryPage';
import { JourneyPage } from '../features/journey/JourneyPage';
import { JourneyPlayerPage } from '../features/player/JourneyPlayerPage';
import { AppShell } from './AppShell';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route index element={<AtlasPage />} />
        <Route path="countries/:countryCode" element={<CountryPage />} />
        <Route path="journeys/:journeyId/play" element={<JourneyPlayerPage />} />
        <Route path="journeys/:journeyId" element={<JourneyPage />} />
        <Route path="*" element={<section className="page empty-state"><h1>找不到這個頁面</h1><Link className="primary-command" to="/">回到世界地圖</Link></section>} />
      </Routes>
    </AppShell>
  );
}
