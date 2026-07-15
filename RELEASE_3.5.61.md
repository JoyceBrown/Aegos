# Aegos 3.5.61

## Core runtime digestion
- Moved core start/reuse/stop command result shaping into `core_runtime`.
- Kept `main.rs` responsible for executing process and proxy operations only, while `core_runtime` now owns the public `ok`, `standby`, `trafficTakeover`, `message`, and `connection` result contract.
- Added unit coverage for fresh start, reused standby start, and stop result shapes.
- Added architecture audit coverage so startup result JSON cannot drift back into ad-hoc `main.rs` construction.

## Why this matters
- This reduces the wrapper-style coupling between Aegos UI commands and mihomo process details.
- Future runtime swaps, multi-engine control, or deeper dataplane ownership can preserve the same Aegos-facing command contract.

## Remaining work
- Runtime lifecycle execution still lives mostly in `main.rs`; later checkpoints should continue moving restart decisions, recovery outcomes, task result envelopes, and controller-side action summaries behind typed runtime APIs.

## Verification
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:stability`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:takeover`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact
- Source-only checkpoint. SHA-256: source-only.
- No installer was produced for this version.
