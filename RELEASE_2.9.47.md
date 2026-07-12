# Aegos 2.9.47

## Changes
- Made batch speed-test startup non-blocking at the Tauri command boundary: clicking speed test now immediately marks a run as preparing/running and returns before standby core preparation or proxy-group assembly.
- Added runId guarding so cancelled or stale speed-test preparation cannot revive an old run after the user switches context.
- Added backend audit coverage to prevent the batch speed-test command from regressing to the old lock-heavy direct call path.

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
