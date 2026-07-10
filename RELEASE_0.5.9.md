# Aegos 0.5.9

## Fixes

- Fixed the root cause of speed-test delays not appearing when mihomo was running a stale profile.
- The core manager now tracks which profile is actually running.
- Starting the core now restarts mihomo if the running profile or controller endpoint drifted.
- One-click speed test now self-heals: if the controller is unavailable, it restarts the active profile before testing.
- Cleans runtime-profile state when mihomo exits or is stopped.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `npm run smoke:ui`
- `npm run smoke:interactions`
