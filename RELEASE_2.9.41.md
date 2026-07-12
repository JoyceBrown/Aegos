# Aegos 2.9.41

## Changes
- Refined speed-test failure classification for fake-ip DNS contamination, protection/firewall blocking, node connectivity, missing nodes, and controller delay-test failures.
- Added speed-test preflight to fail fast when measurable targets are missing or fake-ip targets enter the test set.
- Added diagnostics coverage for runtime speed-test DNS isolation.
- Kept speed tests measurement-only: no proxy switching, no system proxy takeover, no TUN takeover.
- Extended node status labels so users see specific reasons instead of generic failed/unknown states.

## Verification
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `node --check src\app.js`
- `npm run audit:speed`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run audit:security`
- `npm run audit:backend`
- `npm run audit:responsiveness`
- `npm run build`

## Artifact
- `src-tauri\target\release\bundle\nsis\Aegos_2.9.41_x64-setup.exe`
- SHA-256: e5109c9a2ea5648dccc308c406178bc2003111e2bcc571943a718bfe9fe71d87
