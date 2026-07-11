# Aegos 2.7.11

Small routing and responsiveness patch.

- Smart-mode outbound IP lookups now route Aegos internal IP-check domains through the primary selected proxy group, so the visible landing IP reflects the current node instead of an unrelated rule-matched outlet.
- Kept the UI label as "landing IP" without adding extra user-facing complexity.
- Added backend coverage for outbound IP lookup rule injection before general routing rules.
- Added interaction coverage to ensure speed testing and diagnostics do not block sidebar page switching.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run audit:backend`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run build`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.11_x64-setup.exe`
- SHA-256: `c65fdda81d5815ba52ccdfe37d4cd69a589b6147582e251f2e0ee8a58c89c33a`
