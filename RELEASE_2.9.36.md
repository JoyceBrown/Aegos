# Aegos 2.9.36

## Focus

- Make the lower node area update immediately when switching subscriptions.
- Keep profile switching verified by the existing backend apply, preflight, hot reload, and rollback path.
- Preserve the previous rule: speed tests only measure latency and never switch or connect nodes.

## Changes

- Added a read-only `preview_profile_groups` backend command that parses the target local subscription file without touching the core, controller, system proxy, or speed-test state.
- Reused the existing Clash YAML group parser through `profile_proxy_groups_for_profile`, so preview and verified refresh share the same basic node extraction path.
- Added frontend `previewProfileNodes()` with sequence guarding so stale preview results cannot overwrite a newer subscription click or rollback.
- Subscription optimistic switching now clears stale speed UI, updates the active profile display, then pre-renders the target profile nodes while the real switch continues in the background.
- Cleared pending row-render timers during profile switching so old node rows cannot flash back after the user switches subscriptions.
- Added interaction smoke and release audit coverage for the new local node preview path.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run audit:diagnostics`
- `npm run audit:responsiveness`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run build`

## Artifact

- Path: `src-tauri/target/release/bundle/nsis/Aegos_2.9.36_x64-setup.exe`
- SHA-256: `ab140266c569d062f34903443ba02cd09c341694c84860981804f07daaba4664`
