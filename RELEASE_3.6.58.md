# Aegos 3.6.58

## Scope

- Close the remaining control-plane no-growth budget failure without raising
  budgets or weakening release gates.
- Give DNS product-state assembly and node-selection transactions focused
  module owners.
- Preserve the verified 3.6.57 DNS routing, fixed-node protection,
  configuration-extension, interaction, and UI behavior.

## Changes

- Added `dns_policy.rs` as the single owner for normalized DNS policy snapshots
  and the asynchronous Tauri snapshot command.
- Added `node_selection.rs` as the single owner for node-switch preflight,
  runtime apply, preference persistence, DNS route reload, and ordered rollback.
- Removed the superseded DNS snapshot and node-switch implementations from
  `main.rs`; there is no parallel execution path.
- Kept the `changeProxy` result contract stable, including the connection
  closure and effective `dnsPolicy` snapshot.
- Updated backend, core-runtime, release, and control-plane audits to verify the
  new module ownership while retaining the measurement-only speed-test and
  rollback assertions.
- Retained automatic direct encrypted DNS for ordinary nodes, same-egress
  remote encrypted DNS for fixed nodes, and forced DNS interception for fixed
  nodes under TUN.
- Retained the scrollable Configuration Extensions workspace and the persistent
  title-side status, Clear, and Validate and Save actions.

## Verification

- 197 Rust unit tests passed.
- DNS-focused tests passed all 8 runtime policy, route, interception, and safety
  cases.
- Node-selection module tests passed; existing preflight and source-order
  guards continue to cover apply, persistence, and rollback ordering.
- `npm run audit:control-plane` passed with
  `main=11718/11770 production lines` and
  `core_runtime=2893/2900 production lines`.
- `npm run smoke:interactions` passed all 10 user journeys with zero speed-test
  proxy switches, standby connections, or standby proxy switches.
- `npm run smoke:ui` passed all 14 viewport/DPI combinations without horizontal
  overflow, text overflow, missing labels, or bad panels.
- Backend, responsiveness, security, configuration-extension, IPv6/DNS, and
  architecture audits passed.
- Installer and final release audits passed against the recorded 3.6.58
  version, size, and SHA-256.
- `git diff --check` passed.
- FlClash was not stopped, restarted, modified, or taken over.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.58_x64-setup.exe`
- Size: `16252235` bytes
- SHA-256:
  `a5f918841a3a131daef86143d27a0188ea95de3f86a289dcd8aab15079985b30`
- Signature: unsigned open-source build

## Known Limits

- Real airport connectivity is not simulated by deterministic fixtures;
  existing user validation remains the real-network acceptance source.
- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Automatic updates, signed rollback, backup synchronization, Windows ARM64,
  and other platforms remain outside this release.
- Real-device long-duration stability is not a release blocker on the current
  resource-constrained host; deterministic interaction, UI, performance, soak,
  and release gates remain mandatory.
