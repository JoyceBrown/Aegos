# Aegos 2.6.10

## Changes

- Renamed "同步状态" to "刷新状态" and updated the success notice.
- Reworked the home recommended node area into a compact info card plus a separate "切换到推荐" button.
- Removed the recommended-node region badge; the compact card now shows node name and delay only.
- Replaced home TUN/permission tiles with upload and download speed.
- Removed the left sidebar realtime traffic card.
- Highlighted "系统代理 未开启" in red so new users can spot missing system takeover quickly.
- Changed the one-click speed test icon to a lightning symbol.

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

`src-tauri/target/release/bundle/nsis/Aegos_2.6.10_x64-setup.exe`

SHA-256: `6d9e20e257f7b2983c05d40722dd95704e44f49d81c99351f5048fe452969d35`
