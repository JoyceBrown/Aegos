# Aegos 3.3.0

Medium checkpoint for the routing assistant gate.

## Changes
- Added a read-only `routing_assistant_gate` command that opens the 3.3 routing
  assistant lane without enabling config writes.
- Defined the 3.3.1-3.3.9 wizard path: website routing, app routing,
  connection-to-rule draft, region/strategy targets, conflict prompts, undo,
  effectiveness verification, simple/advanced separation, and acceptance.
- Kept routing edits disabled: no rule mutation command, no config write, no
  hot reload, no node switching, and no speed-test behavior changes.
- Kept 3.2 routing foundation audits active across the 3.x line.
- Added `audit:routing-assistant-gate` and unit coverage for the read-only gate.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.3.0.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_assistant_gate_defers_writes_until_wizard_steps_are_built`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:routing-profile-switch`
- `npm run audit:routing-reload-preflight`
- `npm run audit:routing-rollback`
- `npm run audit:routing-diagnostics`
- `npm run audit:routing-foundation`
- `npm run audit:routing-assistant-gate`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:installer`
- `npm run build`
- `git diff --check`

## Artifact
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.3.0_x64-setup.exe`
- SHA-256: 587BA6A434D077E513C4ADE088D53A8772588F768474D63C4FDE398E1A4A7F46
- Size: 15,446,058 bytes
