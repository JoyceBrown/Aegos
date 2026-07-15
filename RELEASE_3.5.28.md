# Aegos 3.5.28

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved connection phase, connection status summary, and job connection closure shaping into `core_runtime`.
- `main.rs` now supplies runtime facts and current UI context, while `core_runtime` owns the JSON contract for connection state.
- Preserved existing user-facing fields: `phase`, `label`, `nextAction`, `coreRunning`, `trafficTakeover`, `systemProxyWanted`, `systemProxyApplied`, `tunEnabled`, `takeoverComplete`, `currentNode`, `outboundIp`, and `outboundIpKnown`.

## Guardrails

- Added runtime unit coverage for disconnected, standby, TUN, system-proxy, core-only, and outbound-IP-known states.
- Updated backend, release, architecture, and connection-closure audits to reject local connection phase/closure shaping in `main.rs`.
- Fixed `audit:connection-closure` so it remains valid after the 3.4 lane and reads the runtime boundary source directly.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:architecture`
- `npm run audit:connection-closure`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:debt`
- `npm run audit:provider-healthcheck`
- `npm run audit:routing-readonly`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
