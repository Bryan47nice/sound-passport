import { Route, Routes } from 'react-router';
import { RequireAuth } from '../auth/RequireAuth';
import { AtlasPage } from '../features/atlas/AtlasPage';
import { CountryPage } from '../features/country/CountryPage';
import { JourneyPage } from '../features/journey/JourneyPage';
import { JourneyPlayerPage } from '../features/player/JourneyPlayerPage';
import { JourneyCreatePage } from '../features/studio/JourneyCreatePage';
import { JourneyEditorPage } from '../features/studio/JourneyEditorPage';
import { JourneyPreviewPage } from '../features/studio/JourneyPreviewPage';
import { StudioPage } from '../features/studio/StudioPage';
import { AppShell } from './AppShell';
import { GuardedLink, NavigationGuardProvider, useGuardedRouteLocation } from './navigationGuard';

function AppRoutes() {
  const routeLocation = useGuardedRouteLocation();

  return (
    <AppShell>
      <Routes location={routeLocation}>
        <Route index element={<AtlasPage />} />
        <Route element={<RequireAuth />}>
          <Route path="studio" element={<StudioPage />} />
          <Route path="studio/journeys/new" element={<JourneyCreatePage />} />
          <Route path="studio/journeys/:journeyId/preview" element={<JourneyPreviewPage />} />
          <Route path="studio/journeys/:journeyId" element={<JourneyEditorPage />} />
        </Route>
        <Route path="countries/:countryCode" element={<CountryPage />} />
        <Route path="journeys/:journeyId/play" element={<JourneyPlayerPage />} />
        <Route path="journeys/:journeyId" element={<JourneyPage />} />
        <Route path="*" element={<section className="page empty-state"><h1>找不到這個頁面</h1><GuardedLink className="primary-command" to="/">回到世界地圖</GuardedLink></section>} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return <NavigationGuardProvider><AppRoutes /></NavigationGuardProvider>;
}
