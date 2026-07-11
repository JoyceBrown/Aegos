# Aegos 2.9.5

Source-only small release.

## Changes

- Added controlled recovery suggestions to reliability recovery responses.
- Ranked fallback suggestions by same-region match, confidence, health score, and delay.
- Marked recovery suggestions as requiring confirmation so automatic recovery does not become arbitrary UI switching.
- Added backend and release audit coverage for same-region recovery suggestions.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
