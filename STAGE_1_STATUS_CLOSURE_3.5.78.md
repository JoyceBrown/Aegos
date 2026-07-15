# Stage 1 Status Closure 3.5.78

## Completed Scope

- 3.5.71: Unified user-facing status vocabulary.
- 3.5.72: Separated software readiness from network availability.
- 3.5.73: Surfaced network availability on the home page.
- 3.5.74: Centralized status exception notices through `statusSurfaceNotice()`.
- 3.5.75: Documented the status snapshot contract and added stale-network coverage.
- 3.5.76: Audited navigation responsiveness and cached settings-page environment checks.
- 3.5.77: Tightened connection button pending feedback and reconciliation.
- 3.5.78: Added backend status matrix coverage for stopped, standby, connected, stale, unavailable, and pending system-proxy states.

## Current Contract

- Backend owns runtime truth through `app_status`.
- Frontend translates snapshots into short labels and explanations.
- `renderStatus()` must remain a pure paint function.
- Navigation must update the active page immediately and defer heavy work.
- Connection button pending text is UI-only and must reconcile after the backend job finishes.

## Gates

- `audit:status-vocabulary` guards copy, status helpers, snapshot contract, and status matrix coverage.
- `audit:responsiveness` guards navigation deferral, pure status rendering, settings-page TTL, large-list rendering, and speed-test non-blocking behavior.
- `smoke:interactions` covers the user path for connect, speed test, diagnostics, logs, settings, subscriptions, nodes, and routing.
- `audit:release` keeps the status and responsiveness rules visible in the global release gate.

## Remaining Risk

- These are source-level and smoke-level gates. They do not replace a real installer run on a physical Windows desktop with active proxy traffic.
- The status snapshot now has a stronger contract, but later stages still need real-world verification for Windows proxy edge cases, firewall state, and flaky network recovery.
