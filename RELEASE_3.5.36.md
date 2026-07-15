# Aegos 3.5.36

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- No UI behavior changed.
- No speed-test behavior changed.
- Made `CoreController` clonable so background speed workers carry the typed runtime adapter instead of raw controller port and secret pairs.
- Updated batch speed, single-node speed, and recovery suggestion probes to use the typed controller boundary.

## Guardrails

- Updated backend, core-runtime, release, and speed audits so delay probe helpers must accept `CoreController`.
- Added negative guards against reintroducing controller-port/secret delay helper signatures.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `git diff --check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:speed`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:release`
- `npm run audit:architecture`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:connection-closure`
- `npm run audit:provider-healthcheck`
- `npm run audit:routing-readonly`
- `npm run smoke:interactions`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
