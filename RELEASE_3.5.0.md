# Aegos 3.5.0

## Summary

- Upgraded the bundled mihomo dataplane from `v1.19.27` to `v1.19.28`.
- Added Aegos-managed core runtime identity: engine, role, expected version, binary SHA-256, path, and verification state.
- Added `core_runtime_info` backend command and `status.runtimeInfo` so Aegos can reason about the core as a managed internal engine instead of a loose external executable.
- Added `audit:core-runtime` to lock the approved core version, hash, gVisor tag, Tauri bundle path, and runtime identity wiring.
- Replaced the remaining native subscription rename prompt with the app dialog flow.
- Re-tightened large node list rendering and strategy-group reference filtering after restoring frontend source consistency.
- Repaired the 3.5.0 foreground acceptance path after encoding recovery: connection button optimism, node sort labels, target-site strategy editing copy, disconnect-protection feedback, diagnostics feedback, and region inference are verified again.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.5.0_x64-setup.exe`
- Size: `15,721,272 bytes`
- SHA-256: `586087958A27FDBFD1FC15753613B5E0DD39C592D369684B8D2C535C8D569BEF`

## Core Runtime

- Bundled core: `resources/core/mihomo.exe`
- Core version: `Mihomo Meta v1.19.28 windows amd64 with go1.26.5`
- Core tag: `with_gvisor`
- Core SHA-256: `C14BDA8DC4CC8910CCD2110FE2BE083C51A1B66DA59141A0B87AFF6FE6126517`
- Previous core backup: `resources/core/archive/mihomo-v1.19.27-windows-amd64-with-gvisor-77f8dee03001916c2b7c28c3094690bc5f78f0e8c2187f1488073214417dc44d.exe`

## Verification

- `node --check src/app.js`
- `node --check tools/core-runtime-audit.js`
- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:debt`
- `npm run audit:backend`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run audit:node-strategy-ui`
- `npm run audit:global-interaction-product`
- `npm run audit:release`
- `npm run build`

## Remaining Risk

- This release upgrades the bundled core and adds the first Aegos-owned runtime identity layer. It does not yet implement the full CoreAdapter/config compiler refactor.
- The frontend source had to be restored after a local encoding recovery failure during cleanup. The release gates now pass and U+FFFD mojibake fragments were removed, but follow-up work should continue the planned CoreAdapter split and move UI copy toward a dedicated text resource to prevent future encoding damage.
