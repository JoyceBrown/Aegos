# Aegos 2.9.33

Installer checkpoint for frontend speed-test result streaming.

## Changes

- Speed polling now applies `speed_test_status.delays/health` directly to the local node model instead of waiting for full `proxy_groups` refreshes.
- Home one-click speed test and node-page batch speed test now share the same frontend speed state.
- Home and node tables are rendered together for speed-result updates, so switching pages during a test keeps visible delays in sync.
- Full node refresh is kept as a final consistency pass, while running-state updates stay lightweight and non-blocking.
- Added interaction and audit coverage for home-to-node and node-to-home speed result synchronization.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run audit:speed`
- `npm run audit:responsiveness`
- `npm run smoke:interactions`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.9.33_x64-setup.exe`
- SHA-256: `3f8f17218b64896598b00a27987a157915c3dacc4a38e688d7cf228257567a43`
