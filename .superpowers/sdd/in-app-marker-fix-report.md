# In-App Marker Fix Report

## Root cause

The narrow world camera centered on longitude 50 without accounting for the 15px classic scrollbar that reduces a 390px viewport to a 375px content viewport. After the page inset, the map is 343px wide. At that width, the Japan marker box ended at x=360 while the map ended at x=359.

## Red-green evidence

- Added a WorldMap regression at the actual 343px container width. Before the product change it failed because the camera center was `[50, 20]` instead of `[60, 20]`.
- Extended the orientation E2E scenario to validate full East Asia marker boxes at both 390px and 375px portrait widths. Before the product change it failed with Japan ending at x=360 beyond the map right edge x=359.
- Changed only the narrow camera center from 50 to 60. The focused unit and orientation E2E now pass.

## Baselines

The narrow camera framing changes the mobile canvas output, so these shared baselines were regenerated:

- `atlas-map-initial-mobile.png`
- `atlas-map-remount-mobile.png`

## Verification

- Focused WorldMap unit: 8 passed.
- Orientation E2E at 390px and 375px: 1 passed.
- Existing mobile journey flow after baseline regeneration: 1 passed.
- Full E2E: 7 passed, 1 expected desktop skip.
- Full unit suite: 52 passed across 11 files.
- Typecheck: passed.
- Production build: passed. Vite reported a bundle-size warning.
- `git diff --check`: passed.
