# Aegos 2.7.3

## Changes

- Fixed the quick subscription menu layout by positioning it from the real button bounds and clamping it inside the visible window.
- Made speed tests measurement-only: batch and one-click tests no longer start or restart the core when it is disconnected.
- Restored window resizing while removing the custom edge drag overlay that blocked native resize hit testing.
- Reduced background speed-test UI work so large node-table refreshes run only when the home or nodes surface is visible.
- Added audit and smoke coverage for subscription menu bounds, measurement-only speed tests, resizable windows, and visible-surface speed refreshes.

## Verification

- `node --check src/app.js`
- `node --check tools/backend-audit.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run build`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.3_x64-setup.exe`
- SHA-256: `cbf95dc051694aab115fadfdd2eaecea94dcd8fb54e30cc1c5c7adb3c7aebfe9`
