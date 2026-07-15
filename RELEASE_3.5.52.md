# Aegos 3.5.52

Source-only core-runtime consolidation checkpoint. No installer was built for this small internal step.

## Changed

- Moved disconnect-protection firewall group names, state-file names, rule-prefix contracts, speed-test temporary firewall enablement, and remote-port list formatting into `core_runtime`.
- Kept Windows PowerShell script execution in `main.rs` so the existing disconnect-protection and speed-test behavior is unchanged.
- Extended core-runtime, security, and takeover audits so firewall policy cannot drift back into scattered UI/backend call sites.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
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

- Source-only checkpoint.
- SHA-256: Source-only, no installer artifact for this internal runtime-boundary step.
