# Aegos 2.9.48

## Changes
- Made single-node speed-test startup non-blocking at the Tauri command boundary: clicking a node speed button now immediately marks that node as testing and returns before standby core preparation or proxy-group assembly.
- Added runId guarding for single-node tests so stale preparation failures cannot overwrite a newer speed run.
- Added backend audit coverage to prevent single-node speed tests from regressing to the old lock-heavy direct call path.

## Verification
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:responsiveness`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:architecture`
- `npm run audit:diagnostics`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `node --check src\app.js`
- `git diff --check`

## Artifact
- Source-only responsiveness hardening. No installer was produced for this checkpoint.
- SHA-256: source-only
