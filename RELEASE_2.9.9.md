# Aegos 2.9.9

## Changes

- Replaced misleading loss/load metrics with truthful stability, active connection, and last-tested fields.
- Added current-node delay refresh on the home delay metric without switching the selected node.
- Removed fake load/traffic columns from the node page while keeping test, edit, and favorite actions.
- Fixed TUN-off connection startup by applying Windows system proxy takeover when the user clicks Connect.
- Added release/backend/interaction coverage for truthful metrics, no speed-test auto-switching, and TUN-off connection takeover.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `node --check tools\release-audit.js`
- `node --check tools\backend-audit.js`
- `npm run check`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `cargo test --manifest-path src-tauri\Cargo.toml`

## Artifact

Installer:

`src-tauri/target/release/bundle/nsis/Aegos_2.9.9_x64-setup.exe`

SHA-256: 111291409cc7f6d3866594e61013940c95da59801d6b23222174943c90706e41
