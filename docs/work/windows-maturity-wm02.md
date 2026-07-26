# WM-02 Connection And Takeover Terminal Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-MATURITY
task_id: WM-02
status: completed
updated_at: 2026-07-26

This register records only WM-02 evidence. It does not authorize another
task; the active plan remains `../../PLANS.md`.

## Test Boundary

The interaction case freezes only its mocked Tauri background job. It does not
start a process, write a Windows setting, or make a network request. The real
managed-core case uses an isolated Aegos data root, sanitized fixture, and the
approved Mihomo resource with system proxy, startup proxy, TUN, and kill-switch
all disabled. It does not operate on FlClash.

## Terminal-State Matrix

| Journey | Expected visible state | Verified evidence | Limit |
| --- | --- | --- | --- |
| Start while background work is pending | The action says connecting; existing stopped state remains visible until runtime and takeover facts are refreshed. | Interaction smoke holds `startCore` before terminal completion. | Mocked Tauri transport, not live Windows takeover. |
| Start failure and retry | A failed start settles to disconnected with the Connect action restored; a later retry may settle normally. | Interaction smoke injects a failed `startCore`; real isolated Mihomo test retries after a missing-core terminal error. | Real retry remains standby only. |
| Stop while background work is pending | The action says disconnecting; existing connected state remains visible until the stop is terminal. | Interaction smoke holds `stopCore` before terminal completion. | Mocked Tauri transport, not live Windows proxy restore. |
| Standby restart | Restart owns a new managed child, reaches controller readiness, and remains without traffic takeover. | Real isolated Mihomo journey. | No external connectivity claim. |
| System-proxy takeover fails after core readiness | Core is visibly standby, the Connect retry action remains available, and the notice explains the next remediation step. | `startCore` returns a sanitized standby message; interaction smoke injects this terminal result. | The UI transport is mocked; the Windows registry is not changed. |
| System-proxy restore fails | The error names failed automatic restore and keeps a `recovery-required` journal for startup recovery. | Isolated `system_proxy_restore_failure_stays_recoverable_in_an_isolated_journal` injects the failure; journal completion/rollback tests cover both terminal outcomes. | File transaction evidence only; no host proxy mutation. |
| Core-power cancellation | Core-power jobs do not expose cancellation because terminating a transition has no safe general rollback boundary. They have bounded readiness and terminal worker settlement instead. | `CoreController::wait_until_ready` is bounded to six seconds; task worker panic settlement is unit-tested. | A live cancellation must not be claimed until an explicit recoverable design exists. |

## Defect Register

| ID | Priority | Reproduction | Expected terminal state | Observed state | Resolution and regression target |
| --- | --- | --- | --- | --- | --- |
| WM02-001 | P1, resolved | Hold a `startCore` or `stopCore` background job before its terminal result. | Pending UI names the operation but does not claim connected or disconnected until observed runtime state confirms it. | `corePowerJob` replaced `latestStatus` with a guessed takeover state, allowing the ring and notice to claim connection or disconnection early. | Remove the guessed state write. Interaction smoke holds start and stop, injects start failure, then verifies retry and terminal rendering. |
| WM02-002 | P1, resolved | Return a successful core start with `trafficTakeover=false` after a failed proxy takeover. | The core remains visibly standby with a remediation message and a Connect retry; it is neither reported connected nor disconnected. | The foreground handler overwrote the terminal safe-standby state with "disconnected" and could start an outbound-IP request without traffic takeover. | Return a sanitized standby result from the backend, preserve it in the UI, and suppress the IP query. Interaction smoke covers the state; runtime JSON and isolated journal tests cover the terminal contract and recovery evidence. |

## Closure Evidence

- `cargo test --manifest-path src-tauri/Cargo.toml` passed: 219 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml system_proxy_restore_failure_stays_recoverable_in_an_isolated_journal` passed with a temporary data root and no Windows network mutation.
- `cargo test --manifest-path src-tauri/Cargo.toml wm01_isolated_managed_core_journey_uses_real_mihomo_without_windows_takeover -- --nocapture` passed.
- `npm run smoke:interactions`, `npm run audit:backend`, `npm run audit:responsiveness`, `npm run audit:stability`, `npm run audit:security`, and `npm run audit:control-plane` passed on 2026-07-26.
- The control-plane audit passed with main=11586/11770 and core_runtime=2896/2900 production lines. No budget or assertion was changed.

## Current Limits

- System-proxy, live TUN, firewall, DNS, and external-connectivity operations
  are intentionally untested on this host because FlClash is a network
  dependency.
- The real managed-core journey proves lifecycle and controller facts, not that
  a Windows traffic takeover succeeded.
- The next WM-02 evidence must target the safe recovery-journal and proxy
  restore paths before any controlled live-takeover environment is considered.
