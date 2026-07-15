# Aegos 3.5.68

## Core runtime digestion
- Moved firewall program path shaping into `core_runtime`.
- Moved PowerShell single-quote escaping and string-array literal planning into `core_runtime`.
- Kept actual PowerShell execution in `main.rs`, so this checkpoint only changes the policy/input boundary and does not expand OS-side behavior.
- Updated runtime and release audits to forbid reintroducing local firewall path/array helper logic in `main.rs`.

## Why this matters
- Disconnect protection and speed-test firewall scripts now receive program allow-list inputs from one runtime-owned path.
- This reduces duplicated script-input logic and makes future firewall rule planning easier to audit before execution.

## Remaining work
- Registry writes and PowerShell execution are still manager-side execution details.
- Deeper firewall transaction result shaping and rollback reporting still need to move into runtime-owned contracts later.

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
