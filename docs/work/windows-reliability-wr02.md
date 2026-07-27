# WR-02 Responsiveness Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-02
evidence_state: closed
updated_at: 2026-07-27

## Boundary

Use sanitized fixtures, existing browser/native harnesses, and isolated Aegos
data roots. Speed tests remain measurement-only. Do not change the host system
proxy, TUN, DNS, firewall, routing, FlClash, or the user's installed Aegos
process.

## Findings

| ID | Severity | State | Trigger | Expected | Observed | Owner candidates |
| --- | --- | --- | --- | --- | --- | --- |
| WR02-001 | P1 | repaired | Run an all-node speed test more than once and watch visible node delays. | The new run immediately shows testing state and progressively paints new values as results arrive. | The old path limited foreground draining to eight results per frame, stopped draining above 160 queued results, and could discard visible updates. A completed first run could still own the UI long enough for the next click to be ignored. | Frontend speed event coalescing, visible-update scheduling, and terminal reconciliation. |
| WR02-002 | P1 | repaired | Open the application and enter Nodes or Connections during the first few seconds, including leave-and-return while the first connection request is pending. | Navigation paints promptly and shows immediate cached content or an honest loading state without visible stalls. | Node/connection layout was not warmed in the actionable startup window. A connection result could be rejected by an obsolete page token while a return visit was ignored because the first request still had `loading=true`. | Startup page prewarm, initial node targeting, page-load scheduling, and queued connection refresh. |
| WR02-003 | P1 | repaired | Click manual all-node speed test when the first real probe result is delayed. | The click paints a clearly labelled numeric elapsed indicator immediately and that value keeps advancing until real latency or failure replaces it. | 3.6.66 painted only a static `测速中` label before the first result. 3.6.67 paints elapsed waiting time on the first frame and advances it every 80 ms without calling it latency. | Frontend pre-result progress clock and bounded visible-node updates. |
| WR02-004 | P1 | repaired | During cold startup, open Connections and immediately select another page while connection/startup work is completing. | The destination page paints within 50 ms and obsolete connection rendering stops without mutating the hidden page. | The prior gate missed result construction competing with navigation. 3.6.67 cancels queued prewarm and builds connection rows in cancellable 24-row chunks. | Cancellable connection row preparation, page-token ownership, and startup prewarm scheduling. |

## Reproduction And Repair Evidence

- CHANGE-029 delayed the second run's first real result beyond `260 ms`.
  Numeric feedback painted in `4.4 ms`, advanced through `0.0s`, `0.1s`, and
  `0.2s`, and the real value painted `24.9 ms` after its event.
- A 1200-row Connections response was interrupted after 24 rows. Home painted
  in `6.0 ms`; the obsolete renderer recorded cancellation and appended no
  further rows after navigation.

- Known-bad browser run: both startup prewarm traces were absent; after the
  first speed run completed, a click 120 ms later retained run ID `1`, showed
  testing in `0.4 ms`, and painted no progressive result before terminal.
- Repaired browser run: run IDs advanced from `1` to `2`, testing appeared in
  about `2.1 ms`, the first real repeated-run value painted in about `34.1 ms`,
  node/connection prewarm completed in about `302/339 ms`, and the
  pending-request connection re-entry issued its required replacement load.
- The 480-node pressure fixture retained 420 rapid navigations with no missing
  result events or full-state speed polling. The deterministic connection
  leave/return case completed within its `400 ms` content budget.
- Native WebView2, automatic speed enabled: immediately after the first
  physically actionable shell frame, the final focused sample painted Nodes
  in `14.5 ms` and Connections in `33.4 ms`; synchronous work stayed below
  `1 ms` and neither activation window contained a task over `50 ms`.
- Native WebView2, automatic speed suppressed: the final focused sample painted
  Nodes in `1.1 ms` and Connections in `22.2 ms` under the same limits.
  Both native modes used an isolated data root and a visible-compositor window
  fixed offscreen, unfocused, and absent from the taskbar.
- CHANGE-030 synchronization validation retained a failing enabled-mode sample:
  a single frame immediately after `show()` acknowledged before the first
  physically actionable presented frame, and the next Nodes input measured
  `56.3 ms` with `0.7 ms` synchronous work and no activation-window long task.
  The probe now requires three compositor frames before it models physical
  input. It does not remove a page, window/DPI configuration, background
  startup overlap, or the `50 ms` navigation limit; its focused repaired sample
  measured Nodes at `26.8 ms` and Connections at `33.7 ms`.
- Speed remains measurement-only. Product code did not add a connection,
  selection, system-proxy, TUN, DNS, firewall, routing, or FlClash action.

The complete 25-command source-bound host-safe matrix passed with 224 Rust
tests, 12 product journeys, 14 fixed window/DPI configurations, 800 nodes,
420 rapid navigations, 16 soak cycles, and both native WebView2 automatic-speed
modes. The final replacement is built from a fresh target and copied unchanged
to the canonical delivery path after source-bound acceptance. Both findings
are closed as one unit.

## Required Regressions

- A repeated-run speed fixture that produces two visible results inside the
  throttle window and fails if either result waits for terminal completion.
- A cold-start navigation fixture for Nodes and Connections that measures
  synchronous entry work, first frame, content/loading progress, and long
  tasks while startup work overlaps.
- Existing large-list, rapid-navigation, background-job, automatic-speed,
  measurement-only, and host-side-effect assertions remain unchanged.

## Completion Boundary

All four findings must be repaired and pass focused plus full host-safe acceptance
as one unit. A repair that merely changes text, increases a timeout, removes a
matrix case, or waits for terminal refresh is incomplete.
