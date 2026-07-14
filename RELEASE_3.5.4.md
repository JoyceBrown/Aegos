# Aegos 3.5.4

## Summary

- Source-only checkpoint for the fourth CoreRuntime/CoreAdapter foundation step.
- Moves runtime profile file writes into `core_runtime::write_runtime_profile`.
- Adds a path-confined runtime profile writer that only writes under the managed core home.
- Active and standby runtime preparation now share the same runtime writer boundary instead of duplicating file-write logic in `main.rs`.
- Extends core, backend, and release audits so runtime profile writes cannot drift back into ad-hoc `main.rs` code.

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

- Source profile patching still writes the original subscription profile from `main.rs`; only the runtime profile output is now owned by `core_runtime`.
- Runtime preparation still mixes profile parsing, patching, and logging in `CoreManager`.
- The next extraction should create a profile compiler boundary so subscription/manual/routing config generation has one typed output path.
