# Aegos 3.5.18

Source-only checkpoint.

## Runtime Status Model Closure

- Moved runtime status fields into `core_runtime::runtime_status_json`.
- Kept the existing app status API stable: `runtime`, `runtimeInfo`, `running`, `coreReady`, `trafficTakeover`, `standby`, `controller`, and `version` remain present.
- Removed direct `status()` hardcoding of the mihomo dataplane identity and controller readiness shape.

## Audit Guardrails

- Updated backend, core-runtime, and release audits to require the runtime-owned status snapshot fields.
- Added runtime unit coverage to lock the legacy status field shape while moving ownership into `core_runtime`.
- Kept `app_status` lightweight: no controller `/version` probe is introduced.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `npm run check`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `git diff --check`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
