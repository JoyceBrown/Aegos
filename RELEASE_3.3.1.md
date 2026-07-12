# Aegos 3.3.1

Source checkpoint for routing-page UX repair and website routing preview.

## Changes
- Reworked the routing page into a clearer beginner-facing preview: readable
  labels, stable summary cards, dedicated strategy/rule rows, and separate
  scroll areas.
- Hidden Aegos internal landing-IP rules from ordinary rule rows and surfaced
  them as a system-rule count instead.
- Added a draft-only website routing preview. Users can express
  `example.com -> proxy/direct/reject`, but this version does not write config,
  hot reload, switch nodes, or start backend jobs.
- Kept 3.2 routing foundation and 3.3 assistant gates active.
- Added `audit:routing-ux` to guard the layout and draft-only behavior.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.3.1.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:routing-profile-switch`
- `npm run audit:routing-reload-preflight`
- `npm run audit:routing-rollback`
- `npm run audit:routing-diagnostics`
- `npm run audit:routing-foundation`
- `npm run audit:routing-assistant-gate`
- `npm run audit:routing-ux`
- `npm run audit:release`
- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/ui-smoke.js`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
