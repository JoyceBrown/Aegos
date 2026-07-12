# Aegos 2.9.52

## Changes
- Added an installer-candidate audit gate for real test builds.
- The installer candidate gate verifies version alignment, NSIS artifact existence, artifact hash in release notes, WebView2 bootstrapper behavior, bundled mihomo core, non-transparent resizable window settings, and default ports that avoid 7890.
- Made large subscription node indexing lazy so first-screen rendering does not synchronously index every node in very large subscriptions.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.52.

## Verification
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `node --check src\app.js`
- `node --check tools\release-audit.js`
- `node --check tools\installer-candidate-audit.js`
- `npm run audit:backend`
- `npm run audit:stability`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:responsiveness`
- `npm run audit:architecture`
- `npm run audit:diagnostics`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run audit:takeover`
- `npm run audit:debt`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `npm run build`
- `npm run audit:installer`
- `npm run audit:release`
- `git diff --check`

## Artifact
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.9.52_x64-setup.exe`
- Size: 15,402,346 bytes
- SHA-256: EC452690D2BD4C4889CC01144E3C31024AB48C37FA8692500AE0D25EEA7F8E82
