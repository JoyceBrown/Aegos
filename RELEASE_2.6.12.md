# Aegos 2.6.12

## Changes

- Tightened the home recommendation control into a smaller two-part pill.
- Reduced the recommendation card width and height so it no longer crowds the header.
- Changed the delay text into a compact badge and softened the visual treatment.
- Added a release audit guard against oversized recommendation controls.

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

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.12_x64-setup.exe`

SHA-256: `78b549c9a1b9196807a772fb2789abcf6d77be3a476e91748196803dd9ad211c`
