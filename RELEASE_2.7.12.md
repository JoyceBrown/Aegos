# Aegos 2.7.12

## Changes

- Smart/rule mode landing IP lookup now uses a hidden internal group synced to the current real node, so `落地 IP` reflects the selected node instead of a general rule-mode route.
- Diagnostics now starts with detached button feedback, allowing immediate navigation and other UI interactions while checks run.
- Release/backend audits now guard the hidden current-node IP lookup path and detached diagnostics feedback.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/backend-audit.js`
- `node --check tools/release-audit.js`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run audit:backend`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.12_x64-setup.exe`
- SHA-256: `408081669588717b079d9a03309dd4b40a0f7c99ea4eea9b3dd4b9b2e2a8e150`
