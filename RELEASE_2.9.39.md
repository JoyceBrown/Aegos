# Aegos 2.9.39

Source-only release.

## Focus

- Fix large-scale speed-test failures caused by local fake-ip DNS contamination when another proxy app, such as FlClash, is temporarily running.
- Keep Aegos runtime DNS independent so proxy server domains do not resolve to `198.18.0.0/15` fake-ip addresses.

## Changes

- Runtime config now hardens DNS on every subscription/profile render.
- `proxy-server-nameserver` now uses direct upstream resolvers instead of local `127.0.0.1:1053` or fake-ip DNS.
- Aegos DNS listen address moves to `127.0.0.1:1054` to avoid FlClash's common `1053` listener.
- Airport metadata pseudo nodes such as `Traffic: ...` and `Expire: ...` are removed before runtime config and speed-test target collection.
- Node list rendering also ignores metadata pseudo nodes and fake-ip server entries.
- Added regression tests and audit guards for DNS isolation and metadata-node filtering.

## Verification

- `node --check src\app.js`
- `npm run check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run audit:node-flow`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`

## Artifact

- Source-only; no installer produced for this patch.
- SHA-256: source-only
