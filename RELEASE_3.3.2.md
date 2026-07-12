# Aegos 3.3.2

Source checkpoint for app/process routing draft preview.

## Changes
- Added an app routing preview next to website routing on the routing page.
- Users can enter a process name such as `Telegram.exe` or a full `.exe` path,
  then choose proxy/direct/reject in ordinary language.
- Draft output is internally mapped to `PROCESS-NAME` or `PROCESS-PATH`, but the
  UI still stays beginner-facing.
- Kept the routing assistant read-only: no config writes, hot reloads, backend
  jobs, node switches, or extra core locks.
- Added `audit:routing-app-ux` and interaction-smoke coverage for app drafts.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.3.2.

## Verification
- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/routing-app-ux-audit.js`
- `npm run audit:routing-ux`
- `npm run audit:routing-app-ux`
- `npm run audit:routing-assistant-gate`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
