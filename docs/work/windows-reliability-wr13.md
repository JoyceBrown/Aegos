# WR-13 R5 Route Snapshot Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-13
change_id: CHANGE-044
evidence_state: closed
source_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
version: 3.6.70
completed_at: 2026-07-28T06:38:37Z

## Scope And Finding

The user explicitly continued R5 for the Rules-page heavy snapshot path. Work
was limited to matching-cache use, segmented read-only preparation, and stale
render cancellation when navigation moves to Connections. No rule semantics,
YAML, CoreManager lock, write command, timeout, network, delivery, FlClash, or
host setting changed.

The defect boundary was a returned 80,000-rule snapshot whose historical
request/render path could continue after Rules had yielded to Connections. The
old control committed a `80000` Rules summary marker into hidden Rules DOM and
emitted no `routing-render-cancelled` trace.

## Repair

`renderRoutingSnapshot` now performs segmented preparation before calling
`ensureRoutingAssistantUi`. After preparation it verifies the existing page
token and render generation before Rules DOM work. `refreshRoutingSnapshot`
retains its matching-profile request guard. The isolated legacy branch exists
only for the deterministic negative fixture and is disabled in normal product
execution.

No snapshot service was extracted because the current matching cache, 400-rule
segmentation, and cancellation path met the existing budgets.

## Controls

| Command | UTC completion | Exit | Result |
| --- | --- | --- | --- |
| `node tools/perf-smoke.js --stress --r5-known-bad` | 2026-07-28T06:27:02Z | expected non-zero | Rejected historical path: `staleSnapshotCommitted: true`, `cancelled: false`, Connections active. |
| `node tools/perf-smoke.js --stress --r5-repaired` | 2026-07-28T06:27:28Z | 0 | `inputDeliveryMs: 4.8`, `firstFrameMs: 11.8`, `cancelled: true`, `staleSnapshotCommitted: false`, Connections active. |

Final source-close rerun interval: `2026-07-28T06:37:59.1834687Z` through
`2026-07-28T06:38:37.6691126Z`. It repeated the known-bad control (expected
exit `2`), repaired control (exit `0`), routing navigation audit (exit `0`),
planning-context audit (exit `0`), and `git diff --check` (exit `0`). The final
repaired observation was `inputDeliveryMs: 5.0`, `firstFrameMs: 16.4`,
`cancelled: true`, and `staleSnapshotCommitted: false`.

The standard pressure gate now rejects a stale Rules DOM commit, not only a
missing cancellation trace. The route navigation audit verifies that Rules DOM
initialization follows segmented preparation.

## Affected Regression Evidence

| Command | UTC completion | Exit | Coverage |
| --- | --- | --- | --- |
| `npm run smoke:interactions` | 2026-07-28T06:30:05Z | 0 | 13 product journeys, including routing and pending-work navigation. |
| `npm run smoke:ui` | 2026-07-28T06:29:12Z | 0 | Existing 14 fixed window/DPI configurations. |
| `npm run smoke:perf:stress` | 2026-07-28T06:29:12Z | 0 | 800 nodes, 420 navigations, stale-route assertion. |
| `npm run smoke:soak` | 2026-07-28T06:31:00Z | 0 | 16 cycles, stable timers/DOM, no residual test roots. |
| `npm run smoke:perf:native` | 2026-07-28T06:31:51Z | 0 | Isolated WebView2, automatic speed enabled. |
| `node tools/native-perf-smoke.js --automatic-speed=suppressed` | 2026-07-28T06:33:15Z | 0 | Isolated WebView2, automatic speed suppressed. |
| `npm run audit:routing-navigation`, `npm run audit:routing-acceptance`, `npm run audit:responsiveness`, `npm run audit:security`, `npm run audit:control-plane`, `npm run audit:architecture`, `npm run audit:planning-context` | 2026-07-28T06:28:53Z to 2026-07-28T06:32:43Z | 0 | Routing, responsiveness, safety, architecture, and plan authority. |

## Known Non-R5 Gate Conflict

`npm run audit:routing-readonly` exited non-zero at 2026-07-28T06:32:41Z. Its
legacy static copy assertion requires Rules to state that it is read-only and
does not modify configuration. The current product permits controlled user-rule
drafts and the current routing acceptance gate passes. This mismatch predates
WR-13 and is outside its excluded rule-semantics/copy scope. It is recorded,
not hidden or "fixed" by misrepresenting the UI; it is not an R5 snapshot
regression.

## Environment And Delivery Boundary

All browser and native probes used isolated test profiles/data roots. The
working tree was already dirty and remains user-owned; the source baseline was
`941d1f6fc591a0c89709948a42e4e6a6cbcf5564`. No installer was built or
installed, no commit/push/release was made, and no FlClash, proxy, TUN, DNS,
firewall, kill-switch, or host network state was changed.
