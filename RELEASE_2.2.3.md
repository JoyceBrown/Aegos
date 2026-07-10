# Aegos 2.2.3

## Highlights

- Fix subscription switching preflight for Clash/mihomo profiles whose proxy groups reference other proxy groups.
- Allow built-in mihomo targets such as `PASS` and `COMPATIBLE` in proxy-group references.
- Keep the 2.2.2 hot-reload path through `core-home/aegos-runtime-profile.yaml`.
- Add audit coverage for group-to-group proxy reference validation.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.2.3_x64-setup.exe`
- SHA-256: 8e27625f0961d8260e5940a888dd6b02e5c141d1510a326380facb9d781494f4
