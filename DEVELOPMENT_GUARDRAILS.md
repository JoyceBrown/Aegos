# Aegos Development Guardrails

## Responsiveness Contract

- UI selection, navigation, toggles, and page changes must update local state first.
- Slow work must use the shared background job path: `start_job` plus `job_status`.
- Click handlers must not directly await network download, core start, core restart, recovery, subscription update, or external PowerShell work.
- Non-forced refresh loops must yield while foreground actions or background jobs are active.
- Backend code must avoid holding `CoreManager` while waiting on remote HTTP, proxy probes, or other long external work.
- Any new slow operation must add or extend smoke/audit coverage before it is treated as complete.

## Current Slow-Operation Families

- Core power: start, stop, restart.
- Subscription: import, update, active-profile application.
- Network: speed test, smart recovery, outbound IP refresh.
- System: system proxy, TUN, Kill Switch, admin relaunch.

## Acceptance Gate

- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release` before packaging
