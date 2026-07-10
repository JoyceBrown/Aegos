# Aegos 2.0.1

## Highlights

- Fixed the remaining sidebar navigation lag: page selection now becomes active on pointer down without waiting for page data requests.
- Deferred page-specific data loading and cancelled stale loads when users switch away quickly, preventing slow connection/diagnostic requests from feeding back into navigation feel.
- Kept page panels mounted as stacked grid layers with `content-visibility`, avoiding `display: none` layout flips during rapid page switching.
- Added regression coverage that verifies sidebar navigation is immediate and stale page loads are cancelled.
- Kept FlClash/Codex isolation intact: Aegos still avoids port 7890 and defaults to 7891/19091.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `node --check tools\release-audit.js`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri\target\release\bundle\nsis\Aegos_2.0.1_x64-setup.exe`
- SHA-256: `d82104a342c6d60de7efed47d5356b7cbea07f31142979bfcf421a69e487941a`
