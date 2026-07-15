# Aegos 3.5.38

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- No UI behavior changed.
- No speed-test behavior changed.
- Moved routing strategy-group row shaping into `core_runtime`.
- Moved routing strategy-group type canonicalization, automatic-group classification, internal-group filtering, and group counts behind the runtime boundary.
- Kept the `routing_snapshot` command as a thin snapshot assembler instead of rebuilding runtime view-model details in `main.rs`.
- Routed proxy-group snapshot assembly through a typed `CoreController` instead of passing raw controller port and secret through helper boundaries.
- Removed an unused, mojibake `strategyTypeLabel` helper so audits target the real routing strategy label renderer.

## Guardrails

- Added a runtime unit test for strategy-group row shaping.
- Updated routing group/type audits to require the runtime-owned row model.
- Added core-runtime and release-audit gates so the row model cannot silently drift back into `main.rs`.
- Tightened backend/core-runtime/release audits so proxy-group snapshot assembly cannot drift back to raw controller port/secret plumbing.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
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
