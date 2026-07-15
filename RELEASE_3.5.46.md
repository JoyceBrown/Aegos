# Aegos 3.5.46

Source-only architecture checkpoint. No installer was produced for this patch.

## Core Runtime

- No UI behavior changed.
- No connection, node switch, speed test, or diagnostics workflow behavior changed.
- Moved core-facing failure classification into `core_runtime`:
  - `classify_failure_reason`,
  - `classified_error`,
  - common timeout/DNS/TLS/auth/controller/config/network classification coverage.
- Removed the old classifier implementation from `main.rs`.
- Removed historical mojibake-only classifier branches while preserving explicit English failure categories.

## Guardrails

- Updated backend and release audits so the classifier cannot drift back into `main.rs`.
- Expanded `npm run audit:core-runtime` to enforce the new classifier boundary.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:release`
- `npm run audit:backend`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:core-runtime`
- `npm run audit:stability`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
