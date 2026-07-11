# Sound Passport 地圖回放垂直切片實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個可在手機與桌面瀏覽器操作的前端切片，讓使用者從世界地圖選國家、選旅程，再依順序播放照片、地點、歌曲與選歌原因。

**Architecture:** 使用 React + Vite 建立純前端應用程式，React Router 處理 browse-first 導覽，MapLibre GL JS 負責世界地圖。畫面只依賴唯讀 `JourneyRepository`，第一階段由 fixture adapter 提供資料，後續可替換成 Dexie 或 Firebase，而不修改 UI 與領域模型。

**Tech Stack:** React、TypeScript、Vite、React Router、MapLibre GL JS、Vitest、Testing Library、Playwright。

## Global Constraints

- 導覽固定為世界地圖 → 國家 → 旅程 → 播放。
- 點擊國家或進入旅程時不得自動播放聲音。
- YouTube iframe 必須使用 `youtube-nocookie.com` 並設定 `autoplay=0`。
- 第一階段只讀取 fixture 資料，不建立登入、寫入、分享或憑證。
- 第一階段使用 MapLibre 官方 demo style 進行開發驗證；正式發布前更換正式 tile provider。
- UI 文案以繁體中文為主；程式識別字使用英文。
- 所有固定格式元件必須有穩定尺寸，桌面與手機皆不得重疊或水平捲動。
- 依賴由 `package-lock.json` 固定，不提交 `.env`、使用者資料或本機工具。

## Scope Boundary

完成本計畫後，再依序建立獨立計畫：

1. Dexie、相片選擇器、三步驟快速記錄、離線草稿與 PWA。
2. Firebase Authentication、Firestore、Storage、Security Rules 與照片上傳。
3. YouTube Data API 搜尋、OAuth 與播放清單匯出。
4. 隱私處理後的公開快照、分享與取消發布。

---

## File Structure

```text
index.html
package.json
package-lock.json
playwright.config.ts
tsconfig.json
vite.config.ts
src/main.tsx
src/app/App.tsx
src/app/AppShell.tsx
src/domain/model.ts
src/domain/fixtures.ts
src/domain/countrySummary.ts
src/domain/youtube.ts
src/data/ports.ts
src/data/fixtureJourneyRepository.ts
src/data/RepositoryContext.tsx
src/features/atlas/AtlasPage.tsx
src/features/atlas/WorldMap.tsx
src/features/country/CountryPage.tsx
src/features/journey/JourneyPage.tsx
src/features/player/JourneyPlayerPage.tsx
src/features/player/YouTubeEmbed.tsx
src/styles/tokens.css
src/styles/global.css
src/test/setup.ts
e2e/atlas-playback.spec.ts
```

---

### Task 1: 建立 React、測試與樣式骨架

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/AppShell.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src/test/setup.ts`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `App(): JSX.Element`
- Produces: `AppShell({ children }): JSX.Element`
- Consumes: none

- [ ] **Step 1: 初始化並安裝依賴**

```powershell
npm.cmd init -y
npm.cmd install react react-dom react-router maplibre-gl
npm.cmd install -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test @types/react @types/react-dom
```

Expected: commands exit 0，`package-lock.json` 存在。

- [ ] **Step 2: 寫出失敗的 shell test**

Create `src/app/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the Sound Passport shell', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByRole('banner')).toHaveTextContent('Sound Passport');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 執行測試並確認失敗**

Run: `npm.cmd exec vitest run src/app/App.test.tsx`

Expected: FAIL，原因為 `App` 尚未存在。

- [ ] **Step 4: 建立完整設定與最小 shell**

Replace `package.json` scripts with:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

Create `index.html`:

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#173b33" />
    <title>Sound Passport</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts", "playwright.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Create `src/app/AppShell.tsx`:

```tsx
import type { PropsWithChildren } from 'react';
import { Link } from 'react-router';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">Sound Passport</Link>
        <span className="status-label">LOCAL PREVIEW</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

Create `src/app/App.tsx`:

```tsx
import { AppShell } from './AppShell';

export function App() {
  return (
    <AppShell>
      <section className="empty-state">
        <p className="eyebrow">YOUR TRAVEL SOUNDTRACK</p>
        <h1>世界地圖正在準備中</h1>
      </section>
    </AppShell>
  );
}
```

Create `src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </React.StrictMode>,
);
```

Create `src/styles/tokens.css`:

```css
:root {
  --ink: #18201d;
  --forest: #173b33;
  --paper: #f6f7f4;
  --surface: #ffffff;
  --line: #d8ddd9;
  --coral: #df513a;
  --yellow: #f3c950;
  --muted: #68736d;
  --radius: 6px;
  --content: 1180px;
}
```

Create `src/styles/global.css`:

```css
* { box-sizing: border-box; }
html { color: var(--ink); background: var(--paper); font-family: Inter, "Noto Sans TC", system-ui, sans-serif; }
body { margin: 0; min-width: 320px; }
a { color: inherit; text-decoration: none; }
button { font: inherit; }
.app-shell { min-height: 100vh; }
.app-header { height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: var(--surface); border-bottom: 1px solid var(--line); }
.brand { font-weight: 800; }
.status-label, .eyebrow { color: var(--coral); font-size: 11px; font-weight: 800; }
.empty-state { min-height: calc(100vh - 56px); display: grid; place-content: center; padding: 24px; text-align: center; }
.page { width: min(100% - 32px, var(--content)); margin: 0 auto; padding: 24px 0 48px; }
.page-title { margin: 0; font-size: clamp(28px, 5vw, 52px); letter-spacing: 0; }
.muted { color: var(--muted); }
```

- [ ] **Step 5: 驗證並 commit**

```powershell
npm.cmd run test:run -- src/app/App.test.tsx
npm.cmd run typecheck
npm.cmd run build
```

Expected: test PASS；typecheck/build exit 0。

```bash
git add package.json package-lock.json index.html tsconfig.json vite.config.ts src
git commit -m "Build Sound Passport app shell"
```

---

### Task 2: 建立領域模型、fixture 與唯讀 repository

**Files:**
- Create: `src/domain/model.ts`
- Create: `src/domain/fixtures.ts`
- Create: `src/domain/countrySummary.ts`
- Create: `src/data/ports.ts`
- Create: `src/data/fixtureJourneyRepository.ts`
- Create: `src/data/RepositoryContext.tsx`
- Test: `src/data/fixtureJourneyRepository.test.ts`

**Interfaces:**
- Produces: `Journey`, `Moment`, `SongReference`, `JourneyStory`, `CountrySummary`
- Produces: `JourneyRepository`
- Produces: `fixtureJourneyRepository`
- Consumes: none

- [ ] **Step 1: 寫出彙整與排序的失敗測試**

```ts
import { describe, expect, it } from 'vitest';
import { fixtureJourneyRepository } from '../data/fixtureJourneyRepository';

describe('fixtureJourneyRepository', () => {
  it('groups repeat visits and returns newest journey first', async () => {
    const countries = await fixtureJourneyRepository.listCountrySummaries();
    expect(countries.find((item) => item.countryCode === 'JP')?.journeyCount).toBe(2);
    expect((await fixtureJourneyRepository.listJourneysByCountry('JP')).map((item) => item.id)).toEqual([
      'tokyo-2024',
      'kyoto-2023',
    ]);
  });

  it('returns moments in curated order', async () => {
    const story = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    expect(story?.moments.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `npm.cmd run test:run -- src/data/fixtureJourneyRepository.test.ts`

Expected: FAIL，原因為 repository 尚未建立。

- [ ] **Step 3: 建立完整型別與資料**

Create `src/domain/model.ts`:

```ts
export interface SongReference {
  id: string;
  provider: 'youtube' | 'external' | 'manual';
  providerItemId?: string;
  sourceUrl?: string;
  title: string;
  artist: string;
  availability: 'available' | 'unavailable' | 'unknown';
}

export interface Journey {
  id: string;
  title: string;
  countryCode: string;
  countryName: string;
  countryCoordinates: [number, number];
  cityLabels: string[];
  startDate: string;
  endDate: string;
  status: 'active' | 'review' | 'complete';
}

export interface Moment {
  id: string;
  journeyId: string;
  songReferenceId: string;
  takenAt: string;
  placeLabel: string;
  cityLabel: string;
  reason: string;
  reasonStatus: 'complete' | 'needs_review';
  sortOrder: number;
}

export interface JourneyMoment extends Moment { song: SongReference; }
export interface JourneyStory { journey: Journey; moments: JourneyMoment[]; }
export interface CountrySummary {
  countryCode: string;
  countryName: string;
  coordinates: [number, number];
  journeyCount: number;
  latestJourneyTitle: string;
}
```

Create `src/domain/fixtures.ts`:

```ts
import type { Journey, Moment, SongReference } from './model';

export const fixtureJourneys: Journey[] = [
  { id: 'tokyo-2024', title: '東京，雨停之後', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895], cityLabels: ['東京'], startDate: '2024-10-03', endDate: '2024-10-08', status: 'complete' },
  { id: 'kyoto-2023', title: '京都，安靜的顏色', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895], cityLabels: ['京都'], startDate: '2023-04-10', endDate: '2023-04-15', status: 'complete' },
  { id: 'seoul-2025', title: '首爾，十月的夜', countryCode: 'KR', countryName: '韓國', countryCoordinates: [126.978, 37.5665], cityLabels: ['首爾'], startDate: '2025-10-12', endDate: '2025-10-17', status: 'complete' },
];

export const fixtureSongs: SongReference[] = [
  { id: 'song-tokyo-1', provider: 'youtube', providerItemId: 'M7lc1UVf-VE', sourceUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', title: 'Tokyo, after the rain', artist: 'Sound Passport Demo', availability: 'available' },
  { id: 'song-tokyo-2', provider: 'manual', title: 'Shibuya Night Walk', artist: 'Sound Passport Demo', availability: 'unknown' },
  { id: 'song-tokyo-3', provider: 'manual', title: 'Last Train Home', artist: 'Sound Passport Demo', availability: 'unknown' },
  { id: 'song-kyoto-1', provider: 'manual', title: 'Quiet Colors', artist: 'Sound Passport Demo', availability: 'unknown' },
  { id: 'song-seoul-1', provider: 'manual', title: 'Han River Night', artist: 'Sound Passport Demo', availability: 'unknown' },
];

export const fixtureMoments: Moment[] = [
  { id: 'tokyo-m1', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-1', takenAt: '2024-10-03T21:42:00+09:00', placeLabel: '澀谷十字路口', cityLabel: '東京', reason: '雨停後路面還在反光，整座城市像慢了下來。', reasonStatus: 'complete', sortOrder: 0 },
  { id: 'tokyo-m2', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-2', takenAt: '2024-10-04T22:10:00+09:00', placeLabel: '代代木公園', cityLabel: '東京', reason: '夜裡走得很慢，剛好需要一首不趕時間的歌。', reasonStatus: 'complete', sortOrder: 1 },
  { id: 'tokyo-m3', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-3', takenAt: '2024-10-08T18:20:00+09:00', placeLabel: '羽田機場', cityLabel: '東京', reason: '', reasonStatus: 'needs_review', sortOrder: 2 },
  { id: 'kyoto-m1', journeyId: 'kyoto-2023', songReferenceId: 'song-kyoto-1', takenAt: '2023-04-11T07:30:00+09:00', placeLabel: '鴨川', cityLabel: '京都', reason: '早晨的顏色很淡，適合留白。', reasonStatus: 'complete', sortOrder: 0 },
  { id: 'seoul-m1', journeyId: 'seoul-2025', songReferenceId: 'song-seoul-1', takenAt: '2025-10-14T20:00:00+09:00', placeLabel: '漢江公園', cityLabel: '首爾', reason: '風吹過河面時，城市的聲音退到了後面。', reasonStatus: 'complete', sortOrder: 0 },
];
```

Create `src/domain/countrySummary.ts`:

```ts
import type { CountrySummary, Journey } from './model';

export function summarizeCountries(journeys: Journey[]): CountrySummary[] {
  const groups = new Map<string, Journey[]>();
  journeys.forEach((journey) => {
    groups.set(journey.countryCode, [...(groups.get(journey.countryCode) ?? []), journey]);
  });

  return [...groups.values()]
    .map((items) => {
      const sorted = [...items].sort((a, b) => b.startDate.localeCompare(a.startDate));
      const latest = sorted[0];
      return {
        countryCode: latest.countryCode,
        countryName: latest.countryName,
        coordinates: latest.countryCoordinates,
        journeyCount: items.length,
        latestJourneyTitle: latest.title,
      };
    })
    .sort((a, b) => a.countryName.localeCompare(b.countryName, 'zh-TW'));
}
```

Create `src/data/ports.ts`:

```ts
import type { CountrySummary, Journey, JourneyStory } from '../domain/model';

export interface JourneyRepository {
  listCountrySummaries(): Promise<CountrySummary[]>;
  listJourneysByCountry(countryCode: string): Promise<Journey[]>;
  getJourneyStory(journeyId: string): Promise<JourneyStory | undefined>;
}
```

Create `src/data/fixtureJourneyRepository.ts`:

```ts
import { summarizeCountries } from '../domain/countrySummary';
import { fixtureJourneys, fixtureMoments, fixtureSongs } from '../domain/fixtures';
import type { JourneyRepository } from './ports';

export const fixtureJourneyRepository: JourneyRepository = {
  async listCountrySummaries() {
    return summarizeCountries(fixtureJourneys);
  },
  async listJourneysByCountry(countryCode) {
    return fixtureJourneys.filter((item) => item.countryCode === countryCode).sort((a, b) => b.startDate.localeCompare(a.startDate));
  },
  async getJourneyStory(journeyId) {
    const journey = fixtureJourneys.find((item) => item.id === journeyId);
    if (!journey) return undefined;
    const moments = fixtureMoments
      .filter((item) => item.journeyId === journeyId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((moment) => ({ ...moment, song: fixtureSongs.find((song) => song.id === moment.songReferenceId)! }));
    return { journey, moments };
  },
};
```

Create `src/data/RepositoryContext.tsx`:

```tsx
import { createContext, useContext, type PropsWithChildren } from 'react';
import type { JourneyRepository } from './ports';

const Context = createContext<JourneyRepository | null>(null);
export function RepositoryProvider({ repository, children }: PropsWithChildren<{ repository: JourneyRepository }>) {
  return <Context.Provider value={repository}>{children}</Context.Provider>;
}
export function useJourneyRepository() {
  const repository = useContext(Context);
  if (!repository) throw new Error('JourneyRepository is not available');
  return repository;
}
```

- [ ] **Step 4: 驗證並 commit**

```powershell
npm.cmd run test:run -- src/data/fixtureJourneyRepository.test.ts
npm.cmd run typecheck
```

Expected: tests PASS；typecheck exit 0。

```bash
git add src/domain src/data
git commit -m "Define fixture travel domain"
```

---

### Task 3: 建立 Map First Atlas 與路由注入

**Files:**
- Create: `src/features/atlas/WorldMap.tsx`
- Create: `src/features/atlas/AtlasPage.tsx`
- Test: `src/features/atlas/AtlasPage.test.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces route: `/`
- Produces: `WorldMap({ countries, onCountrySelect })`
- Consumes: `listCountrySummaries()`

- [ ] **Step 1: 寫出 Atlas 失敗測試**

Create `src/features/atlas/AtlasPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { AtlasPage } from './AtlasPage';

vi.mock('./WorldMap', () => ({
  WorldMap: ({ countries, onCountrySelect }: {
    countries: Array<{ countryCode: string; countryName: string; journeyCount: number }>;
    onCountrySelect: (countryCode: string) => void;
  }) => (
    <div aria-label="旅行世界地圖">
      {countries.map((country) => (
        <button key={country.countryCode} onClick={() => onCountrySelect(country.countryCode)}>
          {country.countryName}，{country.journeyCount} 趟旅程
        </button>
      ))}
    </div>
  ),
}));

function LocationProbe() {
  return <output aria-label="目前路徑">{useLocation().pathname}</output>;
}

describe('AtlasPage', () => {
  it('lists visited countries and opens the selected country', async () => {
    const user = userEvent.setup();
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<><AtlasPage /><LocationProbe /></>} />
            <Route path="/countries/:countryCode" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect((await screen.findAllByText('日本')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 趟旅程/).length).toBeGreaterThan(0);
    expect(screen.getByText('韓國')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '日本，2 趟旅程' }));
    expect(screen.getByLabelText('目前路徑')).toHaveTextContent('/countries/JP');
  });
});
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `npm.cmd run test:run -- src/features/atlas/AtlasPage.test.tsx`

Expected: FAIL，原因為 Atlas 尚未建立。

- [ ] **Step 3: 實作 WorldMap**

Create `src/features/atlas/WorldMap.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CountrySummary } from '../../domain/model';

export interface WorldMapProps {
  countries: CountrySummary[];
  onCountrySelect: (countryCode: string) => void;
}

export function WorldMap({ countries, onCountrySelect }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/globe.json',
      center: [20, 20],
      zoom: 1.1,
      attributionControl: true,
    });
    const markers = countries.map((country) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'country-marker';
      button.textContent = String(country.journeyCount);
      button.setAttribute('aria-label', `${country.countryName}，${country.journeyCount} 趟旅程`);
      button.addEventListener('click', () => onCountrySelect(country.countryCode));
      return new maplibregl.Marker({ element: button }).setLngLat(country.coordinates).addTo(map);
    });
    return () => {
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [countries, onCountrySelect]);

  return <div className="world-map" ref={containerRef} aria-label="旅行世界地圖" />;
}
```

Create `src/features/atlas/AtlasPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CountrySummary } from '../../domain/model';
import { useJourneyRepository } from '../../data/RepositoryContext';
import { WorldMap } from './WorldMap';

export function AtlasPage() {
  const repository = useJourneyRepository();
  const navigate = useNavigate();
  const [countries, setCountries] = useState<CountrySummary[]>();
  useEffect(() => { void repository.listCountrySummaries().then(setCountries); }, [repository]);
  const selectCountry = useCallback((code: string) => navigate(`/countries/${code}`), [navigate]);

  if (!countries) return <section className="page map-loading" aria-label="載入旅行地圖" />;
  if (countries.length === 0) return <section className="page empty-state"><h1>還沒有旅行</h1></section>;

  return (
    <section className="page">
      <p className="eyebrow">THE PLACES YOU HEARD</p>
      <h1 className="page-title">我的旅行世界</h1>
      <p className="muted">選一個國家，回到某一次旅程。</p>
      <WorldMap countries={countries} onCountrySelect={selectCountry} />
      <div className="country-index">
        {countries.map((country) => (
          <button className="country-row" key={country.countryCode} onClick={() => selectCountry(country.countryCode)}>
            <strong>{country.countryName}</strong><br />
            <span>{country.journeyCount} 趟旅程 · {country.latestJourneyTitle}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

Update global CSS with stable map styles:

```css
.world-map, .map-loading { width: 100%; min-height: 360px; height: min(68vh, 680px); border-radius: var(--radius); overflow: hidden; background: var(--forest); }
.country-marker { width: 34px; height: 34px; border: 2px solid white; border-radius: 50%; background: var(--yellow); color: var(--ink); font-weight: 800; cursor: pointer; }
.country-index { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1px; margin-top: 16px; border: 1px solid var(--line); background: var(--line); }
.country-row { min-height: 64px; padding: 12px 14px; background: var(--surface); border: 0; text-align: left; cursor: pointer; }
@media (max-width: 640px) { .world-map { min-height: 420px; height: calc(100vh - 220px); } }
```

Replace `src/app/App.tsx` with:

```tsx
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
```

Replace the root render in `src/main.tsx` with:

```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RepositoryProvider repository={fixtureJourneyRepository}>
      <BrowserRouter><App /></BrowserRouter>
    </RepositoryProvider>
  </React.StrictMode>,
);
```

Replace `src/app/App.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import { fixtureJourneyRepository } from '../data/fixtureJourneyRepository';
import { App } from './App';

vi.mock('../features/atlas/WorldMap', () => ({
  WorldMap: () => <div aria-label="旅行世界地圖" />,
}));

describe('App', () => {
  it('renders the Sound Passport shell', async () => {
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
        <MemoryRouter><App /></MemoryRouter>
      </RepositoryProvider>,
    );
    expect(screen.getByRole('banner')).toHaveTextContent('Sound Passport');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(await screen.findByLabelText('旅行世界地圖')).toBeInTheDocument();
  });
});
```

At the top of `src/main.tsx`, add:

```tsx
import { RepositoryProvider } from './data/RepositoryContext';
import { fixtureJourneyRepository } from './data/fixtureJourneyRepository';
```

- [ ] **Step 4: 驗證並 commit**

```powershell
npm.cmd run test:run -- src/features/atlas/AtlasPage.test.tsx
npm.cmd run typecheck
npm.cmd run build
```

Expected: test PASS；typecheck/build exit 0。

```bash
git add src/features/atlas src/app/App.tsx src/main.tsx src/styles/global.css
git commit -m "Build map-first travel atlas"
```

---

### Task 4: 建立國家與旅程 browse-first 頁面

**Files:**
- Create: `src/features/country/CountryPage.tsx`
- Create: `src/features/journey/JourneyPage.tsx`
- Test: `src/features/country/CountryPage.test.tsx`
- Test: `src/features/journey/JourneyPage.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces route: `/countries/:countryCode`
- Produces route: `/journeys/:journeyId`
- Consumes: `listJourneysByCountry()` and `getJourneyStory()`

- [ ] **Step 1: 寫出 A1 flow 失敗測試**

Create `src/features/country/CountryPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { CountryPage } from './CountryPage';

describe('CountryPage', () => {
  it('shows repeat visits without starting media', async () => {
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
        <MemoryRouter initialEntries={['/countries/JP']}>
          <Routes><Route path="/countries/:countryCode" element={<CountryPage />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '日本' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /東京，雨停之後/ })).toHaveAttribute('href', '/journeys/tokyo-2024');
    expect(screen.getByRole('link', { name: /京都，安靜的顏色/ })).toHaveAttribute('href', '/journeys/kyoto-2023');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });
});
```

Create `src/features/journey/JourneyPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { JourneyPage } from './JourneyPage';

describe('JourneyPage', () => {
  it('shows curated moments and a deliberate play command', async () => {
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
        <MemoryRouter initialEntries={['/journeys/tokyo-2024']}>
          <Routes><Route path="/journeys/:journeyId" element={<JourneyPage />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByRole('heading', { name: '東京，雨停之後' })).toBeInTheDocument();
    const moments = screen.getAllByRole('listitem');
    expect(moments).toHaveLength(3);
    expect(moments[0]).toHaveTextContent('澀谷十字路口');
    expect(moments[1]).toHaveTextContent('代代木公園');
    expect(moments[2]).toHaveTextContent('羽田機場');
    expect(screen.getByText('旅後待補')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /播放這趟旅程/ })).toHaveAttribute('href', '/journeys/tokyo-2024/play');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 執行測試並確認失敗**

```powershell
npm.cmd run test:run -- src/features/country/CountryPage.test.tsx src/features/journey/JourneyPage.test.tsx
```

Expected: FAIL，pages 尚未存在。

- [ ] **Step 3: 實作 CountryPage**

Create `src/features/country/CountryPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useJourneyRepository } from '../../data/RepositoryContext';
import type { Journey } from '../../domain/model';

export function CountryPage() {
  const { countryCode = '' } = useParams();
  const repository = useJourneyRepository();
  const [journeys, setJourneys] = useState<Journey[]>();
  useEffect(() => { void repository.listJourneysByCountry(countryCode).then(setJourneys); }, [countryCode, repository]);
  if (!journeys) return <section className="page" aria-label="載入國家旅程" />;
  if (journeys.length === 0) return <section className="page"><h1>找不到這個國家的旅程</h1></section>;
  return (
    <section className="page">
      <p className="eyebrow">{journeys.length} JOURNEYS</p>
      <h1 className="page-title">{journeys[0].countryName}</h1>
      <div className="journey-list">
        {journeys.map((journey) => (
          <Link className="journey-row" key={journey.id} to={`/journeys/${journey.id}`}>
            <span><strong>{journey.title}</strong><small>{journey.startDate} – {journey.endDate}</small></span>
            <span>{journey.cityLabels.join('、')}</span>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 實作 JourneyPage**

Create `src/features/journey/JourneyPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useJourneyRepository } from '../../data/RepositoryContext';
import type { JourneyStory } from '../../domain/model';

export function JourneyPage() {
  const { journeyId = '' } = useParams();
  const repository = useJourneyRepository();
  const [story, setStory] = useState<JourneyStory>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { void repository.getJourneyStory(journeyId).then((value) => { setStory(value); setLoaded(true); }); }, [journeyId, repository]);
  if (!loaded) return <section className="page" aria-label="載入旅程" />;
  if (!story) return <section className="page"><h1>找不到這趟旅程</h1></section>;
  return (
    <section className="page">
      <p className="eyebrow">{story.journey.countryName} · {story.journey.startDate}</p>
      <h1 className="page-title">{story.journey.title}</h1>
      <Link className="primary-command" to={`/journeys/${story.journey.id}/play`}>▶ 播放這趟旅程</Link>
      <ol className="moment-list">
        {story.moments.map((moment) => (
          <li className="moment-row" key={moment.id}>
            <span>{String(moment.sortOrder + 1).padStart(2, '0')}</span>
            <span><strong>{moment.cityLabel} · {moment.placeLabel}</strong><small>{moment.song.title} · {moment.song.artist}</small></span>
            <p>{moment.reason || '旅後待補'}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

Replace `src/app/App.tsx` with:

```tsx
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
```

Append to `src/styles/global.css`:

```css
.journey-list { margin-top: 24px; border-top: 1px solid var(--line); }
.journey-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(100px, 180px) 24px; gap: 16px; align-items: center; min-height: 82px; border-bottom: 1px solid var(--line); }
.journey-row strong, .journey-row small { display: block; }
.journey-row small { margin-top: 5px; color: var(--muted); }
.primary-command { display: inline-flex; align-items: center; min-height: 44px; margin-top: 20px; padding: 0 16px; border-radius: var(--radius); background: var(--coral); color: white; font-weight: 800; }
.moment-list { margin: 32px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
.moment-row { display: grid; grid-template-columns: 42px minmax(190px, 1fr) minmax(220px, 1.4fr); gap: 16px; align-items: start; min-height: 96px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.moment-row strong, .moment-row small { display: block; }
.moment-row small { margin-top: 5px; color: var(--muted); }
.moment-row p { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .journey-row { grid-template-columns: minmax(0, 1fr) 20px; }
  .journey-row > span:nth-child(2) { display: none; }
  .moment-row { grid-template-columns: 32px minmax(0, 1fr); }
  .moment-row p { grid-column: 2; }
}
```

- [ ] **Step 5: 驗證並 commit**

```powershell
npm.cmd run test:run -- src/features/country/CountryPage.test.tsx src/features/journey/JourneyPage.test.tsx
npm.cmd run typecheck
```

Expected: tests PASS；no-autoplay assertion PASS。

```bash
git add src/features/country src/features/journey src/app/App.tsx src/styles/global.css
git commit -m "Add country and journey browsing"
```

---

### Task 5: 建立受控旅行故事播放器

**Files:**
- Create: `src/domain/youtube.ts`
- Create: `src/features/player/YouTubeEmbed.tsx`
- Create: `src/features/player/JourneyPlayerPage.tsx`
- Test: `src/domain/youtube.test.ts`
- Test: `src/features/player/JourneyPlayerPage.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `parseYouTubeVideoId(value): string | undefined`
- Produces: `buildYouTubeEmbedUrl(videoId): string`
- Produces route: `/journeys/:journeyId/play`
- Consumes: `getJourneyStory()`

- [ ] **Step 1: 寫出 URL 與播放器失敗測試**

Create `src/domain/youtube.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildYouTubeEmbedUrl, parseYouTubeVideoId } from './youtube';

describe('YouTube adapter', () => {
  it.each([
    ['https://www.youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://youtu.be/M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://www.youtube.com/shorts/M7lc1UVf-VE', 'M7lc1UVf-VE'],
  ])('extracts a video id from %s', (url, expected) => {
    expect(parseYouTubeVideoId(url)).toBe(expected);
  });

  it('rejects non-YouTube and malformed URLs', () => {
    expect(parseYouTubeVideoId('https://example.com/watch?v=123')).toBeUndefined();
    expect(parseYouTubeVideoId('not a url')).toBeUndefined();
  });

  it('builds a privacy-enhanced embed with autoplay disabled', () => {
    const url = buildYouTubeEmbedUrl('M7lc1UVf-VE');
    expect(url).toContain('youtube-nocookie.com');
    expect(url).toContain('autoplay=0');
  });
});
```

Create `src/features/player/JourneyPlayerPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import { JourneyPlayerPage } from './JourneyPlayerPage';

describe('JourneyPlayerPage', () => {
  it('changes moments only after explicit controls are used', async () => {
    const user = userEvent.setup();
    render(
      <RepositoryProvider repository={fixtureJourneyRepository}>
        <MemoryRouter initialEntries={['/journeys/tokyo-2024/play']}>
          <Routes><Route path="/journeys/:journeyId/play" element={<JourneyPlayerPage />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    );

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    const iframe = screen.getByTitle('YouTube player');
    expect(iframe).toHaveAttribute('src', expect.stringContaining('autoplay=0'));
    expect(iframe.getAttribute('allow') ?? '').not.toContain('autoplay');
    expect(screen.getByRole('button', { name: '上一個時刻' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '下一個時刻' }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('代代木公園')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '上一個時刻' }));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 執行測試並確認失敗**

```powershell
npm.cmd run test:run -- src/domain/youtube.test.ts src/features/player/JourneyPlayerPage.test.tsx
```

Expected: FAIL，parser/player 尚未存在。

- [ ] **Step 3: 實作 YouTube adapter**

Create `src/domain/youtube.ts`:

```ts
export function parseYouTubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0];
    if (url.hostname.endsWith('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v') ?? undefined;
      const [kind, id] = url.pathname.split('/').filter(Boolean);
      if (kind === 'shorts' || kind === 'embed') return id;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function buildYouTubeEmbedUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=0&playsinline=1`;
}
```

Create `src/features/player/YouTubeEmbed.tsx`:

```tsx
import type { SongReference } from '../../domain/model';
import { buildYouTubeEmbedUrl, parseYouTubeVideoId } from '../../domain/youtube';

export function YouTubeEmbed({ song }: { song: SongReference }) {
  const id = song.providerItemId ?? (song.sourceUrl ? parseYouTubeVideoId(song.sourceUrl) : undefined);
  if (song.provider === 'youtube' && id) {
    return <iframe title="YouTube player" src={buildYouTubeEmbedUrl(id)} allow="encrypted-media; picture-in-picture" allowFullScreen />;
  }
  return (
    <div className="song-fallback">
      <strong>{song.title}</strong><span>{song.artist}</span>
      {song.sourceUrl && <a href={song.sourceUrl} target="_blank" rel="noreferrer">開啟歌曲來源</a>}
    </div>
  );
}
```

- [ ] **Step 4: 實作 JourneyPlayerPage**

Create `src/features/player/JourneyPlayerPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useJourneyRepository } from '../../data/RepositoryContext';
import type { JourneyStory } from '../../domain/model';
import { YouTubeEmbed } from './YouTubeEmbed';

export function JourneyPlayerPage() {
  const { journeyId = '' } = useParams();
  const repository = useJourneyRepository();
  const [story, setStory] = useState<JourneyStory>();
  const [currentIndex, setCurrentIndex] = useState(0);
  useEffect(() => { setCurrentIndex(0); void repository.getJourneyStory(journeyId).then(setStory); }, [journeyId, repository]);
  if (!story) return <section className="page" aria-label="載入播放器" />;
  const moment = story.moments[currentIndex];
  if (!moment) return <section className="page"><h1>這趟旅程沒有音樂時刻</h1></section>;
  return (
    <section className="page player-page">
      <p className="eyebrow">{story.journey.title}</p>
      <div className="player-stage">
        <div className="player-media"><YouTubeEmbed song={moment.song} /></div>
        <div className="player-copy">
          <span className="player-counter">{currentIndex + 1} / {story.moments.length}</span>
          <h1>{moment.cityLabel} · {moment.placeLabel}</h1>
          <h2>{moment.song.title}</h2>
          <p>{moment.reason || '旅後待補'}</p>
        </div>
      </div>
      <div className="player-controls">
        <button disabled={currentIndex === 0} onClick={() => setCurrentIndex((value) => value - 1)}>上一個時刻</button>
        <button disabled={currentIndex === story.moments.length - 1} onClick={() => setCurrentIndex((value) => value + 1)}>下一個時刻</button>
      </div>
    </section>
  );
}
```

Replace `src/app/App.tsx` with:

```tsx
import { Route, Routes } from 'react-router';
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
        <Route path="journeys/:journeyId" element={<JourneyPage />} />
        <Route path="journeys/:journeyId/play" element={<JourneyPlayerPage />} />
      </Routes>
    </AppShell>
  );
}
```

Append to `src/styles/global.css`:

```css
.player-stage { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.8fr); min-height: 430px; margin-top: 12px; background: var(--surface); border: 1px solid var(--line); }
.player-media { min-width: 0; display: grid; place-items: center; background: #111513; }
.player-media iframe { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; }
.song-fallback { display: grid; gap: 8px; width: min(100% - 40px, 440px); color: white; }
.song-fallback a { color: var(--yellow); }
.player-copy { min-width: 0; padding: 28px; align-self: center; overflow-wrap: anywhere; }
.player-copy h1 { margin: 12px 0 0; font-size: 28px; letter-spacing: 0; }
.player-copy h2 { margin: 16px 0 0; font-size: 18px; letter-spacing: 0; }
.player-copy p { margin: 20px 0 0; line-height: 1.7; }
.player-counter { color: var(--coral); font-size: 12px; font-weight: 800; }
.player-controls { display: flex; justify-content: space-between; gap: 12px; margin-top: 14px; }
.player-controls button { min-width: 132px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); cursor: pointer; }
.player-controls button:disabled { cursor: default; opacity: 0.45; }
@media (max-width: 760px) {
  .player-stage { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .player-copy { padding: 22px 18px; }
  .player-controls button { min-width: 0; flex: 1; }
}
```

- [ ] **Step 5: 驗證並 commit**

```powershell
npm.cmd run test:run -- src/domain/youtube.test.ts src/features/player/JourneyPlayerPage.test.tsx
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
```

Expected: all tests PASS；typecheck/build exit 0。

```bash
git add src/domain/youtube.ts src/domain/youtube.test.ts src/features/player src/app/App.tsx src/styles/global.css
git commit -m "Add controlled journey player"
```

---

### Task 6: 完成 E2E、響應式驗證與文件

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/atlas-playback.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: Atlas → Country → Journey → Player E2E coverage
- Consumes: Tasks 1-5

- [ ] **Step 1: 建立 Playwright config**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm.cmd run build && npm.cmd exec vite preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: 寫出完整使用者流程**

Create `e2e/atlas-playback.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('revisits a journey from the map without autoplay', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('旅行世界地圖')).toBeVisible();
  await page.getByRole('button', { name: /日本，2 趟旅程/ }).click();
  await page.getByRole('link', { name: /東京，雨停之後/ }).click();
  await page.getByRole('link', { name: '▶ 播放這趟旅程' }).click();
  await expect(page.getByText('1 / 3')).toBeVisible();
  await expect(page.getByTitle('YouTube player')).toHaveAttribute('src', /autoplay=0/);
  await page.getByRole('button', { name: '下一個時刻' }).click();
  await expect(page.getByText('2 / 3')).toBeVisible();
});

test('has no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```

- [ ] **Step 3: 更新 README**

Append this section to `README.md`:

```markdown
## 本機執行

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run test:run
npm.cmd run test:e2e
```

目前版本使用示範 fixture 資料，完成「世界地圖 → 國家 → 旅程 → 播放」唯讀流程。尚未包含快速記錄、PWA 安裝、Firebase 同步、YouTube 搜尋／匯出與公開分享。
```

- [ ] **Step 4: 執行完整驗證**

```powershell
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
```

Expected: unit tests PASS；typecheck/build exit 0；desktop and mobile E2E both PASS。

Start `npm.cmd run dev -- --host 127.0.0.1` and use Playwright screenshots at 1440x900 and 390x844 to verify:

- map canvas is nonblank;
- country markers are clickable;
- no UI or text overlap;
- country → journey → player works;
- iframe never auto-plays on navigation;
- longest Traditional Chinese labels fit their containers;
- no horizontal scrolling.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e README.md
git commit -m "Verify atlas playback slice"
```

---

## Final Verification

```powershell
git status -sb
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```

Required result:

- working tree clean;
- all unit and E2E tests pass;
- build succeeds;
- desktop and mobile both complete map-first A1 navigation;
- no media auto-plays during navigation;
- no credentials or personal travel records are tracked by Git。

## Reference Documentation

- Vite: https://vite.dev/guide/
- React Router declarative routing: https://reactrouter.com/start/declarative/routing
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs
- Vitest: https://vitest.dev/guide/
- Product spec: `docs/superpowers/specs/2026-07-11-sound-passport-design-zh-TW.md`
