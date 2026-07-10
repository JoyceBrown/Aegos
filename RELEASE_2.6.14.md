# Aegos 2.6.14

## Changes

- Renamed user-facing Kill Switch wording to Disconnect Protection.
- Replaced the home quick outbound-IP refresh button with a Disconnect Protection quick toggle.
- Automatically refresh the outbound IP after a successful node switch.
- Defaulted the home Common Regions view to Hong Kong.
- Removed the duplicated Common Regions label above the region chips.

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

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.14_x64-setup.exe`

SHA-256: `20099736d45fbb410bc094f40d199007d24d8d11a8426c6e24d2c8033df08863`
