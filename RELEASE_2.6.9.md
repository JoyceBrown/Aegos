# Aegos 2.6.9

## Changes

- Removed the duplicated current-node and recommended-node cards from the home hero.
- Moved "切换到推荐" into a compact header control with recommended node and delay.
- Removed the duplicated recommended-node quick strip so common nodes have more room.
- Replaced low-value strategy/recommendation metric tiles with system proxy, TUN, and permission status.
- Kept speed test and recommendation switching separated: speed test still only updates delay/recommendation data.

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

`src-tauri/target/release/bundle/nsis/Aegos_2.6.9_x64-setup.exe`

SHA-256: `5f3fd5987ad245631e0dec62dab0d957075ea5d256c54e83b817422ad8e67dd7`
