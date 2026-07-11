# Aegos 2.9.4

Source-only small release.

## Changes

- Added structured speed-result confidence metadata for fresh, medium, stale, low, failed, cooldown, testing, and unknown states.
- Added freshness details to recommendation, speed snapshots, single-node tests, and merged proxy group rows.
- Replaced passive node load display with a lightweight confidence chip on home and node tables.
- Added backend and release audit coverage for speed-result confidence.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
