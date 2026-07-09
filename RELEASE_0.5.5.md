# Aegos 0.5.5

## Fixes

- Aligned the home "Recommended nodes" label with the quick-actions label.
- Replaced the single recommended-node display with three selectable lowest-latency chips.
- Kept common-region filtering on the home page instead of navigating to the node page.
- Enabled node-page filter tabs for all, low latency, regions, favorite, and recent views.
- Made subscription cards selectable by clicking the full row.
- Changed mode switching to a secondary selection menu instead of immediate cycling.
- Renamed the status refresh action to "Sync status" and added clear sync feedback.
- Shortened the proxy-port metric to the port number so it matches neighboring metric widths.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run check`
- `npm run audit:release`

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_0.5.5_x64-setup.exe`
- SHA-256: `099d26fe9704182d25dd84dbf017d104b1b346c610fb2b6154af35ec87289109`
