# Aegos 0.3.0 Release Record

## Focus
- Mature the installable Aegos build after the first Aegis 2.0 core migration.
- Fix repeated black console windows after launch.
- Tighten the home dashboard so minimum-window layout is usable without crowding.

## Fixes
- Hidden all PowerShell command launches with `CREATE_NO_WINDOW`.
- Cached LAN IP lookup so status polling no longer starts PowerShell every refresh cycle.
- Rebuilt damaged UI text and icon labels as clean UTF-8.
- Made node table rows clickable for node selection and wired running-state proxy switches to the Tauri backend.
- Removed the home table horizontal scrollbar at 1180x700.

## UI Quality Gates
- Added `npm run smoke:ui`.
- Checks 1280x820 and 1180x700 with system Chrome.
- Fails on page horizontal overflow, node-table horizontal overflow, oversized metric icons, quick-button escape, panel escape, and too few visible node rows.

## Package
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_0.3.0_x64-setup.exe`
- Size: 15,090,495 bytes
- SHA256: `a659a10b0cb48998de3612f334d04ae15d21d4f93d150fd6c0af1f9f6c1d00cd`

## Verification
- `node --check src/app.js`
- `node --check tools/release-audit.js`
- `node --check tools/ui-smoke.js`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run smoke:ui`
- `npm run build`
- `npm run audit:release`
