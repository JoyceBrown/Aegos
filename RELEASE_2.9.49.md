# Aegos 2.9.49

## Changes
- Hidden proxy-group reference rows such as `HK`, `JP`, `SG`, `TW`, and `US` from ordinary node lists while keeping the internal strategy-group model intact for future routing/group UI.
- Excluded proxy-group references from speed-test target collection so batch and single-node speed tests measure real proxy nodes only.
- Added regression coverage for proxy-group references entering speed targets and release/speed audits for the display and measurement rules.

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
- Source-only cleanup. No installer was produced for this checkpoint.
- SHA-256: source-only
