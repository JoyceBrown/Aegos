# WM-05 Windows Maturity Acceptance Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-MATURITY
task_id: WM-05
evidence_state: closed
updated_at: 2026-07-26

This register closes the Windows Maturity plan. It does not authorize the
planned post-acceptance outcomes; `PLANS.md` is completed with `on_complete:
wait`.

## Boundary

All runtime journeys use sanitized fixtures, mocked browser contracts, or an
isolated Aegos data root. No test stopped, restarted, modified, or took over
FlClash. No test requested the shared host's system proxy, TUN, DNS, firewall,
kill-switch, or a public release action.

## Matrix

| Evidence | 2026-07-26 result |
| --- | --- |
| Source and isolated runtime | `cargo test --manifest-path src-tauri/Cargo.toml` passed: 222 tests, 0 failed. |
| Primary interaction | `npm run smoke:interactions` passed all twelve declared journeys, including truthful startup, TUN-off/on behavior, measurement-only speed, node/outbound-IP, subscription, routing, diagnostics, background work, backup, and terminal core-power state. |
| Viewport and DPI | `npm run smoke:ui` passed all configured viewport/DPI reports with no overflow, escaping text, unlabeled icons, missing masks, or invalid panel geometry. |
| Large-data responsiveness | `npm run smoke:perf:stress` passed with 800 nodes, 420 navigation changes, p95 navigation at or below 0.3 ms, a completed 800-result speed stream, and no reported failure. Full redacted detail is `PERFORMANCE_PRESSURE_3.6.62.json`. |
| Soak | `npm run smoke:soak` passed 20 cycles and 262 product commands with no stuck testing state or timer/listener growth. Full detail is `PERFORMANCE_SOAK_3.6.62.json`. |
| Product gates | `audit:backend`, `audit:responsiveness`, `audit:stability`, `audit:security`, `audit:ipv6-dns`, and `audit:outbound-ip` all passed. |
| Ownership gates | `audit:control-plane` passed with `main=11678/11770` and `core_runtime=2896/2900`; `audit:architecture` and `audit:planning-context` passed. No budget or assertion was weakened. |
| Delivery gates | `audit:installer` and `audit:release` passed against the local unsigned 3.6.62 NSIS candidate. `git diff --check` passed. |

## Acceptance Tool Repair

The first WM-05 pressure run produced a valid report but did not terminate on
Windows. The test runner retained its spawned Chrome child and initiated CDP
socket shutdown without awaiting it. `tools/perf-smoke.js` now closes CDP before
cleanup, detaches the dedicated cleanup child, and waits up to one second for
the WebSocket close event. It emits a concise terminal summary while retaining
the complete report in the evidence JSON. The final 800-node pressure run
returned exit code 0 with no Aegos perf-smoke Node or Chrome process left.

## Explicit Environment Limits

- This matrix proves isolated managed-core and WebView2 behavior, not a live
  shared-host system-proxy, TUN, DNS interception, firewall, or external
  connectivity takeover. Those require a dedicated recoverable Windows lab.
- The NSIS candidate is intentionally unsigned. This proves local packaging,
  not public distribution trust; signing, publishing, and updates remain
  deferred.

## Conclusion

Every required WM-05 matrix row passed or is stated above as an environment
limitation. No reproduced P0 or P1 defect remains open in the supported,
host-safe Windows matrix. The plan stops for user review.
