# Aegos 2.7.8

## Changes

- Added a canonical end-of-file layout layer so window height changes only resize the list area, not the current-node, connection, or navigation blocks.
- Made one-click and batch speed tests start without marking the whole foreground UI busy.
- Added outbound IP request sequencing so stale IP lookups cannot overwrite newer node changes or leave the UI stuck on "查询中".
- Reduced outbound IP lookup timeout to avoid long stuck states when IP services fail.
- Expanded UI smoke checks for same-width different-height layout stability.

## Verification

- Passed: node --check src/app.js
- Passed: npm run check
- Passed: npm run smoke:ui
- Passed: npm run smoke:interactions
- Passed: npm run smoke:perf
- Passed: npm run audit:backend
- Passed: npm run build
- Passed: npm run audit:release

## Artifact

- Installer: src-tauri/target/release/bundle/nsis/Aegos_2.7.8_x64-setup.exe
- Size: 15,317,398 bytes
- SHA-256: 3ce157c559fcec9d26f3f2c02fc815e6aa93e9b632fbd932bb56985c47016036
