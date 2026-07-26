# Aegos 3.6.59

## Scope

- Close a directly evidenced permanent-pending failure path in the shared
  background-task runtime.
- Preserve all verified 3.6.58 network, DNS, node-selection, configuration,
  interaction, and UI behavior.
- Re-run the responsiveness, stability, pressure, soak, control-plane, and
  release gates without weakening their assertions or budgets.

## Changes

- Added one guarded background-worker boundary in `task_runtime.rs`.
- A Rust panic inside a background worker now transitions its job record from
  `running` to `failed` with a retryable public message.
- Buttons, setting controls, pending rows, and foreground scheduling can
  therefore leave their busy state through the existing job polling and
  `finally` paths instead of polling a dead worker forever.
- Added a Rust regression that deliberately panics a fixture worker and proves
  the task reaches a failed terminal state.
- Added a stability audit assertion that keeps the guarded worker boundary and
  regression coverage release-blocking.
- No normal job, network mutation, cancellation, or UI contract was changed.

## Verification

- 198 Rust unit tests passed.
- `npm run audit:stability` passed, including the panicked-worker terminal-state
  guard.
- `npm run audit:control-plane` passed with
  `main=11735/11770 production lines` and
  `core_runtime=2893/2900 production lines`.
- `npm run smoke:interactions` passed all 10 user journeys with zero speed-test
  proxy switches, standby connections, or standby proxy switches.
- `npm run smoke:ui` passed all 14 viewport/DPI combinations.
- `npm run smoke:perf:stress` passed 420 rapid navigation changes and the
  existing large-list/background-work pressure scenarios.
- `npm run smoke:soak` passed 20 concurrent user-journey cycles with
  `stuckTesting=false`, stable listener counts, and settled resource evidence.
- Backend, responsiveness, security, configuration-extension, IPv6/DNS,
  control-plane, architecture, installer, and final release audits passed.
- `git diff --check` passed.
- FlClash remained running as PID 5024 and was not stopped, restarted,
  modified, or taken over.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.59_x64-setup.exe`
- Size: `16259795` bytes
- SHA-256:
  `49d6e6012bcabc02b9a651d77b8d1ee72c14b59adb36f2aaf1bd31d6ff42002d`
- Signature: unsigned open-source build

## Known Limits

- Catching a worker panic prevents a dead worker from leaving permanent UI
  pending state; it cannot forcibly terminate an operating-system call that
  never returns. Existing command-specific network and process timeouts remain
  the boundary for stalled external operations.
- Real airport connectivity is not simulated by deterministic fixtures;
  existing user validation remains the real-network acceptance source.
- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Automatic updates, signed rollback, backup synchronization, Windows ARM64,
  and other platforms remain outside this release.
