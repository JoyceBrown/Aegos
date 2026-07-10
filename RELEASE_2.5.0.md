# Aegos 2.5.0

## Highlights

- Speed and route engine checkpoint.
- Added health-scored low-latency recommendations.
- Added `selectBestProxy` so Aegos can switch to the best available sub-100 ms candidate through the same operation queue as manual proxy changes.
- Updated node rows and recommendation chips to display protocol, candidate state, median delay, jitter, and recommendation state.
- Extended smoke and audit coverage so low-latency lists cannot include high-latency red nodes.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.5.0_x64-setup.exe`
- SHA-256: e3d79962927765daa21474b832cc963ef41632b42b5036785b13132a37fe6bb7
