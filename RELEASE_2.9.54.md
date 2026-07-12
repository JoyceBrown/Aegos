# Aegos 2.9.54

Source-only release. No installer was built for this checkpoint.

## Changes
- Added the FlClash benchmark baseline at `research/flclash-benchmark-2.9.54.md`.
- Added `audit:flclash` to enforce benchmark coverage for same-environment testing, speed result metrics, UI responsiveness, failure reasons, subscription switch cancellation, and GPL no-copy boundaries.
- Wired the FlClash benchmark gate into release audit.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.54.

## Verification
- `npm run audit:flclash`
- `npm run audit:speed`
- `npm run audit:release`
- `git diff --check`

## Artifact
- Source-only: no installer for 2.9.54.
- SHA-256: Source-only
