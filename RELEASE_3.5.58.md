# Aegos 3.5.58

Source-only runtime digestion checkpoint.

## Changes
- Moved public settings surface shaping into `core_runtime`.
- Moved reserved mixed-port policy and reason into the runtime boundary.
- Kept home and diagnostics settings on the same runtime-owned shape.
- Updated backend, release, takeover, and core-runtime audits for the new boundary.

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
