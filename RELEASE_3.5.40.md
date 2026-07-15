# Aegos 3.5.40

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Config Pipeline

- No UI behavior changed.
- No speed-test behavior changed.
- Moved runtime proxy-group config shaping into `config_pipeline`.
- Kept generated legacy auto-select group naming stable while adding explicit runtime alias recognition.
- `main.rs` now calls the config pipeline for default `Proxies` / auto-select group synthesis instead of rebuilding that logic locally.
- Routing group edits now use the config pipeline's internal-group guard.

## Guardrails

- Tightened backend, release, node-strategy, core-runtime, and speed-closure audits around the new boundary.
- Added explicit audit coverage that default proxy-group generation cannot drift back into `main.rs`.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture` (73 tests passed)
- `npm run audit:release`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run audit:node-strategy-ui`
- `node tools/speed-closure-audit.js`
- `npm run smoke:interactions`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
