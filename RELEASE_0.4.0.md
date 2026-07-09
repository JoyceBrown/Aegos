# Aegos 0.4.0 Release Record

## Focus
- Correct the 0.3.0 maturity gap reported after installation.
- Make the app movable, navigable, less laggy, and expose real core controls from the UI.

## Fixes
- Added real navigation for Home, Nodes, Connections, Profiles, Diagnostics, Logs, and Settings.
- Added Settings controls for System Proxy, Start-with-Proxy, TUN, DNS hijack, Kill Switch, IPv6, LAN access, ports, TUN stack, and log level.
- Wired settings controls to existing Tauri commands: `set_system_proxy`, `update_setting`, and `restart_core`.
- Added connection management, subscription import/update/switch/remove, diagnostics, and log views.
- Added `startDragging()` wiring for the custom titlebar and brand area.
- Disabled transparent window rendering and removed large `backdrop-filter` usage to reduce WebView2 jank.
- Slowed status polling from 2.5s to 5s.
- Fixed minimum-height sidebar overlap and restored a home-page common node list.

## Quality Gates
- `npm run smoke:ui` now checks navigation, settings-page activation, TUN switch visibility, sidebar overlap, node table overflow, panel overflow, and minimum visible node rows.
- `npm run audit:release` now checks transparent-window configuration, nav page presence, TUN switch presence, custom window drag wiring, PowerShell hidden-window behavior, and UI mojibake fragments.

## Package
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_0.4.0_x64-setup.exe`
- Size: 15,085,956 bytes
- SHA256: `f210c4c3cd3ad80cf5e01c3d2b9608ca156d8ad5dde5edcfdf93567e9969ba3d`

## Verification
- `node --check src/app.js`
- `node --check tools/release-audit.js`
- `node --check tools/ui-smoke.js`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run check`
- `npm run smoke:ui`
- `npm run build`
- `npm run audit:release`
- Release executable launch smoke: ran 6 seconds without exiting.
