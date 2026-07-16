# Aegos 3.6.30

## UI/UX proposal deployment

- Evaluated the supplied UI/UX proposal against the current Tauri native frontend and rejected a high-risk React/MUI/shadcn migration.
- Added the UI architecture, token, interaction-state, runtime-flow, duplication, stack, and license deployment contracts under `docs/ui`.
- Replaced the permanently expanded sidebar network/task panels with a compact runtime summary.
- Added a right-side status center that reuses the existing runtime snapshot and background job store without adding backend commands.
- Added keyboard focus containment, Escape/backdrop close, trigger focus restoration, reduced-motion support, and a drag-region overlap guard.
- Reduced ordinary panel shadow and blur intensity while preserving the existing visual identity and stable component geometry.
- Added a UI architecture release gate that rejects dangerous HTML sinks, direct controller access, runtime YAML handling in pages, and unapproved frontend frameworks.

## Stage 7 completion

- Consolidated visual and layout ownership into a semantic Stage 7 token system.
- Replaced window, dialog, favorite, and node action glyphs with the centralized SVG-mask icon registry.
- Added Chinese accessible names and tooltips for icon-only controls.
- Unified stable hover, pressed, pending, disabled, and keyboard focus feedback without text or control-size jitter.
- Added reduced-motion and Windows forced-colors support.
- Removed the whole-page transition after performance testing proved it harmed rapid navigation.
- Added 100%, 125%, 150%, 175%, and 200% DPI layout coverage and canonical screenshots for all seven pages.
- Kept the literal 3.6.24 Tauri command call surface unchanged.

## Verification

- The carried `3.5.71 - 3.6.40` mainline remains authoritative, including the `3.5.86` non-blocking pressure contract.
- Stage 4 configuration deployment, Stage 5 Windows takeover, and Stage 6 repair-center gates remain mandatory.
- Rust unit tests: `113/113` passed.
- UI, interaction, performance, and soak smoke: passed.
- Stage 1-7, security, installer, and release audits: passed.
- Performance target: 420 rapid navigation changes with no severe long task.

Commands used for final release verification:

```text
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run smoke:ui
npm run smoke:interactions
npm run smoke:perf
npm run smoke:soak
npm run audit:current-mainline
npm run audit:phase2-pressure
npm run audit:stage2-closure
npm run audit:config-deployment
npm run audit:system-takeover-stage5
npm run audit:diagnostics-stage6
npm run audit:stage7-visual
npm run audit:ui-architecture
npm run audit:runtime-regression
npm run audit:installer-regression
npm run audit:stability
npm run audit:core-runtime
npm run audit:takeover
npm run audit:security
npm run audit:release
```

## Remaining risk

- Browser DPI emulation verifies CSS layout and raster scaling; final appearance can still vary with the physical display, Windows font rendering, and GPU driver.
- TUN, firewall, and system takeover behavior remains dependent on Windows administrator policy and third-party security software.
- This visual release intentionally does not change network command behavior.
- The proposal document was evaluated structurally. LibreOffice was unavailable, so its original Word pagination and visual rendering could not be independently verified.

## Artifact

- Path: `src-tauri/target/release/bundle/nsis/Aegos_3.6.30_x64-setup.exe`
- Size: `15,863,670 bytes`
- SHA-256: `2b5498cf71a52714633e1f1352018a87b13b8d5987c61e4e8e836fca7d1cdc40`
