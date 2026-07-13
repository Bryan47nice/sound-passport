import { ArrowLeft } from 'lucide-react';
import { Link, Route, Routes } from 'react-router';
import { AtlasPage } from '../features/atlas/AtlasPage';
import { CountryPage } from '../features/country/CountryPage';
import { JourneyPage } from '../features/journey/JourneyPage';
import { JourneyPlayerPage } from '../features/player/JourneyPlayerPage';
import { JourneyCreatePage } from '../features/studio/JourneyCreatePage';
import { StudioPage } from '../features/studio/StudioPage';
import { AppShell } from './AppShell';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route index element={<AtlasPage />} />
        <Route path="studio" element={<StudioPage />} />
        <Route path="studio/journeys/new" element={<JourneyCreatePage />} />
        <Route path="studio/journeys/:journeyId" element={(
          <section className="page studio-route-target">
            <p className="eyebrow">私人旅程</p>
            <h1 className="page-title">旅程編輯功能即將開放</h1>
            <p className="muted">旅程已建立，下一階段將在這裡提供完整編輯功能。</p>
            <Link className="primary-command" to="/studio">
              <ArrowLeft size={18} aria-hidden="true" />回到整理工作台
            </Link>
          </section>
        )} />
        <Route path="countries/:countryCode" element={<CountryPage />} />
        <Route path="journeys/:journeyId/play" element={<JourneyPlayerPage />} />
        <Route path="journeys/:journeyId" element={<JourneyPage />} />
        <Route path="*" element={<section className="page empty-state"><h1>找不到這個頁面</h1><Link className="primary-command" to="/">回到世界地圖</Link></section>} />
      </Routes>
    </AppShell>
  );
}
