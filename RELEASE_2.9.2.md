# Aegos 2.9.2

Source-only small release.

## Changes

- Added a connection closure summary for core start results.
- Added the same closure summary to background node switch results.
- Closure includes core running, traffic takeover, system proxy applied, TUN, mode, active profile, current node, and cached outbound IP status.
- Kept the heartbeat lightweight; closure is returned from explicit operations instead of making `status()` heavier.
- Added backend and release audit coverage for the closure contract.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
