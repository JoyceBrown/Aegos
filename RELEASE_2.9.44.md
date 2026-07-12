# Aegos 2.9.44

## Changes
- Decoupled speed-test polling, log export/clear, and connection controls from the main `CoreManager` mutex so they do not queue behind unrelated core, subscription, or diagnostic work.
- Moved connection list/count/close controller requests onto short snapshot paths that release the core lock before HTTP requests.
- Cached process elevation detection for the lifetime of the app instead of launching PowerShell during every status refresh.
- Reused one proxy-group snapshot inside node diagnostics to avoid duplicate controller/YAML work when failed node diagnostics are captured.
- Tightened large node-list scan limits so rapid page/filter changes with thousands of nodes do not create severe main-thread long tasks.
- Updated backend, diagnostics, security, and release audits to enforce the new non-blocking paths and prevent old dead-code paths from returning.

## Verification
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `node --check src\app.js`
- `npm run audit:backend`
- `npm run audit:diagnostics`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`

## Artifact
- Source-only responsiveness hardening. No installer was produced for this checkpoint.
- SHA-256: source-only
