# Aegos 3.5.59

Source-only runtime digestion checkpoint.

## Changes
- Moved runtime port parsing into `core_runtime`.
- Moved mixed/controller port pair validation into `core_runtime`.
- Kept `main.rs` responsible for applying settings, while runtime owns port bounds, reserved-port policy, and conflict wording.
- Updated backend, release, takeover, and core-runtime audits to prevent port policy from drifting back into `main.rs`.

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
