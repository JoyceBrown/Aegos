# Aegos 2.1.0 Roadmap

## Goal

Bring Aegos closer to FlClash-style responsiveness under real subscription scale and slow network conditions.

## Completed In Source

- Cached page navigation: page clicks switch mounted layers immediately.
- Quiet-period page refresh: connection and diagnostics data refresh after navigation settles.
- Large node rendering guardrail: node page renders a 60-row window, home region renders 8 rows.
- Filter/search debounce: list DOM updates wait for a 320 ms quiet period.
- Performance baseline: `npm run smoke:perf` uses 600 nodes and checks nav/menu/filter latency.
- Lightweight heartbeat: `app_status` no longer calls `/version`; traffic snapshot timeout is 120 ms.
- Foreground scheduler: background status refresh, node refresh, page refresh, and auto recovery yield while foreground operations are active.
- Background job model: subscription import/update, smart recovery, and outbound IP refresh use `start_job` / `job_status`.
- Lock reduction: subscription downloads and outbound IP network waits happen outside the `CoreManager` mutex.
- Core power operations: start, stop, and restart use background jobs with optimistic UI rollback.
- Profile/settings operations: active profile switching, batch settings, and single setting changes use background jobs.
- High-frequency controller operations: mode switching and proxy switching use background jobs instead of direct click-time controller waits.
- Startup diagnostics: core start failures now include active profile, config path, core path, ports, and recent core logs.
- Diagnostics view: checks active profile config and recent core logs alongside ports, permissions, TUN, and Kill Switch.
- Profile/config preflight: generated runtime configs are validated before core startup and diagnostics report the node/group/rule counts.
- Subscription source preflight: imports and updates reject empty, unsupported, or node-less subscriptions before writing profile files.
- Source-only 2.1.1 checkpoint: small version bump for subscription validation without installer packaging.
- Source-only 2.1.2 checkpoint: global sidebar job center shows active and recent background tasks without blocking navigation.
- Source-only 2.1.3 checkpoint: job center can request cancellation and retry failed/cancelled tasks with original payloads.
- Source-only 2.1.4 checkpoint: URL subscriptions can be refreshed in one background batch job with per-profile preflight.
- Source-only 2.1.5 checkpoint: profile switching validates runtime config before saving the active profile.
- Source-only 2.1.6 checkpoint: profile deletion uses background jobs and active profile removal restarts on direct.
- Source-only 2.1.7 checkpoint: running profile switches roll back to the previous profile if target startup fails.
- Source-only 2.1.8 checkpoint: settings port changes validate before save and roll back if restart fails.
- Source-only 2.1.9 checkpoint: core restart preserves proxy intent and subscription import/update rolls back on startup failure.
- Source-only 2.1.10 checkpoint: global optimistic UI second audit adds non-blocking busy controls and pending subscription rows.
- Source-only 2.1.11 checkpoint: diagnostics page adds severity summary, actionable hints, copyable reports, and notice severity colors.
- Installer 2.2.0 checkpoint: settings and advanced runtime controls are grouped with live summaries and installer packaging resumes.

## Remaining Candidates

- UI job center:
  - show active background tasks in the notice area
  - never disable navigation during long backend tasks
  - allow retry/cancel where safe

## Acceptance Gates

- `npm run smoke:perf`
  - 600-node navigation p95 <= 4 ms
  - filter/search p95 <= 4 ms
  - no backend calls from pure menu/filter operations
- `npm run smoke:interactions`
  - optimistic UI remains immediate
  - low-latency filter only shows delay values below 100 ms
- `npm run audit:backend`
  - status heartbeat remains lightweight
  - speed test remains backgrounded
  - long command inventory remains visible until job model lands
- `npm run audit:release`
  - package/Tauri/Cargo versions match
  - port isolation remains 7891/19091
  - release notes and installer hash match when packaging

## Packaging Rule

Do not build a new installer for small source-only fixes. Small fixes may bump the source version, but installer artifacts wait for the next medium checkpoint.
