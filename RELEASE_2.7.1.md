# Aegos 2.7.1

## Changes

- Stabilized the home page vertical layout so tall windows keep the same hero and quick-action heights.
- Kept extra window height assigned to the node list area instead of stretching upper cards.
- Preserved the 2.7.0 baseline node rendering and window-edge drag fixes.

## Verification

- `node --check src/app.js`
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_2.7.1_x64-setup.exe`
- SHA-256: `fb25fa9e1698996fce347a9a9c61f4dca396919e7489374306403a603a1e7fca`
