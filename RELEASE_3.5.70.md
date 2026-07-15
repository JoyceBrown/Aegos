# Aegos 3.5.70

## Core runtime digestion
- Removed the remaining local `ps_escape` helper from `main.rs`.
- Routed firewall scripts and administrator relaunch script through `core_runtime::powershell_single_quote_escape`.
- Updated audits to forbid reintroducing local PowerShell single-quote escaping in `main.rs`.

## Why this matters
- PowerShell string escaping now has one runtime-owned implementation instead of one shared helper plus a local duplicate.
- This keeps firewall, system proxy, and relaunch script inputs aligned as the runtime boundary keeps tightening.

## Remaining work
- PowerShell execution still belongs to `main.rs`.
- Future checkpoints should shape script execution outcomes and rollback diagnostics through runtime-owned result contracts.

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
