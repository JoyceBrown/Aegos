# Aegos 2.9.46

## Changes
- Moved node-level diagnostics onto a snapshot path: the command now copies core state quickly, then releases the `CoreManager` mutex before assembling proxy groups, filtering logs, and generating recovery suggestions.
- Consolidated recovery suggestion ranking into the same snapshot helper used by node diagnostics, preventing duplicated recommendation logic from drifting.
- Updated backend audit coverage so node diagnostics cannot regress to the old lock-heavy command path.

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
