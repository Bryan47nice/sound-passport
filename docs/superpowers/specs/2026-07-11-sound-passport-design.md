# Sound Passport Product Design

Date: 2026-07-11
Status: Approved for implementation planning

## 1. Summary

Sound Passport is a private-by-default travel music journal for people who intentionally pair travel moments with music. It captures why a particular song belonged to a particular place and turns those moments into a playable travel story organized through a world map.

The product is not a trip planner, generic photo album, or streaming service. Its central promise is:

> Save a travel moment with its song, then return to that journey from the map and play the story in order.

## 2. Target User

The first audience is travelers who care about the atmosphere of their Instagram Stories and deliberately choose music for the country, city, scene, or feeling they are sharing.

The first-use persona already has this behavior:

- Takes photos or short videos while traveling.
- Posts selected moments to Instagram Stories.
- Chooses music during the trip, not only after returning home.
- Later assembles those songs into a playlist to revisit the trip.
- Wants to remember the place, sequence, and reason behind each song choice.

## 3. Problem

Instagram preserves the published Story but is not designed as a durable music travel archive. YouTube and other music services preserve songs but not the photo, place, sequence, or reason that made the song meaningful.

The missing object is a travel memory that combines:

- a photo or short visual reference;
- the place and time;
- a platform-neutral song reference;
- a short explanation of why the song fit;
- its position in the larger journey.

## 4. Product Principles

1. Capture must fit the existing travel routine instead of replacing Instagram.
2. The traveler should confirm only information the system cannot reliably infer.
3. A song link may fail, but the memory must survive.
4. The world map is a memory index, not a trip-planning map.
5. All personal data is private unless the owner explicitly publishes it.
6. The first version stays focused on capture, curation, replay, and sharing.

## 5. Core Experience

### 5.1 Create a Journey

The user creates a journey with:

- title;
- country;
- one or more cities;
- start and end dates;
- optional cover image.

The active journey is used to prefill new moments while the travel dates are current.

### 5.2 Capture a Music Moment

After posting an Instagram Story, the user opens Sound Passport and follows a three-step flow:

1. Select the photo from the device's system media picker, then confirm the inferred place and active journey.
2. Search YouTube, paste a supported link, or enter song metadata manually.
3. Optionally write one sentence answering, "Why this song?", then save.

The PWA cannot silently inspect the camera roll. It opens the system media picker, where recent photos are normally shown first. The happy path should take about 15 seconds after photo selection when the inferred place is correct and the song appears in the first search results. A skipped explanation is added to a post-trip review list instead of blocking capture.

### 5.3 Curate After the Trip

The user can:

- reorder moments;
- correct dates and places;
- replace unavailable song links;
- add missing explanations;
- choose the journey cover;
- preview the complete playable story.

### 5.4 Revisit from the World Map

The signed-in home screen is a full world map with visited countries highlighted or marked.

The approved navigation is browse-first:

1. Select a country.
2. View every journey to that country.
3. Select one journey.
4. Start the playable story from its first moment.

Selecting a country never starts audio automatically.

### 5.5 Play a Journey

The journey player presents moments in the curated order. Each moment includes the visual, city-level place label, local date and time, song information, and explanation.

YouTube content plays through the official embedded player. Other providers initially open through their source link. The user controls playback; the application does not autoplay audio when entering the country or journey page.

### 5.6 Publish and Share

Journeys are private by default. Publishing is an explicit action that creates a sanitized, read-only snapshot with a revocable public link.

The public snapshot includes only fields approved for sharing. Exact coordinates, private drafts, internal IDs, account information, and unpublished moments are excluded. Unpublishing invalidates public access without deleting the private journey.

## 6. MVP Scope

### Included

- Account authentication.
- Journey creation and editing.
- Quick music-moment capture.
- Photo upload and compression.
- System media picker for explicit photo selection.
- Automatic suggestions for active journey and current location.
- Manual fallback for every automatic suggestion.
- YouTube search, link parsing, metadata, and embedded playback.
- Optional export of a journey's ordered songs to a user-owned YouTube playlist.
- Platform-neutral manual song references.
- Post-trip ordering and completion review.
- Interactive world map with country and journey drill-down.
- Playable journey story.
- Private-by-default storage.
- Explicit publish, share, and unpublish actions.

### Not Included

- Itinerary, flight, hotel, or booking management.
- Instagram Story import or Instagram account integration.
- Social feed, following, likes, or comments.
- Collaborative trip editing.
- AI song recommendations.
- Full Spotify or Apple Music integration.
- Local audio-file storage.
- Automatic background location history.

## 7. Information Architecture

The product has five primary areas:

1. **Atlas**: world map, visited countries, and country-level journey lists.
2. **Journey**: journey metadata, moments, curation, and publish controls.
3. **Moment Capture**: recent photo, place, song, and explanation.
4. **Player**: ordered visual and music playback.
5. **Sharing**: sanitized public snapshot and revocation.

These areas must remain independent modules with explicit data contracts so map rendering, song providers, or storage can change without rewriting the full product.

## 8. Data Model

### User

- `id`
- `displayName`
- `createdAt`
- `settings`

### Journey

- `id`
- `ownerId`
- `title`
- `countryCode`
- `cityLabels`
- `startDate`
- `endDate`
- `coverPhotoId`
- `status`: `active`, `review`, or `complete`
- `createdAt`
- `updatedAt`

### Moment

- `id`
- `journeyId`
- `ownerId`
- `photoId`
- `takenAt`
- `coordinates`: private latitude and longitude when available
- `placeLabel`: user-facing place name
- `cityLabel`
- `songReferenceId`
- `reason`
- `reasonStatus`: `complete` or `needs_review`
- `sortOrder`
- `createdAt`
- `updatedAt`

### SongReference

- `id`
- `provider`: `youtube`, `external`, or `manual`
- `providerItemId`
- `sourceUrl`
- `title`
- `artist`
- `thumbnailUrl`
- `durationSeconds`
- `availability`: `available`, `unavailable`, or `unknown`
- `lastCheckedAt`

Song metadata is retained even when the source becomes unavailable.

### PhotoAsset

- `id`
- `ownerId`
- `storagePath`
- `contentType`
- `width`
- `height`
- `capturedAt`
- `uploadStatus`

### PublishedJourney

- `publicId`
- `sourceJourneyId`
- `ownerId`
- `publishedAt`
- `updatedAt`
- `revokedAt`
- `snapshot`: sanitized journey and moment fields only

The public document is a separate snapshot, not a broad read permission on private collections.

## 9. Technical Architecture

### Client

- React and Vite.
- Mobile-first progressive web application.
- MapLibre GL JS for the interactive atlas.
- YouTube IFrame Player API for playback.
- Local persistent draft storage for incomplete captures and pending uploads.

### Firebase

- Firebase Authentication for identity.
- Cloud Firestore for users, journeys, moments, song references, and published snapshots.
- Cloud Storage for compressed photos.
- Cloud Functions for privileged operations, YouTube metadata proxying, publish snapshot creation, and unpublish revocation.
- Firebase App Check and restrictive Security Rules for database and file access.

Cloud Storage requires a Blaze billing plan. The project must configure budget alerts, upload-size limits, image compression, and lifecycle monitoring before public release.

### External Music

- YouTube is the first fully supported provider.
- The YouTube Data API handles search and playlist-related metadata.
- YouTube OAuth is requested only when a user exports a journey to their own YouTube playlist.
- The official IFrame Player handles playback.
- Server-side YouTube credentials are never sent to the client or committed.
- Other providers use a normalized external link until a dedicated adapter is justified.

## 10. Data Flow

### Capture

1. The client creates a local draft immediately.
2. The user selects a photo and confirms or edits the inferred journey and place.
3. Song search returns normalized `SongReference` candidates.
4. The client saves journey metadata and moment data.
5. The photo uploads through a resumable task.
6. The draft is marked synchronized only after both metadata and photo state are durable.

### Playback

1. Atlas loads the user's country summary.
2. Country selection loads journeys for that country.
3. Journey selection loads moments ordered by `sortOrder`.
4. Player resolves each `SongReference` through its provider adapter.
5. An unavailable source falls back to retained song metadata and a replace-link action.

### YouTube Playlist Export

1. The user selects export from a completed journey.
2. The application requests the minimum YouTube OAuth permission required for playlist creation.
3. A backend operation creates the playlist and inserts available YouTube items in journey order.
4. Manual or non-YouTube songs are reported as skipped instead of blocking export.
5. OAuth denial, quota limits, or partial failure never alter the private Sound Passport journey.

### Publishing

1. The owner previews the journey.
2. A backend function verifies ownership.
3. The function removes private fields and creates a `PublishedJourney` snapshot.
4. The public route reads only that sanitized snapshot.
5. Unpublish marks the snapshot revoked and denies subsequent public reads.

## 11. Privacy and Security

- A public GitHub repository exposes application source and documentation only.
- Private application collections require an authenticated user whose ID matches `ownerId`.
- Storage paths are owner-scoped and validated by Security Rules.
- Public pages never query private journey or moment collections directly.
- Public snapshots omit exact coordinates and show country or city labels only.
- Firebase client configuration may be visible, but it is not authorization. Security Rules and App Check enforce access.
- Server credentials, service accounts, deployment tokens, and non-Firebase API keys stay in managed secrets.
- Repository history and CI logs must be treated as public and must not contain user data or credentials.

## 12. Failure Handling

- **No location permission**: allow country and city selection without blocking save.
- **Incorrect location inference**: allow correction before or after saving.
- **No network**: keep a local draft and queue metadata synchronization.
- **Photo upload interruption**: preserve the draft and resume or retry the upload.
- **YouTube search failure**: allow manual title and artist entry.
- **Removed or blocked video**: retain the memory and offer source replacement.
- **YouTube export denial or quota failure**: keep the journey unchanged, report skipped items, and allow retry.
- **Duplicate save**: use a client-generated idempotency key for capture submission.
- **Publish failure**: leave the private journey unchanged and show a retryable error.
- **Revoked public journey**: return a neutral unavailable page without exposing private metadata.

## 13. Test Strategy

### Unit Tests

- Moment ordering and reorder persistence.
- Song URL parsing and provider normalization.
- Published snapshot sanitization.
- Permission predicates and ownership checks.
- Fallback behavior for unavailable songs.

### Integration Tests

- Firestore and Storage Security Rules through Firebase emulators.
- Offline draft to online synchronization.
- Resumable photo uploads and interrupted-upload recovery.
- YouTube metadata adapter success, quota error, and no-result states.
- YouTube playlist export success, skipped-item, denied-consent, and partial-failure states.
- Publish and unpublish snapshot lifecycle.

### End-to-End Tests

- Create a journey, add a moment, and see the country appear on the atlas.
- Select country, select journey, and play the ordered story.
- Export available YouTube songs in journey order without exposing credentials.
- Complete a capture when location or YouTube search is unavailable.
- Publish a journey, verify sanitized public fields, then unpublish it.
- Verify the main workflows at representative mobile and desktop viewports.

## 14. Product Acceptance Criteria

The MVP is ready for a first external user when:

- A traveler can create a journey and save a valid music moment on mobile.
- The happy-path capture can be completed in roughly 15 seconds after opening the form.
- An offline or interrupted capture survives and can be synchronized later.
- The world map correctly groups repeat visits by country and journey.
- Playback preserves curated moment order without automatic audio on navigation.
- A removed song source does not erase the related travel memory.
- A completed journey can export its available YouTube songs in order, while unsupported songs are reported without data loss.
- Private records cannot be read by another authenticated account.
- Public sharing exposes only the sanitized snapshot and can be revoked.

## 15. References

- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- YouTube Data API playlist items: https://developers.google.com/youtube/v3/docs/playlistItems/insert
- YouTube OAuth: https://developers.google.com/youtube/v3/guides/authentication
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs
- Firebase offline data: https://firebase.google.com/docs/firestore/manage-data/enable-offline
- Firebase file uploads: https://firebase.google.com/docs/storage/web/upload-files
- Firebase API keys: https://firebase.google.com/docs/projects/api-keys
- Firestore Security Rules: https://firebase.google.com/docs/firestore/security/get-started
- Storage Security Rules: https://firebase.google.com/docs/storage/security
- GitHub repository visibility: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
