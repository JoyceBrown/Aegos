# Aegos 2.3.0

## Highlights

- Compare FlClash and Aegos strategy layers and apply the transferable state/model improvements.
- Add persistent selected proxy mapping, similar to FlClash's selected map.
- Preserve real subscription `proxy-groups` while the core is stopped instead of flattening nodes into one synthetic group.
- Resolve group-to-group references recursively and expose `realProxyName` for group rows.
- Apply speed-test delay cache to resolved leaf proxies.
- Roll back selected proxy state if mihomo rejects a live proxy switch.
- Add strategy review notes in `STRATEGY_REVIEW_2.3.0.md`.

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

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.3.0_x64-setup.exe`
- SHA-256: 838650091f74e5a6479d2fa89bf01d27b47bdc57e46e6107aec0eaefc7df62e0
