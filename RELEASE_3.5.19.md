# Aegos 3.5.19

Source-only checkpoint.

## Runtime Capability Boundary

- Moved the bundled runtime proxy-type capability matrix from `main.rs` into `core_runtime`.
- Moved proxy-type normalization and support checks behind the runtime boundary.
- Updated runtime preflight reports to use the current runtime contract and `v1.19.28` version constant instead of a stale hardcoded core version.

## Audit Guardrails

- Updated backend and release audits so protocol support must remain explicit in `core_runtime`.
- Added runtime unit coverage for `hy2`/`socks` normalization, unsupported type rejection, and protocol capability JSON version consistency.
- Kept parser-facing URI protocol support in `main.rs`, while runtime proxy support is owned by the runtime module.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run check`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
