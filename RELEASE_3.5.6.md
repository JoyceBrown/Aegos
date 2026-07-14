# Aegos 3.5.6

## Summary

- Source-only checkpoint for the first profile compiler boundary.
- Adds `profile_compiler::compile_profile_file` and `compile_profile_source` as the typed entry for source profile reading, YAML parse, settings patch, runtime preflight, serialization, and digest generation.
- Keeps the existing patch/preflight internals in place, but removes the full compile pipeline from `CoreManager`.
- Extends backend and release audits so rendered profile compilation cannot silently drift back into `main.rs`.

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

- `patch_config_with_settings` and `preflight_runtime_config` still live in `main.rs` and are the next major extraction targets.
- Subscription import/update still has direct patch serialization paths that should later use the same compiler boundary.
- This is a boundary-forming step, not a full compiler rewrite.
