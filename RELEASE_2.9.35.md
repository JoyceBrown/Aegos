# Aegos 2.9.35

## Focus

- Fix large-scale TUIC / AnyTLS batch speed-test failures caused by slow deep retry behavior and HTTPS-first probing.
- Make subscription switching immediately cancel stale speed tests and clear old visible delay state.
- Keep the previous rule: speed tests only measure latency and never switch or connect nodes.

## Changes

- Batch speed tests now use a fast-pass strategy only.
- Single-node speed tests keep full retry probing for deeper diagnosis.
- TUIC / AnyTLS / Hysteria / WireGuard / SS-obfs fast-pass probes now prefer HTTP 204 targets.
- Added a speed-test `runId` so old background workers cannot write results into a newer subscription or newer speed run.
- Switching subscriptions now resets backend speed state and clears frontend speed UI immediately.
- Home and node page speed result syncing still uses the shared result stream.
- Added speed audit rules for fast-pass batch tests and stale-result cancellation.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run check`
- `npm run audit:speed`
- `npm run audit:responsiveness`
- `npm run smoke:interactions`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run smoke:perf`
- `npm run build`

## Artifact

- Path: `src-tauri/target/release/bundle/nsis/Aegos_2.9.35_x64-setup.exe`
- SHA-256: `65aece012b788a6b416d2b5583cd33143b68b214bf8730e0dacd7bededd83b7b`
