# Aegos 2.6.15

## Changes

- Made the Connect button switch labels optimistically on connect/disconnect.
- Automatically refresh the outbound IP after the first successful connection.
- Kept quick and batch speed tests as delay-only actions with no proxy switch.
- Added subscription rename support through a background job.
- Fixed Disconnect Protection quick action wiring, replaced the cramped icon, and added firewall-state verification with rollback on partial failure.
- Swapped the System Proxy and Update Subscription quick-action positions.
- Reduced home node rendering work during large speed-test refreshes by keeping only ranked visible candidates.

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

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.15_x64-setup.exe`

SHA-256: `14df3be2aba6816ab2be1fcfdebeb48f66e305293631630ca9a9f14597a3c578`
