# Aegos 3.5.48

Source-only core runtime extraction checkpoint.

No installer was produced for this patch.

## Changed

- Moved runtime identity matching into `core_runtime::runtime_identity_matches`.
- Added `core_runtime::CoreRuntimeStartAction` and `core_runtime::decide_runtime_start` for launch, reuse, and drift-restart decisions.
- Kept controller readiness probing short-circuited so Aegos does not probe the controller unless a running process and matching runtime identity already exist.
- Added audit coverage to prevent `main.rs` from rebuilding profile/digest reuse decisions.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
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
