# Aegos 2.9.34

## Focus

- Fix unstable delay tests for Shadowsocks nodes that use obfs plugins, including Huayun-style SS + obfs airport profiles.
- Preserve SIP002 `ss://` plugin query parameters during subscription import.
- Keep speed tests measurement-only: no node switch, no connection takeover, no UI blocking.

## Changes

- Added a dedicated `ss-obfs` speed-test scheduling path.
- Reduced SS-obfs batch concurrency to avoid burst timeouts on legacy/plugin-based SS nodes.
- Prefer HTTP 204 probing for the fast SS-obfs pass, then keep HTTPS fallback probes in the full pass.
- Preserve `plugin=obfs-local;obfs=http;obfs-host=...` from SS URI subscriptions as Mihomo-compatible `plugin: obfs` and `plugin-opts`.
- Expose `speedProtocol` metadata internally so displayed protocol stays `ss` while the scheduler can use the safer SS-obfs strategy.
- Added regression coverage for SS URI obfs parsing and SS-obfs scheduling.

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

- Path: `src-tauri/target/release/bundle/nsis/Aegos_2.9.34_x64-setup.exe`
- SHA-256: `780401568902aa289ab679134f0049fe39cf331d88b897db33120ec68ab5dbc9`
