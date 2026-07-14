# Aegos 3.5.11

Source-only checkpoint.

## Config Pipeline Absorption

- Added `src-tauri/src/config_pipeline.rs` as the single production entrypoint for runtime config patching and preflight.
- Routed profile compile, subscription import/update, diagnostics preflight, routing apply/undo/commit, DNS/IPv6 safety snapshots, direct profile generation, and speed-test firewall port patching through the pipeline.
- Kept low-level `patch_config_with_settings` and `preflight_runtime_config` available as guarded primitives and tests, rather than exposing them as scattered production call sites.

## Guardrails

- Preserved the typed `CoreController` boundary from 3.5.8-3.5.10.
- Backend/release audits now check that the config pipeline is wired through production paths.
- Version metadata was synchronized across package, lockfile, Cargo, Tauri config, and the visible app label.

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
