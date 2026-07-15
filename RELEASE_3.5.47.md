# Aegos 3.5.47

Source-only core runtime extraction checkpoint.

No installer was produced for this patch.

## Changed

- Moved core startup failure message shaping into `core_runtime::CoreStartFailureContext`.
- Kept `main.rs` responsible only for collecting runtime facts such as active profile, ports, core path, and recent logs.
- Replaced a legacy mojibake fallback in the startup failure path with a clear `no active profile` diagnostic.
- Added audit coverage to prevent startup failure wording from drifting back into `main.rs`.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:stability`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
