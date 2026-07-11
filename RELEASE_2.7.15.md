# Aegos 2.7.15

## Changes

- Added the formal `2.7.14 -> 2.8.0` stability roadmap.
- Rebased the mainline plan around the actual `2.7.14` feature state instead of the older `2.4 -> 3.0` planning document.
- Locked the next-version constraints: speed tests remain measurement-only, UI work stays non-blocking, `7891` remains the default mixed port, and visual redesign work stays out of scope until after `2.8.0`.

## Verification

- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Source-only release; no installer for this planning checkpoint.
- SHA-256: Source-only
