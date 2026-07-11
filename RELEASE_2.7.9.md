# Aegos 2.7.9

Small reliability patch focused on live testing feedback and outbound IP recovery.

- Fixed home node delay rows getting stuck at "测速中" when switching common region, favorite, frequent, or fixed-node filters during a speed test.
- Made speed-test completion force a final visible node refresh without blocking normal UI interaction.
- Added "诊断中..." feedback to the diagnostics button while diagnostics are running.
- Hardened outbound IP refresh with validated multi-provider lookup and cached-value fallback when all providers temporarily fail.
- Added smoke and release audit coverage for the speed-test/filter interaction and diagnostics running feedback.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run build`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.9_x64-setup.exe`
- SHA-256: `0fa9f8cb353a48f55f3dda8436d08fa10885c75bc0428c3e157c016e47de78ae`
