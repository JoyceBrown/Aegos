# Aegos 3.5.69

## Core runtime digestion
- Moved Windows system proxy script input shaping into `core_runtime`.
- Added `WindowsSystemProxyScriptPlan` so takeover and snapshot restore share one runtime-owned plan for registry values and PowerShell string literals.
- Kept the actual Windows registry writes, PowerShell execution, and WinInet refresh in `main.rs`.
- Updated audits so `main.rs` cannot rebuild system proxy takeover literals or call the raw takeover plan directly.

## Why this matters
- System proxy enable/restore now has one audited path for escaping proxy server and bypass-list values.
- This reduces the chance of malformed PowerShell when restoring a previous Windows proxy snapshot with special characters.

## Remaining work
- The PowerShell script body itself is still manager-side execution.
- Future cleanup should shape script execution outcomes and rollback diagnostics through runtime-owned result contracts.

## Verification
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:stability`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:takeover`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact
- Source-only checkpoint. Installer was not built for this version.
- SHA-256: N/A for source-only checkpoint.
