# Aegos 2.9.42

## Changes
- Bound Aegos mihomo runtime outbound traffic to the detected physical Windows adapter through `interface-name`, avoiding nested routing through FlClash/Wintun/TUN virtual adapters during speed tests.
- Kept the interface binding runtime-only, so subscription/profile source files are not polluted with machine-specific adapter names.
- Added backend, speed, release, and Rust regression guards for the outbound-interface binding path.
- Removed the stability column from the node page and home common-node list; current-node stability remains on the home status metrics.

## Verification
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `node --check src\app.js`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run audit:responsiveness`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `git diff --check`
- `npm run build`
- `npm run audit:release`

## Artifact
- `src-tauri\target\release\bundle\nsis\Aegos_2.9.42_x64-setup.exe`
- SHA-256: e615849b007db65720807f2c9490d75d2940f7e0430d181cdbe07b116e6f83ab
