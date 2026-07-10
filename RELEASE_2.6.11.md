# Aegos 2.6.11

## Changes

- Changed the home recommendation control to a compact left switch button plus a recommendation card.
- Removed the current-node availability badge beside the node name.
- Wired the home delay tile to the current node delay instead of leaving it blank.
- Changed the home quick subscription action into an inline popup menu instead of navigating to the subscription page.
- Removed TUN and copy-proxy from the home quick actions.

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

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.11_x64-setup.exe`

SHA-256: `c998c94def790d2bdaffb9eab4e81558bfab6db37c3bc678879cd4f8c497b9d6`
