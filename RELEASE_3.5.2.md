# Aegos 3.5.2

## Summary

- Source-only checkpoint for the second CoreRuntime/CoreAdapter foundation step.
- Moves runtime profile YAML normalization into `core_runtime`, including `interface-name` binding and runtime digest calculation.
- Keeps Windows physical-adapter detection in the platform layer, but makes the dataplane runtime profile artifact owned by the core runtime boundary.
- Extends the core runtime audit so runtime YAML normalization cannot silently move back into `main.rs`.

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

- Runtime profile source parsing, subscription repair, hot reload, rollback, and standby speed-test preparation are still mostly in `main.rs`.
- The next extraction should move hot reload and controller config application behind an explicit runtime transaction instead of adding more direct calls around `/configs?force=true`.
- Historical UI copy encoding debt still exists and should be handled in a separate controlled cleanup checkpoint.
