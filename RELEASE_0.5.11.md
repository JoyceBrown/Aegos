# Aegos 0.5.11

## Fixes
- Forced all mihomo controller requests to bypass the system proxy, so one-click speed tests query `127.0.0.1` directly.
- Kept lower-concurrency speed testing and retry fallback from 0.5.10.
- Preserved runtime profile/controller self-healing from 0.5.9.
- Applied advanced port/TUN/log-level settings in one batch command, so a running core restarts only once.
- Validated proxy/controller ports, TUN stack, and log level before persisting settings.
- Extended release audit coverage for version consistency, release notes, and advanced-settings wiring.
- Reserved `7890` for FlClash/Codex traffic and moved Aegos defaults to `7891/19091`.
- Added administrator detection, diagnostics, and an in-app administrator restart command for TUN/Kill Switch flows.
- Blocked non-admin TUN/Kill Switch enable attempts with explicit recovery guidance.
- Reworked node speed tests to follow FlClash's non-blocking pattern: start tests in the background, expose progress, and refresh delay results incrementally instead of blocking the UI until all nodes finish.
- Applied FlClash-inspired speed-test scheduling: reuse one controller HTTP client, keep 50-way concurrency, write each completed node result immediately through a channel instead of waiting for the whole batch, and poll progress every 300 ms.
- Marked delays below 100 ms in green, delays at or above 100 ms in red, and limited the low-latency node list to values below 100 ms.
- Fixed home node table layout when the window is stretched tall or resized to the minimum height, keeping the region filters, table header, and first row aligned without large gaps or overlap.
- Added a shared optimistic mutation layer and lightweight UI store for low-risk interactions, so home menus, mode, node, subscription selection/removal, setting toggles, connection closing, and log clearing update the UI immediately while backend work runs in the background with rollback on failure.

## Verification
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:release`
- `npm run smoke:ui`
- `npm run smoke:interactions`

## Artifact
- `src-tauri/target/release/bundle/nsis/Aegos_0.5.11_x64-setup.exe`
- SHA-256: `27baf1089ae7cefb909a3dcf17cd8270bf4cd5abdc0332d0b4853bfe20121550`
