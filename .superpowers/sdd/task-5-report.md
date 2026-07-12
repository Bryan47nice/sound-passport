# Sound Passport Task 5 Report

## Scope

Implemented the controlled journey story player at `/journeys/:journeyId/play` using only fixture data. The change adds a safe YouTube adapter, player components and focused tests, the app route, and responsive player styling.

## TDD Record

1. Added `src/domain/youtube.test.ts` and `src/features/player/JourneyPlayerPage.test.tsx` before their production modules existed.
2. RED command:
   `npm.cmd run test:run -- src/domain/youtube.test.ts src/features/player/JourneyPlayerPage.test.tsx`
3. RED result: both suites failed at import resolution because `youtube.ts` and `JourneyPlayerPage.tsx` did not yet exist.
4. Implemented the smallest production modules required by those tests, corrected two test locators to match the accessible DOM, then added a final last-moment disabled assertion.
5. Final focused result: 2 files, 14 tests passed.

## Implementation

- `parseYouTubeVideoId()` only accepts `youtube.com`, a hostname ending in `.youtube.com`, or exact `youtu.be`; it rejects `notyoutube.com`, `youtube.com.evil.example`, `youtube-nocookie.com`, malformed values, and non-HTTP(S) protocols.
- Embedded players use `youtube-nocookie.com`, `autoplay=0`, and an `allow` value that does not grant autoplay.
- The iframe is only mounted by the `/play` route. Existing journey-page coverage confirms no iframe is shown before explicit entry into the player.
- The player uses fixture photos as the main visual, supplies photo alt text, local time, song title, artist, and reason, and has fixed-size previous/next controls with disabled first/last states.
- Async state is guarded by both effect cleanup and `resolvedJourneyId`, so a route change synchronously shows the loading state instead of stale story content. Unknown journeys resolve to a Traditional Chinese not-found view with a return link.

## Verification

| Check | Result |
| --- | --- |
| Focused player/domain tests | 14/14 passed |
| Full unit suite | 25/25 passed across 9 files |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run build` | passed |
| `git diff --check` | passed |

## Self-review

- Confirmed the domain boundary uses `hostname === 'youtube.com' || hostname.endsWith('.youtube.com')`, not a vulnerable bare suffix match.
- Confirmed no YouTube API, OAuth, search, Firebase, authentication, or non-fixture data was added.
- Confirmed changed source files are limited to the task brief's YouTube domain/tests, player components/tests, app route, and global CSS; this report is the requested additional artifact.

## Concern

Vite continues to warn that the pre-existing production JavaScript chunk exceeds 500 kB after minification. No unrelated code-splitting change was introduced for this task.

## Review Follow-up: YouTube Video ID Validation

### RED

Added coverage for the single 11-character `[A-Za-z0-9_-]` validator, invalid URL query/path IDs, invalid or missing `providerItemId` recovery through a valid `sourceUrl`, fallback when both IDs are invalid, manual-moment iframe removal, and empty-story iframe absence.

Command:

```powershell
npm.cmd run test:run -- src/domain/youtube.test.ts src/features/player/YouTubeEmbed.test.tsx src/features/player/JourneyPlayerPage.test.tsx
```

Result: 12 failures. The validator export was absent; whitespace, malformed, and wrong-length URL IDs were accepted; and `YouTubeEmbed` embedded an invalid `providerItemId` instead of falling back.

### GREEN

- Added `isValidYouTubeVideoId()` as the only video-ID format validator.
- `parseYouTubeVideoId()` validates each extracted query or path candidate through that validator.
- `YouTubeEmbed` validates `providerItemId` through the same validator, then parses `sourceUrl` when the provider value is missing, blank, or invalid. It renders fallback content without an iframe when neither yields a valid ID.
- Player coverage confirms a manual next moment removes the iframe and exposes fallback content; an empty story shows Traditional Chinese copy and no iframe.

Focused command result: 3 files, 32/32 tests passed.

### Follow-up Verification

```powershell
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Results: full unit suite 10 files, 43/43 tests passed; typecheck, build, and diff check passed. The build retains the existing Vite warning for a JavaScript chunk above 500 kB.
