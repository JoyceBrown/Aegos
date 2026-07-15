# Aegos 3.5.26

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved routing-page recent rule hit shaping behind the `core_runtime` boundary.
- Added `CoreController::recent_rule_hits_snapshot` and `CoreController::routing_recent_rule_hits_snapshot_or_empty`.
- Added runtime-owned timeout and limit constants for recent rule hit reads.
- Kept the operation read-only: no proxy selection, speed cache write, mode change, or config write is introduced.

## Guardrails

- Added a runtime unit test for recent rule hit aggregation, fallback values, limit handling, and sensitive field redaction.
- Updated backend, core-runtime, and release audits so `main.rs` consumes runtime-shaped recent rule hits instead of reinterpreting raw connection JSON.

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
- `npm run audit:provider-healthcheck`
- `npm run audit:routing-readonly`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
