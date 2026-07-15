# Aegos 3.5.25

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved runtime hot-reload apply endpoint ownership into `core_runtime::CONFIG_FORCE_APPLY_ENDPOINT`.
- Moved runtime hot-reload apply and post-apply version probe SLAs into named runtime constants.
- Added typed `CoreController::apply_runtime_config_path` and `CoreController::config_apply_version_probe` helpers.
- Updated `CoreRuntimeApplyTransaction` to use the typed runtime helpers instead of raw controller requests.

## Guardrails

- Updated backend, core-runtime, and release audits to reject the old raw post-apply `/version` request.
- Kept the existing endpoint and timeout values unchanged; this patch only tightens ownership.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
