# Aegos 2.7.4

## Changes
- Added a clear core-ready / traffic-takeover / standby runtime model.
- Speed tests can prepare a standby mihomo controller without enabling system proxy, TUN, or switching nodes.
- Single-node and batch speed tests now share the same non-takeover preparation path.
- Moved the quick subscription menu to a body-level overlay so it stays above home panels.
- Added narrow inner window drag gutters while leaving the outer resize edge to native Windows resizing.
- Tightened the home page height model so tall windows give more space to node rows instead of blank hero area.
- Updated audits and interaction smoke coverage for standby speed tests, topmost subscription menu, and the new runtime state model.

## Verification
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run build`

## Artifact
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.4_x64-setup.exe`
- SHA-256: `9d8a3ab5a86995d6a3a06e0ddf38d82f55e043d6bb2c28939f897d0120806dbb`
