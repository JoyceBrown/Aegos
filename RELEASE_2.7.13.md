# Aegos 2.7.13

## Changes

- Diagnostics now runs through the shared background job system instead of a foreground diagnostics IPC call.
- Sidebar/page navigation remains immediate while diagnostics is running; diagnostic results are cached and rendered only when the diagnostics page is active.
- Backend and release audits now guard the background diagnostics path.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/backend-audit.js`
- `node --check tools/release-audit.js`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run audit:backend`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.13_x64-setup.exe`
- SHA-256: `a4930491dfb416dd5149ba4f9d3cb36e4a4d6f521af05017859fa5768798ede3`
