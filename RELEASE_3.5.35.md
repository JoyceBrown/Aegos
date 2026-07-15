# Aegos 3.5.35

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- No UI behavior changed.
- No speed-test behavior changed.
- Moved the UI proxy-group controller snapshot fallback decision into the `CoreController` runtime boundary.
- Kept profile fallback shaping, selected proxy resolution, speed-result merge, and manual-node annotation behavior unchanged.

## Guardrails

- Added a core-runtime unit test for the proxy-group snapshot fallback boundary.
- Updated `audit:core-runtime` and `audit:release` so the fallback decision cannot drift back into `main.rs`.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `git diff --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:architecture`
- `npm run audit:connection-closure`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:debt`
- `npm run audit:provider-healthcheck`
- `npm run audit:routing-readonly`
- `npm run smoke:interactions`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
