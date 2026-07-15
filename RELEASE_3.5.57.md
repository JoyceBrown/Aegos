# Aegos 3.5.57

Source-only runtime digestion checkpoint.

## Changes
- Moved the shared home/diagnostics status surface into `core_runtime`.
- Kept runtime, connection, protection, network endpoint, permissions, and logs under one status shape.
- Replaced the remaining mojibake-prone backend permission label with `Disconnect protection`.
- Added release/core-runtime audit gates so the shared status surface cannot be rebuilt ad hoc in `main.rs`.

## Verification
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:stability`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:takeover`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact
- Source-only checkpoint. SHA-256: source-only.
