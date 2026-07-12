# Aegos 2.9.45

## Changes
- Moved high-frequency `proxy_groups` command assembly onto a short-snapshot path: it now copies running state, controller port, secret, selected map, manual-node names, and speed state under the core lock, then releases the lock before controller `/proxies` requests or profile YAML parsing.
- Moved `preview_profile_groups` subscription preview parsing outside the core lock, so switching subscriptions can render local preview nodes without waiting behind unrelated core work.
- Consolidated proxy-group assembly helpers for controller groups, profile YAML groups, selected-map resolution, speed overlay, and manual-node annotation.
- Removed old unused wrapper methods after the helper extraction to avoid parallel old/new logic.
- Updated backend and release audits to enforce that node-list refresh and subscription preview no longer call the old lock-heavy paths.

## Verification
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:responsiveness`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:architecture`
- `npm run audit:diagnostics`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `node --check src\app.js`
- `git diff --check`

## Artifact
- Source-only responsiveness hardening. No installer was produced for this checkpoint.
- SHA-256: source-only
