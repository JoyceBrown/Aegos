# Aegos 3.5.7

## Summary

- Source-only checkpoint for controller connection API absorption.
- Moves connection list, active connection count, single connection close, and all-connections close behind `CoreController`.
- Keeps UI command handlers lock-light: they snapshot running/controller state and perform controller I/O after releasing `CoreManager`.
- Tightens core, backend, and release audits so `/connections` usage must be routed through the adapter methods.

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

- Profile patch/preflight internals still need extraction from `main.rs`.
- Some controller operations such as proxy group selection still rely on the generic adapter request path; later stages should type them.
- This step reduces controller endpoint sprawl but does not change mihomo internals.
