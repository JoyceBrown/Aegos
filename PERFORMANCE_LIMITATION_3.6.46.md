# Aegos 3.6.46 Performance Limitation

## Current Gate

`npm run smoke:perf:repeat` is reproducibly failing only the streamed speed
event frame-pacing check. The latest three-run evidence reports:

- speed stream P95 frame interval: `66.6ms` in all three runs;
- maximum interval: `116.6ms`, `133.3ms`, and `116.6ms`;
- speed results: `8,000`, emitted events: `8,002`, bursts: `20`;
- navigation, filters, visual navigation, long-task, DOM, and startup budgets:
  passed.

The current release does not weaken the `p95 <= 50.1ms` or `max <= 100ms`
thresholds, and no failing report is treated as passing evidence.

## Host Evidence

- GPU: Intel(R) HD Graphics 4600.
- Default display mode: `3840x2160@29Hz`.
- The adapter enumerates `3840x2160` at `25/29/30Hz`; it does not expose a
  native `3840x2160@60Hz` mode through `EnumDisplaySettings`.
- A reversible `1920x1080@60Hz` comparison was run and restored successfully;
  the headless software compositor still produced the same speed-stream
  failure. A headed comparison also failed its frame-pacing gate.

## Mitigations Already In Release

- Speed results use a dynamic overlay and constant-time node indexing.
- Rendering is limited to a 48-result batch with a `0.75ms` frame budget.
- Progress text is throttled to `120ms`; visible-row updates are throttled to
  `300ms` and final reconciliation remains immediate.
- Terminal reconciliation performs a final authoritative visible refresh.

## Reopening Criteria

Re-run the full pressure, repeat, headed, and soak lanes after a display
driver/compositor change or a targeted rendering redesign. Do not change the
performance thresholds, disable the speed stream, or use a single passing run
as release evidence.
