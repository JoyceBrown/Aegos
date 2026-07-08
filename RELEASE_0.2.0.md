# Aegos 0.2.0 Release Record

## Focus
- Compact Aegos dashboard layout.
- First real Tauri/Rust migration of Aegis 2.0 core workflows.

## UI Changes
- Reduced the top dashboard space so the node table is visible earlier.
- Shrunk the connection ring, metric icons, command buttons, and quick-action pills.
- Changed the quick section to a tighter two-column layout.
- Matched the window minimum size more closely to the Aegis 2.0 desktop layout.

## Core Migration
- Added a Rust `CoreManager` for mihomo startup, shutdown, restart, runtime config patching, and controller API calls.
- Added profile storage, built-in direct profile generation, remote subscription import/update, active profile selection, and profile removal.
- Added system proxy control through Windows registry/WinInet refresh.
- Added Kill Switch enable/disable scripting through Windows Firewall.
- Added TUN-related runtime config patching: enable, stack, DNS hijack, IPv6, LAN binding, and log level.
- Added proxy group, proxy switch, connection list, close connection, close all connections, diagnostics, and log clear commands.

## Package
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_0.2.0_x64-setup.exe`
- Size: 15,077,638 bytes
- SHA256: `d24764387ed9e9e422a7714b9aec2bdce428b50fcc0a6724a9bcce2d4a8a30c5`

## Verification
- `node --check src/app.js tools/release-audit.js`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run build`
- `npm run audit:release`
- Visual screenshot: `design-qa-aegos-0.2-final2.png`

## Known Follow-Up
- Add full multi-page UI for profiles, connections, diagnostics, logs, and settings.
- Add installed-app smoke automation equivalent to Aegis 2.0.
- Add administrator elevation flow for TUN/Kill Switch actions.
