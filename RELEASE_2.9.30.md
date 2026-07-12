# Aegos 2.9.30

2.9.30 is the post-freeze architecture debt cleanup checkpoint. It does not add a new user-facing feature; it removes legacy paths and tightens the release gates so future 3.0 work starts from a cleaner foundation.

## Changes

- Added `audit:debt` and wired it into the architecture and release gates.
- Removed leftover direct Tauri mutation command paths for core/settings/mode/proxy operations; those operations now stay on the background job model.
- Migrated high-risk frontend list/log/diagnostic rendering to DOM nodes, `textContent`, and `replaceChildrenSafe` instead of dynamic `innerHTML`.
- Deleted legacy profile/config helper paths and `dead_code` allowances that were only kept as old patch fences.
- Moved critical profile, runtime config, settings snapshot, log export, and profile removal writes/deletes behind path-confined atomic helpers.
- Updated backend, security, takeover, diagnostics, release, and architecture audits to verify the cleaned architecture instead of checking for old patch names.

## Verification

- `node --check src/app.js`
- `npm run check`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run audit:takeover`
- `npm run audit:speed`
- `npm run audit:diagnostics`
- `npm run audit:responsiveness`
- `npm run audit:outbound-ip`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run smoke:soak`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.9.30_x64-setup.exe`
- Size: 15,393,687 bytes
- SHA-256: `3d114b7898ecbd96a50f8a0fcb2ba9e49c34a350d4e1c200e475c658de705237`
