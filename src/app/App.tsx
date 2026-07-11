import { Route, Routes } from 'react-router';
import { AtlasPage } from '../features/atlas/AtlasPage';
import { AppShell } from './AppShell';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route index element={<AtlasPage />} />
      </Routes>
    </AppShell>
  );
}
