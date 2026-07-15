# Aegos 3.5.39

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- No UI behavior changed.
- No speed-test behavior changed.
- Moved proxy-group snapshot default row shaping into `core_runtime`.
- Moved `Proxies` / `Auto Select` group-name alias policy into `core_runtime`.
- Moved proxy-group reference resolution and manual fixed-node annotation behind the runtime boundary.
- Kept the remaining speed-result overlay in `main.rs` because it depends on `SpeedTestState` and should not be mixed into pure runtime snapshot shaping yet.

## Guardrails

- Added runtime tests for default `Proxies` / auto-select row synthesis.
- Added runtime tests for group-reference leaf resolution and manual-node flags.
- Tightened backend, core-runtime, and release audits so proxy-group snapshot shaping cannot drift back into `main.rs`.

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
- `npm run audit:routing-readonly`
- `npm run audit:routing-groups`
- `npm run audit:routing-types`
- `npm run audit:connection-closure`
- `npm run audit:provider-healthcheck`
- `npm run audit:architecture`
- `npm run smoke:interactions`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
