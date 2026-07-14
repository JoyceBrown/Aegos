# Aegos 3.5.5

## Summary

- Source-only checkpoint for the fifth CoreRuntime/CoreAdapter foundation step.
- Moves `/traffic` streaming snapshot reads into `CoreController::traffic_snapshot`.
- Keeps the existing lightweight 120 ms status heartbeat while removing another ad-hoc controller HTTP client from `main.rs`.
- Extends core and release audits so traffic snapshots must use the core controller adapter.

## Artifact

- Type: Source-only checkpoint; no installer generated.
- SHA-256: Source-only checkpoint; no installer generated.
- Previous test installer remains `src-tauri/target/release/bundle/nsis/Aegos_3.5.0_x64-setup.exe`.

## Verification

- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:debt`
- `npm run audit:security`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run smoke:interactions`

## Remaining Risk

- Some non-controller network requests still belong outside `core_runtime`, such as subscription download and outbound IP lookup.
- More core-specific operations can still be moved: active connection queries, config compiler output, and lifecycle readiness contracts.
- Full mihomo digestion still requires a stronger internal engine contract, not just controller API wrapping.
