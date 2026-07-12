# Final Review Fix Report

## Scope

- Added container resize and orientation handling for `WorldMap`.
- Converted map visual snapshots to shared, canvas-targeted baselines.
- Added the mobile landscape-to-portrait marker E2E scenario.
- Added `JourneyPage` resolved-route gating and a deferred route-transition regression test.

## Root Cause And TDD Evidence

`WorldMap` calculated its camera and JP/KR marker offsets only during initial construction. It had no container `ResizeObserver`, so a viewport or orientation change left the MapLibre viewport and marker offsets stale. `JourneyPage` retained the older loaded-flag-only state pattern, unlike the route identity gates already used by `CountryPage` and `JourneyPlayerPage`.

RED command:

```powershell
npm.cmd run test:run -- src/features/atlas/WorldMap.test.tsx src/features/journey/JourneyPage.test.tsx
```

RED result after correcting the test harness: exit 1; the resize test failed with `TypeError: Cannot read properties of undefined (reading 'observe')`, proving `WorldMap` did not create a `ResizeObserver`.

GREEN command:

```powershell
npm.cmd run test:run -- src/features/atlas/WorldMap.test.tsx src/features/journey/JourneyPage.test.tsx
```

GREEN result: 2 test files passed, 9 tests passed.

## Implementation

- `WorldMap` now observes its container, ignores the observer's initial same-size notification, marks the map unready on a real size change, calls `map.resize()`, recomputes the existing width-derived camera, calls `map.jumpTo()`, and updates every marker via `Marker#setOffset()`.
- Marker offsets now come from a country-and-width function, with `[0, 0]` used to reset wide-map offsets.
- Cleanup disconnects the observer, removes the render listener, cancels pending readiness frames, removes markers, and removes the map. The observer callback returns after disposal.
- Unit coverage mocks `ResizeObserver` and asserts resize, camera jump, marker offset updates, readiness restoration, cleanup, and post-cleanup callback safety.
- `JourneyPage` now records `resolvedJourneyId` and renders loading whenever it does not match the route parameter. The regression test switches from Tokyo to Seoul with deferred repository responses and asserts no stale Tokyo heading or play link appears while Seoul is pending.
- `snapshotPathTemplate` omits the host platform suffix. Canvas snapshots use `maxDiffPixelRatio: 0.0005`; marker placement remains covered through DOM box assertions.

## Snapshot Baselines

Regenerated once with:

```powershell
npm.cmd run test:e2e -- --update-snapshots
```

Result: 7 passed, 1 skipped. Removed the four `*-win32.png` files and created these committed shared baselines:

- `e2e/atlas-playback.spec.ts-snapshots/atlas-map-initial-desktop.png`
- `e2e/atlas-playback.spec.ts-snapshots/atlas-map-remount-desktop.png`
- `e2e/atlas-playback.spec.ts-snapshots/atlas-map-initial-mobile.png`
- `e2e/atlas-playback.spec.ts-snapshots/atlas-map-remount-mobile.png`

## Verification

```powershell
npm.cmd exec playwright -- test --grep "mobile orientation change"
```

Result: mobile orientation test passed; desktop project skipped (1 passed, 1 skipped).

```powershell
npm.cmd exec playwright -- test --grep "revisits a journey from the map without autoplay"
```

Result: desktop and mobile flow both passed (2 passed).

```powershell
npm.cmd run test:e2e
```

Result: 7 passed, 1 skipped.

```powershell
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
git -c safe.directory=C:/Users/user1/Documents/Codex/2026-07-11/wj/.worktrees/atlas-playback -C C:/Users/user1/Documents/Codex/2026-07-11/wj/.worktrees/atlas-playback diff --check
```

Results: 11 unit files and 51 tests passed; typecheck passed; build passed; diff check exited 0 with no whitespace errors.

## Concerns

- Vite still warns that the production JavaScript chunk is 1,413.12 kB before gzip and exceeds the 500 kB warning threshold. This is unrelated to the review findings and was not changed here.
- The README documents local Chromium plus SwiftShader baseline commands. No CI compatibility guarantee was verified or claimed.
