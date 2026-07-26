# WM-04 Native Responsiveness Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-MATURITY
task_id: WM-04
evidence_state: closed
updated_at: 2026-07-26

This register records WM-04 evidence only. It does not authorize another
task; the active plan remains `../../PLANS.md`.

## Test Boundary

`tools/native-perf-smoke.js` launches a hidden WebView2 window with the
`native-measurement` build feature and `AEGOS_NATIVE_PERF_DATA_ROOT` set to a
new temporary directory. It generates its own sanitized settings and profile
fixture. The 800-node subscription is generated in memory and imported through
the normal product transaction.

The measurement does not request system proxy, TUN, DNS, firewall,
kill-switch, or FlClash operations. It does not read the user's subscription,
settings, nodes, routing rules, or managed runtime state. The visible headed
native smoke remains excluded from the shared desktop.

## Native Measurement Result

Matched hidden-native 800-node comparisons passed on 2026-07-26:
`PERFORMANCE_NATIVE_3.6.62.auto-speed-suppressed.json` and
`PERFORMANCE_NATIVE_3.6.62.auto-speed-enabled.json`. Both reports use an
isolated temporary data root and the same generated fixture.

| Case | Observed fact | Interpretation |
| --- | --- | --- |
| Background job state | Pending work remained visible; navigation reached Diagnostics while pending; cancellation, failure, and completion after navigation away all reached visible terminal rows. | The task-center matrix did not reproduce a permanent pending or stale-success state. |
| Large node list | The 800-node profile rendered 43 virtualized rows in 23.7 ms (suppressed) and 22.9 ms (enabled). | Virtualization prevents a full 800-row DOM expansion. |
| Large routing list | The runtime retained 802 rules and the bounded rule query returned 100 of 801 rows in both runs. | The routing model does not need to materialize every rule in the DOM. |
| Automatic measurement | Suppressed mode observed no speed run. Enabled mode observed run 1, started the measurement command in 13 ms, and reached a cancelled terminal state in 50.7 ms. | Automatic measurement is independent, cancellable, and remains measurement-only; it is not the reproduced source of a page freeze. |
| Navigation and diagnostics | Both modes kept synchronous navigation and diagnostic switch work at or below 0.7 ms, with no action-associated diagnostic long task and no rendered log rows. | The 62-76 ms first-frame values are hidden 30 Hz WebView2 composition samples, not main-thread or log-DOM blocking. A new 120 ms hard paint limit and action-associated long-task checks remain blocking. |
| Settings entry | The initial settings workspace construction could produce an intermittent over-120 ms native long task. | Its static structure now warms during idle time before first entry; subsequent native runs had only a 73-76 ms routing long task and no settings hard-budget breach. |

## Defect Register

| ID | Priority | Reproduction | Expected terminal state | Observed state | Required resolution evidence |
| --- | --- | --- | --- | --- | --- |
| WM04-001 | P1, closed | Import the isolated 800-node fixture with automatic speed enabled and suppressed, then navigate to Nodes and Routing and request bounded routing data. | Automatic measurement stays measurement-only, can be cancelled, and cannot make page paint or required routing data wait behind an unbounded background backlog. | Enabled mode observed a run; suppressed mode did not. Both retained 29.6-30.9 ms node first paint, 10.9-12.9 ms routing first paint, bounded rows, and terminal cancellation. | Matched reports prove the causal split. Manual measurement remains available and no traffic-changing behavior was added. |
| WM04-002 | P2, closed | Repeat native navigation and diagnostics switches after WM04-001's causal split. | A real action cannot block the main thread or leave a delayed terminal state hidden behind a compositor sample. | First diagnostics switch sampled 71.8-76.5 ms in the hidden 30 Hz host, but the action returned in at most 0.7 ms, rendered zero log rows, and caused no action-associated long task. The old first settings construction could intermittently exceed 120 ms. | Static settings workspace construction now occurs during idle time. The native gate separately blocks synchronous work, action-associated long tasks, and paint over 120 ms while preserving the raw 50 ms composition warning. |

## Current Limits

- This evidence is isolated WebView2 behavior, not live system-proxy, TUN,
  firewall, DNS, or external connectivity proof.
- The hidden host still samples some first paints above 50 ms. The reports
  retain these warnings, but only independently observed synchronous work,
  action-associated long tasks, or paint above 120 ms block this milestone.
- `node --check`, interaction/UI smoke, native enabled/suppressed comparison,
  stress, soak, responsiveness, security, architecture, and control-plane
  gates passed. WM-04 is closed; WM-05 owns the full maturity matrix.
