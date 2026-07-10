# Aegos 2.6.6

## Highlights

- Wires the three node-row action buttons: connect, single-node delay test, and details.
- Adds a backend `test_single_proxy_delay` command that reuses the existing protocol-aware delay tester and updates node health cache.
- Prevents row action clicks from being swallowed by the row selection handler.
- Widens the node action column and keeps action buttons away from the vertical scrollbar.
- Adds regression coverage for node action rendering, spacing, and single-node delay calls.

## Verification

- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.6_x64-setup.exe`
- Size: `15282102`
- SHA-256: `da20826028df8bed10a5d8f801fb09bf33c93e111a9c3e65eac8c6eeff4c6003`
