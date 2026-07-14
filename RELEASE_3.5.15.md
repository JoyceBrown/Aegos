# Aegos 3.5.15

Source-only checkpoint.

## Core Runtime Boundary

- Added a `CoreController::new` constructor so controller identity is created through the runtime boundary instead of field literals in `main.rs`.
- Moved mihomo `/proxies` group snapshot shaping into `core_runtime`.
- Moved proxy item delay/history normalization into `core_runtime`.
- Removed the duplicate proxy normalization helpers from `main.rs`.

## Audit Guardrails

- Updated backend, core-runtime, release, and speed audits to require the typed runtime proxy-group adapter.
- Added runtime unit coverage for proxy group detection, latest history delay normalization, and interface binding.
- Kept speed-test paths measurement-only; this release does not change node selection behavior.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run smoke:interactions`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
