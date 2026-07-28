# WR-08 Frontend Responsiveness Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-08
change_id: CHANGE-039
evidence_state: closed
version: 3.6.70
git_head: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
validation_window_utc: 2026-07-27T20:05:01Z..2026-07-27T20:10:56Z
host_boundary: isolated browser fixtures and isolated native WebView2 data roots only; no user Aegos, FlClash, system proxy, TUN, DNS, firewall, or host-network change

## Scope

CHANGE-039 permitted only the frontend repair of startup page prewarm layout
pressure and hidden pending-row speed feedback writes. It excluded Rust
concurrency changes, task timeout changes, installation, publication, Git
actions, live takeover, FlClash, and host-network operations.

## Preserved Bad Controls

`npm run smoke:perf:stress` was run after adding runtime-only probes and before
the product repair. It exited nonzero at `2026-07-27T20:05:01.724Z` with exactly
these intended failures:

- `startup prewarm forced layout reads: 3`
- `speed feedback repainted a hidden pending row: "等待 0.1s"`

The first probe intercepts `offsetHeight` only on the two prewarm panels and
their connection-row container. The second inserts a test-owned pending speed
cell in an inactive Profile page and verifies that periodic foreground feedback
does not mutate it. Both are behavioral probes; neither changes product data
or network state.

## Repair And Result

- `src/app.js` keeps node prewarm frame scheduling but removes its synchronous
  `offsetHeight` reads.
- Periodic speed feedback now selects pending cells only within `.page.active`.
  Immediate feedback, result rendering, and terminal cleanup remain unchanged.

The same `npm run smoke:perf:stress` fixture then exited `0` at
`2026-07-27T20:05:58.405Z`: `prewarmLayoutReads=0`, the hidden probe remained
`hidden-speed-probe`, first repeated-run feedback arrived in `2.6 ms`, elapsed
values included `0.0/0.1/0.2 s` before a deliberately delayed first result at
`269.6 ms`, and the first real result painted after `30.3 ms`.

The accepted stress run retained 800 nodes, 420 navigations, the existing
connection leave/return and routing cancellation controls, and unchanged
performance limits. Its first-frame navigation maximum was `50 ms`; the
targeted Rules-to-Connections control delivered input in `5.4 ms` and its
first frame in `20.4 ms`.

## Validation

All commands below exited `0` after the product repair. The unchanged working
tree also contains pre-existing user and prior-task changes; no unrelated file
was reverted.

| Command | Result |
| --- | --- |
| `node --check src/app.js` | passed |
| `node --check tools/perf-smoke.js` | passed |
| `npm run smoke:perf:stress` | passed; artifact `PERFORMANCE_PRESSURE_3.6.70.json` |
| `npm run smoke:interactions` | passed; artifact `PRODUCT_SMOKE_3.6.70.json` |
| `npm run smoke:ui` | passed; all existing 14 fixed window/DPI configurations |
| `npm run smoke:soak` | passed; 16 cycles, no stuck testing state |
| `npm run smoke:perf:native -- --automatic-speed=enabled` | passed; isolated native artifact `PERFORMANCE_NATIVE_3.6.70.auto-speed-enabled.json` |
| `npm run smoke:perf:native -- --automatic-speed=suppressed` | passed; isolated native artifact `PERFORMANCE_NATIVE_3.6.70.auto-speed-suppressed.json` |
| `npm run audit:responsiveness` | passed |
| `npm run audit:security` | passed |
| `npm run audit:control-plane` | passed; production budgets remain `main=11594/11770`, `core_runtime=2866/2900` |
| `npm run audit:architecture` | passed |
| `npm run audit:planning-context` | passed after its authority contract was extended for CHANGE-039 |
| `git diff --check` | passed; only CRLF advisory messages for pre-existing dirty files |

No installer, release, Git operation, or external side effect is part of this
evidence register.
