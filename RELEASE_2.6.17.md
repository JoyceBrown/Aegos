# Aegos 2.6.17

## Changes

- Fixed Disconnect Protection on Windows builds where `netsh advfirewall` rejects the `group=` argument.
- Kept `netsh`-based allow-rule creation, but now cleans and validates rules through the `Aegos Kill Switch Allow *` display-name prefix.
- Added a node-row static cache so large subscriptions do not repeatedly recompute region/protocol/fixed-node metadata during fast filtering.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run build`
- `npm run audit:release`

## Artifact

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.17_x64-setup.exe`

SHA-256: `ebe853450ef95ef1b838fdba39c7325c61289c4e35e18f913b63c1305fd77d80`
