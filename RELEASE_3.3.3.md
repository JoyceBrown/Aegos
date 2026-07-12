# Aegos 3.3.3

Source checkpoint for generating routing drafts from active connections.

## Changes
- Added a `draft` action to connection rows.
- Clicking a connection draft switches to the routing page and creates a safe
  preview rule from the connection target.
- Domain targets become `DOMAIN-SUFFIX`; IPv4 targets become `IP-CIDR /32`.
- Kept the action frontend-only: no config writes, hot reloads, backend jobs,
  connection closure, node switching, or core locks.
- Added `audit:routing-connection-draft` and interaction-smoke coverage.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.3.3.

## Verification
- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/routing-connection-draft-audit.js`
- `npm run audit:routing-ux`
- `npm run audit:routing-app-ux`
- `npm run audit:routing-connection-draft`
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
