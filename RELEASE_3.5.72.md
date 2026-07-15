# Aegos 3.5.72

## Scope

- Separated software runtime state from network availability in the status surface.
- Added backend `network_availability_json` without adding blocking network probes to `app_status`.
- Added `network.availability` to home and diagnostics status surfaces.
- Added visible sidebar fields for 软件状态 and 网络可用.
- Extended `audit:status-vocabulary` to guard the new status truth boundary.

## User Impact

- Aegos no longer implies that "core running" means "network usable".
- Users can see whether Aegos is running, whether traffic is taken over, and whether the network has actually been verified.
- If the app is disconnected, standby, or has a failed/old outbound IP result, the UI can say 未验证 / 不可用 / 需刷新 instead of giving a false success signal.

## Verification

- Passed: `node -c src/app.js`
- Passed: `cargo fmt --manifest-path src-tauri/Cargo.toml`
- Passed: `npm run audit:status-vocabulary`
- Passed: `npm run check`
- Passed: `cargo test --manifest-path src-tauri/Cargo.toml network_availability -- --nocapture`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.72.
- SHA-256: Source-only / not applicable.
