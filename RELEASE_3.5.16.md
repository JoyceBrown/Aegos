# Aegos 3.5.16

Source-only checkpoint.

## Runtime Connection Snapshot Closure

- Moved idle connection-list fallback into `core_runtime`.
- Moved active connection count and `checkedAt` shaping into `core_runtime`.
- Kept Tauri commands as thin adapters that snapshot runtime identity, release the core mutex, then call typed runtime methods.

## Audit Guardrails

- Updated backend, core-runtime, and release audits to require the runtime-shaped connection list and active-connection metric.
- Added runtime unit coverage for idle connection snapshots.
- Kept connection close APIs behind typed `CoreController` methods.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `git diff --check`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
