# Aegos 2.0.0

## Highlights

- Upgraded Aegos from the 0.5.x reliability line to the 2.0.0 reliability engine line.
- Added the Aegos 2.0 recovery command, which probes the local proxy endpoint, tests candidate routes through mihomo, switches to a verified low-latency candidate, and confirms the proxy exit after switching.
- Added profile failover for Aegos-managed subscriptions: when the active subscription has no usable route, Aegos can try other imported non-built-in profiles.
- Added a home quick action for manual smart recovery and settings for automatic recovery, profile failover, maximum recovery delay, and candidate limit.
- Optimized TUIC delay tests with a protocol-aware fast path: lower timeout, single stable probe URL, and reduced TUIC concurrency to avoid QUIC/UDP handshake pileups during bulk tests.
- Optimized sidebar navigation for rapid clicking: page selection now updates on pointer down, page data loads are deferred, and stale page-load tasks are discarded.
- Reworked page panels into stacked grid layers so sidebar navigation no longer flips panels through `display: none`, reducing layout reflow during rapid page switching.
- Kept FlClash/Codex isolation intact: Aegos still avoids port 7890 and defaults to 7891/19091.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `node --check tools\release-audit.js`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri\target\release\bundle\nsis\Aegos_2.0.0_x64-setup.exe`
- SHA-256: `7260a2554a1c545b4711d63cb6b1d0df8a9275ccb734071b33df44fb5cfcafc3`
