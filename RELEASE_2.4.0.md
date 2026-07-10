# Aegos 2.4.0

## Highlights

- Reliability-engine checkpoint from the 2.3.1 to 2.3.4 development line.
- Adds profile-switch transaction diagnostics for preflight, apply, completion, and rollback.
- Adds digest-based no-op config apply to avoid unnecessary mihomo hot reloads.
- Adds a shared operation queue for core-changing actions.
- Adds local integration coverage for switching between two profiles with real proxy-group structure.
- Extends backend and release audits so the reliability engine cannot be removed silently.

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

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.4.0_x64-setup.exe`
- SHA-256: 7db670be6001a57d700d3a720e4acc2939c26e158dc0778a086e5745f03803af
