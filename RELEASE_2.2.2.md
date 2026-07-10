# Aegos 2.2.2

## Highlights

- Fix subscription switching while the core is running by hot-reloading mihomo through `/configs?force=true`.
- Write the active runtime config into `core-home/aegos-runtime-profile.yaml` so mihomo accepts the path under its safe-path rules.
- Keep the old restart path as a fallback if hot reload is unavailable.
- Include controller error bodies in diagnostics instead of only showing HTTP status codes.
- Add audit coverage for the subscription hot-reload strategy.

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

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.2.2_x64-setup.exe`
- SHA-256: 17a29f68fcfc7ba8d7289485b08cabe6c37c5956879698d3aaf4302b6e334204
