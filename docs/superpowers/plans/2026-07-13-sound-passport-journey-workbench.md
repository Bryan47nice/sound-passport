# Sound Passport Journey Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-first, local-only journey workbench that persists private trips and photos in IndexedDB, supports complete backup/restore, and feeds completed journeys into the existing Atlas and player.

**Architecture:** Keep read/query behavior separate from editing. `IndexedDbJourneyRepository` implements private editing and storage ports, while `CombinedJourneyRepository` merges read-only fixtures with completed private journeys for Atlas and playback. Photo normalization, object-URL lifecycle, and backup packaging remain focused services behind explicit ports.

**Tech Stack:** React 19, React Router 8, TypeScript 5.9, Vite 8, Vitest 4, Testing Library, Playwright, `idb`, `fake-indexeddb`, `fflate`, `world-countries`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, and `lucide-react`.

## Global Constraints

- Use Traditional Chinese for all new visible UI copy.
- Store private records and normalized photo blobs only in IndexedDB; never add personal records, backups, or database dumps to Git.
- Accept input files up to 25 MiB; normalize non-transparent images to WebP quality 0.9 and cap the long edge at 2560px.
- Preserve image aspect ratio and orientation; use `object-fit: contain` for the editor and player.
- HEIC/HEIF conversion is out of scope; reject files that the browser cannot decode with a clear message.
- Text autosave debounce is exactly 500ms; immediate actions save without debounce.
- Status lifecycle is `draft -> review -> complete`; only complete private journeys appear in Atlas.
- Missing caption, reason, or YouTube URL never blocks completion; missing image, date, title, or artist does.
- YouTube must use `youtube-nocookie.com`, `autoplay=0`, and no autoplay permission.
- Mobile Studio is read-only guidance; Atlas, country, journey, and player remain fully usable at 390x844.
- Backup extension is `.soundpassport`; imports validate schema, relationships, photo sizes, SHA-256, and write atomically.
- Every task follows red-green-refactor TDD, ends with focused tests, and receives specification plus quality review before the next task.

---

### Task 1: Domain Models, Country Catalog, and Completion Rules

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/domain/model.ts`
- Modify: `src/domain/fixtures.ts`
- Modify: `src/domain/dateTime.ts`
- Modify: `src/domain/dateTime.test.ts`
- Create: `src/domain/countryCatalog.ts`
- Create: `src/domain/countryCatalog.test.ts`
- Create: `src/domain/journeyValidation.ts`
- Create: `src/domain/journeyValidation.test.ts`
- Modify: `src/data/ports.ts`

**Interfaces:**
- Produces: `Journey`, `Moment`, `PhotoAsset`, `PrivateJourneySnapshot`, `NewJourney`, `JourneyPatch`, `MomentPatch`
- Produces: `listCountries(): CountryOption[]`, `findCountry(code): CountryOption | undefined`
- Produces: `validateJourneyForReview(story): JourneyValidationResult`
- Produces: separated `JourneyRepository`, `JourneyEditorRepository`, `PhotoAssetRepository`, and `PrivateDataPort`

- [ ] **Step 1: Install planned dependencies**

Run:

```powershell
npm.cmd install idb fflate world-countries @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities lucide-react
npm.cmd install --save-dev fake-indexeddb
```

Expected: both commands exit 0 and update `package.json` plus `package-lock.json`.

- [ ] **Step 2: Write failing country and completion tests**

Create `src/domain/countryCatalog.test.ts` with assertions that:

```ts
import { describe, expect, it } from 'vitest';
import { findCountry, listCountries } from './countryCatalog';

describe('countryCatalog', () => {
  it('returns every country with a zh-TW label and MapLibre coordinate order', () => {
    const countries = listCountries();
    expect(countries.length).toBeGreaterThan(190);
    expect(countries.every((country) => country.code.length === 2)).toBe(true);
    expect(findCountry('JP')).toMatchObject({ code: 'JP', name: '日本' });
    expect(findCountry('JP')?.coordinates[0]).toBeGreaterThan(120);
    expect(findCountry('JP')?.coordinates[1]).toBeGreaterThan(20);
  });
});
```

Create `src/domain/journeyValidation.test.ts` with a fully constructed valid story and these cases:

```ts
expect(validateJourneyForReview(validStory)).toEqual({ valid: true, issues: [] });
expect(validateJourneyForReview({ ...validStory, journey: { ...validStory.journey, title: '' } }).issues)
  .toContainEqual({ field: 'title', code: 'required' });
expect(validateJourneyForReview({ ...validStory, moments: [] }).issues)
  .toContainEqual({ field: 'moments', code: 'at_least_one' });
expect(validateJourneyForReview(storyWithoutYoutube)).toEqual({ valid: true, issues: [] });
expect(validateJourneyForReview(storyWithMomentOutsideRange).issues)
  .toContainEqual({ field: 'moments.0.localDate', code: 'outside_journey_range' });
```

- [ ] **Step 3: Run the tests and verify red state**

Run:

```powershell
npm.cmd run test:run -- src/domain/countryCatalog.test.ts src/domain/journeyValidation.test.ts src/domain/dateTime.test.ts
```

Expected: FAIL because the catalog, new model fields, and validator do not exist.

- [ ] **Step 4: Implement domain contracts and validation**

Replace the relevant contracts in `src/domain/model.ts` with the approved shapes. Use local wall-clock fields rather than inferred time zones:

```ts
export type JourneyStatus = 'draft' | 'review' | 'complete';
export type SongAvailability = 'available' | 'invalid_link' | 'needs_link';

export interface Journey {
  id: string;
  title: string;
  countryCode: string;
  countryName: string;
  countryCoordinates: [number, number];
  cityLabels: string[];
  startDate: string;
  endDate: string;
  summary: string;
  coverPhotoAssetId?: string;
  status: JourneyStatus;
  createdAt: string;
  updatedAt: string;
  source: 'fixture' | 'private';
}

export interface SongReference {
  id: string;
  provider: 'youtube' | 'manual';
  providerItemId?: string;
  sourceUrl?: string;
  title: string;
  artist: string;
  availability: SongAvailability;
}

export interface Moment {
  id: string;
  journeyId: string;
  photoAssetId?: string;
  photoUrl?: string;
  photoAlt: string;
  songReferenceId: string;
  localDate: string;
  localTime?: string;
  cityLabel: string;
  placeLabel: string;
  caption: string;
  reason: string;
  reasonStatus: 'complete' | 'needs_review';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoAsset {
  id: string;
  blob: Blob;
  contentType: string;
  originalFileName: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}
```

Add these exact input and snapshot types in the same file. Photo entries retain `Blob` in memory and become files only inside backup packaging.

```ts
export type NewJourney = Pick<Journey,
  'title' | 'countryCode' | 'countryName' | 'countryCoordinates' |
  'cityLabels' | 'startDate' | 'endDate' | 'summary'
>;

export type JourneyPatch = Partial<Pick<Journey,
  'title' | 'countryCode' | 'countryName' | 'countryCoordinates' |
  'cityLabels' | 'startDate' | 'endDate' | 'summary' |
  'coverPhotoAssetId' | 'status'
>>;

export type MomentPatch = Partial<Pick<Moment,
  'localDate' | 'localTime' | 'cityLabel' | 'placeLabel' | 'caption' |
  'reason' | 'reasonStatus' | 'photoAlt'
>> & {
  song?: Pick<SongReference, 'title' | 'artist' | 'sourceUrl'>;
};

export type NormalizedPhotoInput = Pick<PhotoAsset,
  'blob' | 'contentType' | 'originalFileName' | 'width' | 'height' | 'byteSize'
>;

export interface PrivateJourneySnapshot {
  journeys: Journey[];
  moments: Moment[];
  songs: SongReference[];
  photos: PhotoAsset[];
}
```

Implement `src/domain/countryCatalog.ts` using `world-countries`, `Intl.DisplayNames('zh-TW', { type: 'region' })`, and conversion from dataset `[latitude, longitude]` to MapLibre `[longitude, latitude]`. Sort with `localeCompare('zh-TW')` and cache the resulting immutable array.

Implement `validateJourneyForReview` as a pure function. Required fields are journey title/country/date range, at least one moment, and each moment's photo reference or fixture URL, date, song title, and artist. Optional copy, reason, place detail, local time, and YouTube URL produce no blocking issue.

Update fixtures to include `summary`, timestamps, `source: 'fixture'`, `localDate`, `localTime`, and the new song availability values. Update date formatting to accept `(localDate: string, localTime?: string)` and never convert time zones.

Update `src/data/ports.ts` with exact separated interfaces:

```ts
export interface JourneyRepository {
  listCountrySummaries(): Promise<CountrySummary[]>;
  listJourneysByCountry(countryCode: string): Promise<Journey[]>;
  getJourneyStory(journeyId: string): Promise<JourneyStory | undefined>;
}

export interface JourneyEditorRepository {
  listPrivateJourneys(): Promise<Journey[]>;
  createJourney(input: NewJourney): Promise<Journey>;
  updateJourney(id: string, patch: JourneyPatch): Promise<Journey>;
  deleteJourney(id: string): Promise<void>;
  getPrivateJourneyStory(id: string): Promise<JourneyStory | undefined>;
  addMoments(journeyId: string, photos: NormalizedPhotoInput[]): Promise<Moment[]>;
  updateMoment(id: string, patch: MomentPatch): Promise<Moment>;
  deleteMoment(id: string): Promise<void>;
  reorderMoments(journeyId: string, orderedIds: string[]): Promise<void>;
  setJourneyStatus(id: string, status: JourneyStatus): Promise<Journey>;
}

export interface PhotoAssetRepository {
  getPhotoAsset(id: string): Promise<PhotoAsset | undefined>;
}

export interface PrivateDataPort {
  exportSnapshot(): Promise<PrivateJourneySnapshot>;
  importSnapshot(snapshot: PrivateJourneySnapshot): Promise<void>;
  clearPrivateData(): Promise<void>;
}
```

- [ ] **Step 5: Run focused and regression tests**

Run:

```powershell
npm.cmd run test:run -- src/domain/countryCatalog.test.ts src/domain/journeyValidation.test.ts src/domain/dateTime.test.ts
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add package.json package-lock.json src/domain src/data/ports.ts
git commit -m "Add journey workbench domain contracts"
```

---

### Task 2: IndexedDB Schema and Private Repository

**Files:**
- Create: `src/data/indexedDb.ts`
- Create: `src/data/indexedDbJourneyRepository.ts`
- Create: `src/data/indexedDbJourneyRepository.test.ts`
- Create: `src/test/indexedDb.ts`

**Interfaces:**
- Consumes: Task 1 domain types and editor/storage ports
- Produces: `openSoundPassportDb(name?)`, `deleteSoundPassportDb(name?)`
- Produces: `createIndexedDbJourneyRepository(options): IndexedDbJourneyRepository`
- Produces: editor CRUD, private snapshot reads/writes, and photo blob retrieval

- [ ] **Step 1: Add an isolated IndexedDB test harness**

Create `src/test/indexedDb.ts`:

```ts
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';

export function uniqueDbName(testName: string) {
  return `sound-passport-test-${testName}-${crypto.randomUUID()}`;
}

export async function cleanupDb(name: string) {
  await deleteDB(name);
}
```

- [ ] **Step 2: Write failing repository integration tests**

Cover these exact behaviors in `indexedDbJourneyRepository.test.ts`:

- New journey starts as `draft`, `source: 'private'`, and survives closing/reopening the database.
- Updates preserve unrelated fields and refresh `updatedAt`.
- Adding two normalized photos creates two moments, songs, and photo assets in selection order.
- Reorder rejects missing or foreign IDs and writes contiguous `sortOrder` values.
- Deleting one moment removes its unreferenced song and photo in the same transaction.
- Deleting a journey removes its moments, songs, and photos atomically.
- Query methods expose only `complete` journeys while editor methods expose every private status.
- `exportSnapshot()` returns all private records; `importSnapshot()` rolls back when one record violates a relationship.
- A synthetic legacy version 1 database upgrades to current version 2 without losing records; migration 2 adds indexes and fills missing `source`, `summary`, `createdAt`, and `updatedAt` defaults.

- [ ] **Step 3: Run the repository test and verify red state**

```powershell
npm.cmd run test:run -- src/data/indexedDbJourneyRepository.test.ts
```

Expected: FAIL because database modules do not exist.

- [ ] **Step 4: Implement schema and transactions**

Define a typed `DBSchema` in `indexedDb.ts` and set `DB_VERSION = 2`. Migration 1 creates `journeys`, `moments`, `songs`, and `photos`; migration 2 creates `countryCode`, `status`, `journeyId`, and `[journeyId, sortOrder]` indexes and cursor-backfills legacy journey metadata. Await every operation and `tx.done`, matching the official `idb` transaction pattern.

Implement repository methods with these invariants:

```ts
const stores = ['journeys', 'moments', 'songs', 'photos'] as const;

async function runWrite<T>(work: (tx: IDBPTransaction<SoundPassportDb, typeof stores, 'readwrite'>) => Promise<T>) {
  const tx = db.transaction(stores, 'readwrite');
  const result = await work(tx);
  await tx.done;
  return result;
}
```

Use `crypto.randomUUID()` for IDs. Reject invalid reorder sets before opening the write transaction. Map `QuotaExceededError` to a typed `StorageCapacityError`, but preserve the original error as `cause`.

`getJourneyStory` joins moments and songs without synthesizing object URLs. Private moments return `photoAssetId`; fixtures continue to use `photoUrl`.

- [ ] **Step 5: Verify repository behavior and regression suite**

```powershell
npm.cmd run test:run -- src/data/indexedDbJourneyRepository.test.ts
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: repository tests, all existing tests, and typecheck PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/data src/test/indexedDb.ts
git commit -m "Persist private journeys in IndexedDB"
```

---

### Task 3: Combined Queries and Application Services

**Files:**
- Create: `src/data/combinedJourneyRepository.ts`
- Create: `src/data/combinedJourneyRepository.test.ts`
- Modify: `src/data/RepositoryContext.tsx`
- Modify: `src/data/fixtureJourneyRepository.ts`
- Modify: `src/main.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: fixture query repository and IndexedDB query/editor repository
- Produces: `createCombinedJourneyRepository(...repositories): JourneyRepository`
- Produces: `RepositoryServices` and hooks `useJourneyRepository`, `useJourneyEditorRepository`, `usePhotoAssetRepository`, `usePrivateDataPort`

- [ ] **Step 1: Write failing combined-query tests**

Create two in-memory query stubs and verify:

```ts
expect(await combined.listJourneysByCountry('JP')).toEqual([
  expect.objectContaining({ id: 'private-newer', source: 'private' }),
  expect.objectContaining({ id: 'fixture-older', source: 'fixture' }),
]);
expect(await combined.getJourneyStory('private-newer')).toEqual(privateStory);
expect(await combined.getJourneyStory('fixture-older')).toEqual(fixtureStory);
expect(await combined.listCountrySummaries()).toContainEqual(expect.objectContaining({
  countryCode: 'JP', journeyCount: 2, latestJourneyTitle: privateStory.journey.title,
}));
```

Also test duplicate journey IDs fail fast instead of silently shadowing data.

- [ ] **Step 2: Run the combined-query test and verify red state**

```powershell
npm.cmd run test:run -- src/data/combinedJourneyRepository.test.ts src/app/App.test.tsx
```

Expected: FAIL because combined services and the new provider shape do not exist.

- [ ] **Step 3: Implement query composition and service context**

Aggregate journeys, sort by descending start date, and recompute country summaries from the merged complete list. Do not sum precomputed country counts.

Use this provider shape:

```ts
export interface RepositoryServices {
  query: JourneyRepository;
  editor?: JourneyEditorRepository;
  photos?: PhotoAssetRepository;
  privateData?: PrivateDataPort;
}

export function RepositoryProvider({ services, children }: PropsWithChildren<{ services: RepositoryServices }>) {
  return <Context.Provider value={services}>{children}</Context.Provider>;
}
```

Each hook throws a specific error only when its requested service is absent. Update existing tests to pass `{ query: fixtureJourneyRepository }`.

In `main.tsx`, create one IndexedDB repository, combine it with fixtures for reads, and inject the local repository for editor/photo/private-data ports. Opening failures must leave fixture query pages usable; Studio will display the typed unavailable state in Task 6.

- [ ] **Step 4: Run tests and typecheck**

```powershell
npm.cmd run test:run -- src/data/combinedJourneyRepository.test.ts src/app/App.test.tsx
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/data src/main.tsx src/app/App.test.tsx
git commit -m "Combine fixture and private journey queries"
```

---

### Task 4: Photo Normalization and Object-URL Lifecycle

**Files:**
- Create: `src/media/photoNormalizer.ts`
- Create: `src/media/photoNormalizer.test.ts`
- Create: `src/media/usePhotoAssetUrl.ts`
- Create: `src/media/usePhotoAssetUrl.test.tsx`
- Create: `src/media/JourneyPhoto.tsx`
- Modify: `src/features/journey/JourneyPage.tsx`
- Modify: `src/features/journey/JourneyPage.test.tsx`
- Modify: `src/features/player/JourneyPlayerPage.tsx`
- Modify: `src/features/player/JourneyPlayerPage.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `normalizePhoto(file: File): Promise<NormalizedPhotoInput>`
- Produces: `PhotoNormalizationError` codes `too_large`, `unsupported_type`, `decode_failed`, `encode_failed`
- Produces: `usePhotoAssetUrl(photoAssetId?, fixtureUrl?)`
- Produces: reusable `JourneyPhoto` component

- [ ] **Step 1: Write failing validation and lifecycle tests**

Test pure preflight rules without canvas:

```ts
expect(() => validatePhotoFile(new File([], 'empty.jpg', { type: 'image/jpeg' })))
  .toThrowError(expect.objectContaining({ code: 'decode_failed' }));
expect(() => validatePhotoFile(fileOfSize(25 * 1024 * 1024 + 1)))
  .toThrowError(expect.objectContaining({ code: 'too_large' }));
expect(() => validatePhotoFile(new File(['x'], 'notes.txt', { type: 'text/plain' })))
  .toThrowError(expect.objectContaining({ code: 'unsupported_type' }));
```

Mock `createImageBitmap`, canvas `toBlob`, `URL.createObjectURL`, and `URL.revokeObjectURL` to prove normalization caps 4000x2000 to 2560x1280 and the hook revokes the previous URL on asset change and unmount.

- [ ] **Step 2: Run focused tests and verify red state**

```powershell
npm.cmd run test:run -- src/media/photoNormalizer.test.ts src/media/usePhotoAssetUrl.test.tsx
```

Expected: FAIL because media modules do not exist.

- [ ] **Step 3: Implement browser-local normalization**

Use `createImageBitmap(file, { imageOrientation: 'from-image' })`, an offscreen canvas created with `document.createElement('canvas')`, and `canvas.toBlob`. Keep PNG only when transparency must be preserved; otherwise encode `image/webp` at 0.9. Always close the bitmap in `finally`.

The hook must handle cancellation:

```ts
useEffect(() => {
  let active = true;
  let objectUrl: string | undefined;
  if (!photoAssetId) { setUrl(fixtureUrl); return; }
  void photos.getPhotoAsset(photoAssetId).then((asset) => {
    if (!active || !asset) return;
    objectUrl = URL.createObjectURL(asset.blob);
    setUrl(objectUrl);
  });
  return () => {
    active = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}, [photoAssetId, fixtureUrl, photos]);
```

Replace direct moment `<img>` usage in journey and player pages with `JourneyPhoto`. Set player and editor imagery to `object-fit: contain`; retain fixed responsive stage dimensions so portrait images do not shift controls.

- [ ] **Step 4: Run media, journey, player, and regression tests**

```powershell
npm.cmd run test:run -- src/media src/features/journey src/features/player
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add src/media src/features/journey src/features/player src/styles/global.css
git commit -m "Normalize and render private journey photos"
```

---

### Task 5: Versioned Backup and Atomic Restore

**Files:**
- Create: `src/backup/backupManifest.ts`
- Create: `src/backup/backupManifest.test.ts`
- Create: `src/backup/backupService.ts`
- Create: `src/backup/backupService.test.ts`
- Modify: `src/data/ports.ts`

**Interfaces:**
- Produces: `BackupService.exportBackup(): Promise<Blob>`
- Produces: `BackupService.planImport(file): Promise<ImportPlan>`
- Produces: `BackupService.commitImport(plan): Promise<ImportResult>`
- Produces: `BackupService.clearPrivateData(): Promise<void>`
- Produces: typed errors `invalid_container`, `unsupported_version`, `invalid_manifest`, `missing_photo`, `checksum_mismatch`, `relationship_error`

- [ ] **Step 1: Write failing manifest tests**

Use a snapshot with one journey, two moments, two songs, and two photos. Assert:

```ts
const blob = await service.exportBackup();
expect(blob.type).toBe('application/vnd.sound-passport.backup');
const plan = await service.planImport(new File([blob], 'backup.soundpassport'));
expect(plan.summary).toEqual({ journeys: 1, moments: 2, photos: 2 });
expect(plan.snapshot.journeys[0].id).toBe(originalJourneyId);
```

Add independent cases for a wrong format identifier, version 999, absent photo, one-byte photo corruption, dangling song reference, empty-database ID preservation, and existing-database collision remapping of every foreign key.

- [ ] **Step 2: Run backup tests and verify red state**

```powershell
npm.cmd run test:run -- src/backup
```

Expected: FAIL because backup modules do not exist.

- [ ] **Step 3: Implement manifest validation and ZIP packaging**

Use this top-level manifest contract:

```ts
export const BACKUP_FORMAT = 'sound-passport';
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  appVersion: string;
  journeys: Journey[];
  moments: Moment[];
  songs: SongReference[];
  photos: Array<Omit<PhotoAsset, 'blob'> & { path: string; sha256: string }>;
}
```

Use asynchronous `fflate.zip` and `fflate.unzip`. Store already compressed photo formats with compression level 0. Compute SHA-256 with `crypto.subtle.digest('SHA-256', bytes)` and compare lowercase hexadecimal strings.

`planImport` performs all parsing, type checks, relationship checks, checksums, and collision remapping without writing. `commitImport` passes the validated snapshot to one `PrivateDataPort.importSnapshot` transaction. Never expose a public method that writes an unvalidated manifest.

- [ ] **Step 4: Run backup and repository integration tests**

```powershell
npm.cmd run test:run -- src/backup src/data/indexedDbJourneyRepository.test.ts
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
git add src/backup src/data/ports.ts
git commit -m "Add private journey backup and restore"
```

---

### Task 6: Studio Dashboard and Journey Creation

**Files:**
- Create: `src/features/studio/StudioPage.tsx`
- Create: `src/features/studio/StudioPage.test.tsx`
- Create: `src/features/studio/JourneyCreatePage.tsx`
- Create: `src/features/studio/JourneyCreatePage.test.tsx`
- Create: `src/features/studio/studioFilters.ts`
- Create: `src/features/studio/studioFilters.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: editor repository and country catalog
- Produces routes `/studio` and `/studio/journeys/new`
- Produces mutually exclusive `draft`, `review`, and `complete` dashboard filters

- [ ] **Step 1: Write failing Studio route and behavior tests**

Render with an in-memory editor stub and assert:

- Header has visible links named `世界地圖` and `整理`.
- `/studio` defaults to `草稿` and displays only draft private journeys.
- Tabs `草稿`, `待整理`, `已完成` are mutually exclusive.
- Each row exposes title, country, date, moment count, missing YouTube count, and last update.
- `新增旅程` navigates to `/studio/journeys/new`.
- On a 390px matchMedia result, Studio shows `請使用電腦整理旅程` and no editable form.
- Country and date validation prevents creation; successful creation navigates to `/studio/journeys/:id`.

- [ ] **Step 2: Run Studio tests and verify red state**

```powershell
npm.cmd run test:run -- src/features/studio src/app/App.test.tsx
```

Expected: FAIL because Studio routes do not exist.

- [ ] **Step 3: Implement dashboard and creation flow**

Use semantic tabs and an unframed table/list layout. Buttons use Lucide icons: `Plus`, `Download`, `Upload`, and `Trash2`; icon-only controls include `title` and accessible names.

Creation form fields are title, country, start date, end date, cities, and summary. Country is a native searchable datalist backed by `countryCatalog`; selecting a country writes code, localized name, and `[longitude, latitude]` together. Cities use an input plus Add button and removable chips.

Keep backup buttons disabled with a `即將可用` tooltip until Task 10 wires them; do not add fake successful actions.

- [ ] **Step 4: Run Studio and regression tests**

```powershell
npm.cmd run test:run -- src/features/studio src/app/App.test.tsx
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add src/features/studio src/app src/styles/global.css
git commit -m "Add private journey Studio dashboard"
```

---

### Task 7: Journey Editor and Reliable Autosave

**Files:**
- Create: `src/features/studio/JourneyEditorPage.tsx`
- Create: `src/features/studio/JourneyEditorPage.test.tsx`
- Create: `src/features/studio/useAutosave.ts`
- Create: `src/features/studio/useAutosave.test.tsx`
- Create: `src/features/studio/JourneyDetailsForm.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces route `/studio/journeys/:journeyId`
- Produces `useAutosave({ value, save, delay: 500 })`
- Produces save states `idle | saving | saved | error`

- [ ] **Step 1: Write failing autosave tests with fake timers**

Prove these exact sequences:

```ts
await user.type(titleInput, '東京秋天');
expect(save).not.toHaveBeenCalled();
await vi.advanceTimersByTimeAsync(499);
expect(save).not.toHaveBeenCalled();
await vi.advanceTimersByTimeAsync(1);
expect(save).toHaveBeenCalledTimes(1);
```

Also prove a second edit cancels only the pending debounce, save calls are serialized, failed saves retain current form values, Retry reuses the latest value, `aria-live` announces error once, and unmount flushes a pending value.

- [ ] **Step 2: Write failing editor route tests**

Assert the top journey fields render, direct reload retrieves persisted data, missing private ID shows a not-found state, and changing a required field on a complete journey demotes it to `review` with a visible explanation.

- [ ] **Step 3: Run focused tests and verify red state**

```powershell
npm.cmd run test:run -- src/features/studio/useAutosave.test.tsx src/features/studio/JourneyEditorPage.test.tsx
```

Expected: FAIL because the hook and editor do not exist.

- [ ] **Step 4: Implement editor shell and autosave**

The editor uses one local draft state and sends minimal `JourneyPatch` objects. Immediate controls call `saveNow`; text fields use the 500ms debounce. Display `儲存中`, `已儲存 HH:mm:ss`, or `儲存失敗` in one stable-width status region.

Before saving a complete journey, combine the pending journey patch with current moments and call `validateJourneyForReview`. If it becomes invalid, include `status: 'review'` in the same update and show `必要資料已移除，旅程已回到待整理`.

- [ ] **Step 5: Run editor and regression tests**

```powershell
npm.cmd run test:run -- src/features/studio
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 7**

```powershell
git add src/features/studio src/app/App.tsx src/styles/global.css
git commit -m "Add autosaving journey editor"
```

---

### Task 8: Batch Moments, Editing, and Accessible Reordering

**Files:**
- Create: `src/features/studio/MomentList.tsx`
- Create: `src/features/studio/MomentList.test.tsx`
- Create: `src/features/studio/MomentEditor.tsx`
- Create: `src/features/studio/MomentEditor.test.tsx`
- Create: `src/features/studio/PhotoDropzone.tsx`
- Create: `src/features/studio/PhotoDropzone.test.tsx`
- Modify: `src/features/studio/JourneyEditorPage.tsx`
- Modify: `src/features/studio/JourneyEditorPage.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `normalizePhoto`, editor repository, `useAutosave`
- Produces batch upload, partial failure report, selected-moment form, DnD reorder, move buttons, and moment deletion

- [ ] **Step 1: Write failing batch upload tests**

Supply three files where two normalizations resolve and one rejects. Assert two moments are created in original selection order, the first success is selected, and the failure list contains the exact filename plus localized reason. Assert no repository call occurs when every file fails.

- [ ] **Step 2: Write failing editor and ordering tests**

Assert separate fields for `時刻文案` and `選歌原因`; song title and artist are required for completion while YouTube is optional. Verify invalid YouTube produces `連結格式不正確` but preserves the other fields.

For ordering, test both pointer-independent buttons and DnD callback:

```ts
await user.click(screen.getByRole('button', { name: '將第二則上移' }));
expect(reorderMoments).toHaveBeenCalledWith(journeyId, [secondId, firstId, thirdId]);
expect(screen.getAllByRole('option').map((item) => item.dataset.id)).toEqual([secondId, firstId, thirdId]);
```

Deletion requires confirmation and selects the nearest remaining moment afterward.

- [ ] **Step 3: Run focused tests and verify red state**

```powershell
npm.cmd run test:run -- src/features/studio/PhotoDropzone.test.tsx src/features/studio/MomentList.test.tsx src/features/studio/MomentEditor.test.tsx
```

Expected: FAIL because moment components do not exist.

- [ ] **Step 4: Implement three-pane moment workflow**

Use `DndContext`, pointer plus keyboard sensors, `SortableContext`, `useSortable`, and `verticalListSortingStrategy`. Pass the rendered ID order to `SortableContext` exactly. On drag end, use `arrayMove` and immediately persist the full ordered ID array.

The stable desktop grid is `minmax(220px, 0.7fr) minmax(320px, 1.2fr) minmax(300px, 0.9fr)`. The center image uses `JourneyPhoto` and `object-fit: contain`. At narrower desktop widths, stack the preview above the form; at mobile widths, retain the Task 6 read-only message.

Moment text uses the same 500ms autosave hook. Date, time, move, delete, and file operations persist immediately. Map YouTube parse results to `available`, `needs_link`, or `invalid_link` without discarding title and artist.

- [ ] **Step 5: Run Studio, media, and regression tests**

```powershell
npm.cmd run test:run -- src/features/studio src/media
npm.cmd run test:run
npm.cmd run typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 8**

```powershell
git add src/features/studio src/styles/global.css
git commit -m "Add batch moment editing and ordering"
```

---

### Task 9: Review, Completion, Atlas Integration, and Deletion

**Files:**
- Create: `src/features/studio/JourneyPreviewPage.tsx`
- Create: `src/features/studio/JourneyPreviewPage.test.tsx`
- Create: `src/features/studio/CompletionDialog.tsx`
- Create: `src/features/studio/CompletionDialog.test.tsx`
- Modify: `src/features/studio/JourneyEditorPage.tsx`
- Modify: `src/features/studio/StudioPage.tsx`
- Modify: `src/features/atlas/AtlasPage.test.tsx`
- Modify: `src/features/country/CountryPage.test.tsx`
- Modify: `src/features/journey/JourneyPage.tsx`
- Modify: `src/features/player/JourneyPlayerPage.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces `/studio/journeys/:journeyId/preview`
- Produces explicit `draft -> review -> complete` transition and atomic cascade delete
- Consumes combined query repository so completion immediately updates Atlas and playback routes

- [ ] **Step 1: Write failing preview and completion tests**

Assert preview loads draft stories through the editor port, never mutates status on mount, and never creates an autoplay-enabled iframe. `前往預覽` moves a valid draft to `review`; invalid drafts remain `draft` and focus the first failing field.

Assert `完成旅程` is available only from valid `review`, changes status to `complete`, and navigates to `/journeys/:id`. A fixture journey never displays edit or delete controls.

- [ ] **Step 2: Write failing query integration tests**

Seed a private review journey and verify it is absent from Atlas and country queries. Set it complete and verify country count, latest journey title, journey detail copy, moment caption, and player sequence. Remove a required song title from the completed journey and verify the same save demotes it and removes it from Atlas.

- [ ] **Step 3: Run focused tests and verify red state**

```powershell
npm.cmd run test:run -- src/features/studio/JourneyPreviewPage.test.tsx src/features/studio/CompletionDialog.test.tsx src/features/atlas src/features/country
```

Expected: FAIL because status actions and preview route do not exist.

- [ ] **Step 4: Implement review, completion, and deletion**

Reuse player presentation components without routing drafts through public journey URLs. Show journey summary before the moment sequence. For missing YouTube, render song title/artist and `尚未連結 YouTube`, never an empty iframe.

Deletion dialog names the journey and states that its moments and photos will be deleted. On confirm, call one repository cascade transaction and return to Studio. Clear query caches or trigger a repository revision context so Atlas refreshes without a full browser reload.

- [ ] **Step 5: Run focused and full verification**

```powershell
npm.cmd run test:run -- src/features/studio src/features/atlas src/features/country src/features/journey src/features/player
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
```

Expected: all tests PASS; typecheck and build exit 0.

- [ ] **Step 6: Commit Task 9**

```powershell
git add src/features src/app/App.tsx src/styles/global.css
git commit -m "Publish completed private journeys to Atlas"
```

---

### Task 10: Backup, Restore, and Private Data Controls

**Files:**
- Create: `src/features/studio/BackupControls.tsx`
- Create: `src/features/studio/BackupControls.test.tsx`
- Create: `src/features/studio/ImportBackupDialog.tsx`
- Create: `src/features/studio/ImportBackupDialog.test.tsx`
- Create: `src/features/studio/ClearPrivateDataDialog.tsx`
- Create: `src/features/studio/ClearPrivateDataDialog.test.tsx`
- Modify: `src/features/studio/StudioPage.tsx`
- Modify: `src/data/RepositoryContext.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: Task 5 `BackupService`
- Produces browser download, validated import summary/confirmation, and typed clear-all confirmation

- [ ] **Step 1: Write failing backup-control tests**

Mock the backup service and URL APIs. Assert export creates a filename matching `sound-passport-YYYY-MM-DD.soundpassport`, clicks one temporary anchor, revokes the URL, and visibly warns that the file contains private photos and text.

For import, assert an invalid plan displays the typed localized error and never calls `commitImport`. A valid plan displays exact journey/moment/photo counts and requires confirmation before commit. Success refreshes Studio data.

For clear-all, assert the destructive button remains disabled until the user enters `清除我的私人旅程`; fixtures remain available after the private repository is cleared.

- [ ] **Step 2: Run focused tests and verify red state**

```powershell
npm.cmd run test:run -- src/features/studio/BackupControls.test.tsx src/features/studio/ImportBackupDialog.test.tsx src/features/studio/ClearPrivateDataDialog.test.tsx
```

Expected: FAIL because controls do not exist.

- [ ] **Step 3: Implement controls and service injection**

Extend `RepositoryServices` with `backup: BackupService`. Wire one service instance in `main.tsx`. Replace Task 6 disabled controls with functional commands. The file input accepts `.soundpassport` but still validates contents rather than trusting the extension.

All dialogs use native focus management or an accessible dialog component already present in dependencies; do not create an untrapped floating panel. Keep action buttons in stable positions and use destructive styling only for confirmed deletion or clear actions.

- [ ] **Step 4: Run Studio, backup, repository, and regression tests**

```powershell
npm.cmd run test:run -- src/features/studio src/backup src/data
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 10**

```powershell
git add src/features/studio src/data/RepositoryContext.tsx src/main.tsx
git commit -m "Add private backup and restore controls"
```

---

### Task 11: End-to-End Fixtures, Responsive QA, Documentation, and Draft PR

**Files:**
- Create: `e2e/journey-workbench.spec.ts`
- Create: `e2e/helpers/testImages.ts`
- Modify: `e2e/atlas-playback.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-13-sound-passport-journey-workbench-design.md`

**Interfaces:**
- Produces complete browser proof for create, reload, reorder, review, complete, Atlas playback, backup, clear, restore, corruption rejection, and responsive rendering
- Consumes every prior task

- [ ] **Step 1: Add deterministic in-memory PNG fixtures**

Implement `makePng(width, height, rgb): Buffer` in `e2e/helpers/testImages.ts` using Node `zlib.deflateSync` and a complete PNG chunk writer with CRC-32. Generate a 900x1600 portrait image and a 1600x900 landscape image in memory; do not add personal or binary fixture files to Git.

The helper must verify its own output signature and dimensions in a small Playwright test before upload scenarios use it.

- [ ] **Step 2: Write the full desktop E2E before final fixes**

The test must:

1. Open `/studio`, create a Taiwan journey with title, dates, cities, and summary.
2. Upload portrait and landscape PNG buffers in one `setInputFiles` call.
3. Fill both moments with local dates, captions, song title/artist, and reasons; add a valid YouTube URL only to the first.
4. Wait for `已儲存`, reload, and verify all values plus both image dimensions survive.
5. Move the second moment before the first using the accessible button and verify persisted order after reload.
6. Preview without status mutation or autoplay, then complete explicitly.
7. Navigate Atlas -> Taiwan -> journey -> player and verify both moment captions and order.
8. Export a `.soundpassport` download, clear private data, verify Taiwan disappears, import the backup, and verify every field/photo/order returns.
9. Corrupt one downloaded photo byte in the ZIP, attempt import, and verify existing data remains unchanged.
10. Collect console errors/page errors and require an empty list.

- [ ] **Step 3: Run E2E and fix only evidence-backed failures**

```powershell
npm.cmd run test:e2e -- --project=desktop e2e/journey-workbench.spec.ts
```

Expected before final fixes: any failure points directly to an unmet acceptance requirement. Diagnose with trace/screenshots, then make the smallest requirement-aligned implementation correction and rerun until PASS.

- [ ] **Step 4: Add mobile playback and layout assertions**

On the mobile project, pre-seed a completed private journey through IndexedDB, then verify Atlas, country, journey, and player at 390x844. Assert:

- Studio shows the desktop guidance and no editable controls.
- Portrait and landscape images are fully visible with `object-fit: contain`.
- `document.documentElement.scrollWidth <= clientWidth` on every route.
- No visible controls, text, images, or iframe exceed viewport bounds.
- YouTube URL contains `youtube-nocookie.com` and `autoplay=0`; `allow` excludes autoplay.

Add Studio selectors to the existing overlap and overflow helpers rather than duplicating weaker checks.

- [ ] **Step 5: Update README and mark implemented spec criteria**

Document:

- `npm.cmd install`, `npm.cmd run dev`, `npm.cmd run test:run`, `npm.cmd run typecheck`, `npm.cmd run build`, and `npm.cmd run test:e2e`.
- Private local-only scope, supported image formats, 25 MiB limit, 2560px normalization, HEIC limitation, and `.soundpassport` backup warning.
- Public GitHub contains source and non-private fixtures only; real browser data remains in IndexedDB and downloaded backup files.

In the design spec, check an acceptance item only after a test or inspected browser behavior proves it.

- [ ] **Step 6: Run final automated verification from a clean state**

```powershell
git status -sb
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Required result: clean intended diff before commit, all unit/integration/E2E tests PASS, typecheck/build exit 0, and diff check emits no errors.

- [ ] **Step 7: Perform browser visual verification**

Start a persistent local server on an unused localhost port. Inspect at least desktop 1440x900 and mobile 390x844 using the in-app browser. Verify nonblank Atlas canvas, Studio three-pane layout, portrait/landscape containment, complete navigation, no horizontal overflow, no incoherent overlap, no console/page errors, and no autoplay.

- [ ] **Step 8: Commit, push, and update the Draft PR**

```powershell
git add README.md docs src e2e package.json package-lock.json
git commit -m "Build private journey workbench"
git push -u origin agent/build-journey-workbench
```

Create a Draft PR targeting the appropriate base branch after checking whether the first Atlas PR has merged. If it is still open, base the new Draft PR on `agent/build-atlas-playback-slice`; if merged, base on `main`. Include exact test counts, browser viewport evidence, privacy scope, local URL, dependency choices, and any nonblocking bundle warning.

## Final Review Checklist

- [ ] Every spec acceptance item maps to an automated test or explicit browser check.
- [ ] No `TBD`, `TODO`, placeholder handler, disabled completed feature, or fake success state remains.
- [ ] Domain property names and repository method signatures match across all tasks.
- [ ] Fixtures are read-only and never enter private backup/export data.
- [ ] Object URLs are revoked and IndexedDB transactions await `tx.done`.
- [ ] Damaged imports cannot leave partial data.
- [ ] Completion and demotion update Atlas without full reload.
- [ ] Real personal content is absent from Git status, commits, test traces, and screenshots.

## Primary References

- `idb` official repository: https://github.com/jakearchibald/idb
- `fflate` official repository: https://github.com/101arrowz/fflate
- dnd-kit sortable documentation: https://docs.dndkit.com/presets/sortable
- Lucide packages: https://lucide.dev/
- Approved design: `docs/superpowers/specs/2026-07-13-sound-passport-journey-workbench-design.md`
