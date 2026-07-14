# Aegos 3.4.25

3.4.25 is a packaged UI regression fix for the Nodes strategy-group sorting strip.

## Changes

- Package, Tauri, Cargo, and in-app version labels are aligned to 3.4.25.
- Reserved fixed bottom space for the strategy-group horizontal scrollbar.
- Made the strategy-group scrollbar thinner and less visually intrusive.
- Added extra sorting-mode height so lifted cards cannot overlap the scrollbar.
- Tightened node strategy UI audit to guard against scrollbar/card overlap regressions.

## Verification

- `node --check src/app.js`
- `node --check tools/node-strategy-ui-audit.js`
- `npm run check`
- `npm run audit:node-strategy-ui`
- `npm run audit:copy`
- `npm run audit:global-interaction-product`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `git diff --check`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.4.25_x64-setup.exe`
- Size: 15,543,665 bytes
- SHA-256: 87119B0504056E6DAB0197B875D39C66A0E99FDF9196C3B6F524E9BC68A2CEA3
