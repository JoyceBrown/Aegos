# Aegos 3.5.37

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- No UI behavior changed.
- No speed-test behavior changed.
- Routed the routing page recent-rule-hit snapshot through the existing typed `CoreController` captured from `CoreManager`.
- Removed the routing snapshot path's local controller-port/secret reconstruction.

## Guardrails

- Added a routing read-only audit guard so routing snapshots must use the typed controller for recent rule hits.
- Kept routing mutation commands disabled.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run audit:routing-readonly`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:backend`
- `npm run audit:speed`
- `npm run audit:architecture`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:connection-closure`
- `npm run audit:provider-healthcheck`
- `npm run smoke:interactions`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
