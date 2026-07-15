# Aegos 3.5.34

Source-only verification checkpoint. No installer was produced for this patch.

## Runtime Control

- No runtime behavior changed.
- Hardened the `audit:core-runtime` binary version probe after repeated Windows cold-start `mihomo.exe -v` timeouts during validation.
- Replaced the hard-coded 2500 ms audit timeout with a named 7500 ms Windows cold-start SLA.

## Guardrails

- Added a release audit check so the core-runtime audit keeps the named SLA and does not regress to the brittle 2500 ms probe.
- Kept speed-test semantics, provider healthcheck exposure, UI, installer behavior, and runtime controller behavior unchanged.

## Verification

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
