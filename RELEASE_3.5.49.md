# Aegos 3.5.49

Source-only core runtime extraction checkpoint.

No installer was produced for this patch.

## Changed

- Added `core_runtime::CoreRuntimeRestartPlan` to own restart takeover preservation decisions.
- Added `core_runtime::CoreRuntimeRestartAction` to choose whether a restart returns to connected takeover or standby mode.
- Wired runtime drift restart and explicit proxy-preserving restart through the shared restart plan.
- Added audit coverage so restart intent does not drift back into scattered `main.rs` branches.

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
