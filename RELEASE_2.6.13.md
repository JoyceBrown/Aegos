# Aegos 2.6.13

## Changes

- Removed the home recommended-node switch control.
- Kept speed tests as delay/list updates only, with no home shortcut that changes nodes.
- Swapped Common Regions ahead of Common Nodes and made Common Regions the default home node view.
- Removed the home "All Nodes" shortcut button.
- Added release and interaction checks for the simplified home node controls.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run check`
- `npm run build`
- `npm run audit:release`

## Artifact

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.13_x64-setup.exe`

SHA-256: `0be0bc716a6527df60dd2ac516a452e06b584e1352c291a277ecd8fbc8438053`
