# Aegos 3.5.17

Source-only checkpoint.

## Runtime Delay Result Closure

- Moved mihomo delay response normalization into `core_runtime`.
- Added `CoreDelayProbeResult` so `main.rs` receives a typed delay/failure result instead of parsing raw delay JSON.
- Moved delay HTTP failure classification into `core_runtime`.

## Audit Guardrails

- Updated core-runtime, backend, speed, and release audits to require the runtime-owned delay result path.
- Added runtime unit coverage for delay HTTP classification and failed delay response normalization.
- Kept speed tests measurement-only; this release does not change scheduling, node switching, or traffic takeover behavior.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `npm run check`
- `npm run audit:speed`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `git diff --check`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
