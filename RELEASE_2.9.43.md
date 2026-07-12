# Aegos 2.9.43

## Changes
- Moved single-node speed tests onto the shared background speed-state path, so failed, timeout, or slow nodes no longer hold the UI/core lock while retrying.
- Kept single-node deep retry for diagnostics, but the frontend now polls `speed_test_status` for the result instead of waiting on a blocking command.
- Added audit coverage so single-node speed tests must stay queued/backgrounded and must not switch proxies.

## Verification
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `node --check src\app.js`
- `npm run audit:speed`
- `npm run audit:node-flow`
- `npm run audit:responsiveness`
- `npm run audit:backend`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `git diff --check`

## Artifact
- Source-only small bugfix. No installer was produced for this checkpoint.
- SHA-256: source-only
