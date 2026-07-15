# Aegos 3.5.42

Source-only architecture checkpoint. No installer was produced for this patch.

## Speed Runtime

- No UI behavior changed.
- No speed-test probing behavior changed.
- Added `speed_runtime` as the shared speed-test state boundary.
- Moved speed-test run state, node health records, snapshots, run freshness signatures, failure transitions, and reset/cancel state transitions out of `main.rs`.
- Kept `main.rs` focused on controller preparation, probe scheduling, and protocol-aware probing.

## Guardrails

- Added speed-runtime checks to backend, release, stability, and architecture audits.
- Added unit coverage for speed run preparation, cancellation/reset, and confidence freshness.
- Added regression checks that `main.rs` must not re-own `SpeedTestState`, `NodeHealth`, or speed snapshot/reset helpers.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture` (77 tests passed)
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
