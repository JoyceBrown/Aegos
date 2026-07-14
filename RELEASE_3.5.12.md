# Aegos 3.5.12

Source-only checkpoint.

## Config Pipeline Semantics

- Added intent-named config pipeline entrypoints for direct profile generation, profile source patching, speed-test patching, and profile preflight.
- Removed production `main.rs` and `profile_compiler.rs` calls to raw `config_pipeline::patch_config`, `patch_and_preflight`, and `preflight_config`.
- Kept raw patch/preflight primitives inside `config_pipeline` only, so future migrations can move implementation out of `main.rs` without changing production call sites again.

## Guardrails

- Backend/release audits now require the semantic config pipeline entrypoints.
- Backend/release audits reject future production calls to the raw config pipeline primitives.
- Subscription runtime preflight and security audits were updated to track the semantic preflight entrypoint.

## Verification

- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:debt`
- `npm run audit:security`
- `npm run audit:architecture`
- `npm run smoke:interactions`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
