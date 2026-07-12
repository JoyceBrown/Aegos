# Aegos 3.1.2

Source checkpoint for current mode summary consistency on the read-only routing
page.

## Changes
- Added `audit:routing-mode` to verify routing mode is sourced from backend core
  settings, rendered through the shared `modeLabel()` path, and covered by
  interaction smoke.
- Updated optimistic mode changes to refresh the visible routing mode summary
  and invalidate the routing page cache.
- Kept the routing page read-only and deferred; this checkpoint does not add
  rule editing or config writes.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.2.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-mode`
- `npm run audit:routing-readonly`
- `npm run audit:routing-navigation`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run audit:responsiveness`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
