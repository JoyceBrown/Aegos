# Aegos 3.5.20

Source-only checkpoint.

## Runtime Config Boundary

- Moved the runtime configuration preflight engine into `core_runtime`.
- Kept `main.rs` as a thin adapter from app-level `Profile` and `Settings` into `RuntimeConfigPreflightInput`.
- Preserved existing preflight behavior and user-facing failure reasons for malformed configs, missing proxy groups, unsupported proxy types, bad group references, mixed-port drift, and controller-port drift.

## Runtime Resource Boundary

- Moved the managed core resource path contract into `core_runtime`: resource subdirectory, binary name, missing-resource hint, dev path resolution, bundled path resolution, and final path selection.
- Replaced direct core-path construction in `main.rs` with `core_runtime::resolve_core_path`.
- Reused the runtime-owned missing-resource hint in diagnostics and settings checks.

## Audit Guardrails

- Updated backend, release, and core-runtime audits so runtime preflight and core resource ownership must stay inside `core_runtime`.
- Added runtime unit coverage for config preflight acceptance, unsupported proxy type rejection, port drift rejection, and core resource path ownership.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `npm run check`
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

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
