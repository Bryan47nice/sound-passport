# Sound Passport

Sound Passport is a private-by-default travel music journal. It helps travelers capture the photo, place, song, and feeling behind a moment, then revisit the journey from a world map as a playable story.

## Product Direction

- Mobile-first quick capture after posting an Instagram Story
- Platform-neutral song references with full YouTube support first
- Optional export of a completed journey to a YouTube playlist
- World map as the primary memory index
- Country to journey to playable story navigation
- Private records by default, with explicit and revocable public sharing

## Current Status

The product design is approved and documented. Implementation has not started.

Read the [design specification](docs/superpowers/specs/2026-07-11-sound-passport-design.md).

## Privacy Boundary

This repository is intended to be public. The application source and documentation may be visible, but user trips, photos, locations, and song notes will live in Firebase and remain private unless the owner explicitly publishes a sanitized journey snapshot.

Secrets such as server-side YouTube credentials and deployment credentials must never be committed. Firebase client configuration identifies the project; Firebase Authentication, Security Rules, and App Check enforce access control.
