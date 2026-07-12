# Aegos 2.9.51

## Changes
- Added a dedicated stability regression audit for the blocker classes that repeatedly hurt user experience: legacy synchronous speed paths, speed/diagnostics page blocking, disabled-button busy feedback, stale speed results after subscription switching, and proxy-group references appearing as ordinary nodes.
- Wired `npm run audit:stability` into the package scripts and release audit so the stability lane becomes part of the release gate.
- Fixed single-node speed test cleanup when the backend returns a final failed probe without a `runId`; the UI now clears `testing` state and captures node diagnostics instead of waiting forever for polling.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.51.

## Verification
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `node --check src\app.js`
- `node --check tools\release-audit.js`
- `node --check tools\stability-regression-audit.js`
- `npm run audit:backend`
- `npm run audit:stability`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:responsiveness`
- `npm run audit:architecture`
- `npm run audit:diagnostics`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run audit:takeover`
- `npm run audit:debt`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `git diff --check`

## Artifact
- Source-only stability gate checkpoint. No installer was produced for this checkpoint.
- SHA-256: source-only
