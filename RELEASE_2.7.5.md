# Aegos 2.7.5

## Changes
- Stabilized the home quick-action row across different window heights.
- Kept the quick-action panel at a fixed 72 px row height with 36 px buttons, so the row no longer shifts between centered and top-heavy layouts.
- Pinned the left connection controls to a stable top offset inside the hero panel instead of re-centering as the hero height changes.
- Changed manual System Proxy toggling while disconnected into a saved preference only. It no longer applies Windows proxy takeover or changes the app into the connected state.
- Added a pending `待连接` display state for System Proxy when the preference is enabled but traffic has not been connected yet.
- Added backend and interaction audits to prevent System Proxy from auto-connecting traffic takeover.

## Verification
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run build`

## Artifact
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.5_x64-setup.exe`
- SHA-256: `4da4c378a33b66f78d8a94e7ce9d2739377184ebe3b4e77af25cc7bd5040a86d`
