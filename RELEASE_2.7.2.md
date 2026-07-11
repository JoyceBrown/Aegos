# Aegos 2.7.2

## Changes

- Removed the home page refresh-status shortcut.
- Kept title/drag regions draggable while using the default cursor, avoiding move/cross cursor feedback.
- Preserved the 2.7.0 visual baseline and 2.7.1 layout stabilization scope.

## Verification

- `node --check src/app.js`
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run audit:backend`
- `npm run smoke:perf`
- `npm run build`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.2_x64-setup.exe`
- SHA-256: `adba1c18a01af735feb152662191debdf856c34c0822d1ae8e34d98d5d01c5bf`
