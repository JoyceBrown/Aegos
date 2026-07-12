# Aegos 2.9.50

## Changes
- Removed the legacy synchronous `test_proxy_delays` Tauri command, which could lock the core while starting a speed test and returning full proxy groups.
- Changed `cancel_proxy_delay_test` to reset the shared speed-test state directly instead of locking `CoreManager`.
- Added release audit coverage so the old lock-heavy speed-test command cannot be re-registered.

## Verification
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `node --check src\app.js`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:responsiveness`
- `npm run audit:architecture`
- `npm run audit:diagnostics`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source-only responsiveness cleanup. No installer was produced for this checkpoint.
- SHA-256: source-only
