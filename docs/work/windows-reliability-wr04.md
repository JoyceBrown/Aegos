# WR-04 Truthful UI Evidence Register

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-04
change_id: CHANGE-033
evidence_state: closed
opened_at: 2026-07-27T11:30:00Z
updated_at: 2026-07-27T12:09:35Z
closed_at: 2026-07-27T12:09:35Z
base_git_head: 7720fac057ec290b7ddbbb5e5fd3849f71449f1a
host_boundary: Browser fixtures and isolated data only. No Windows takeover,
  proxy, DNS, firewall, TUN, FlClash, installer, or publication action.

This register authorizes no work by itself. It records the user-approved UI
repair and its required known-bad controls.

## Finding Register

| ID | Severity | Finding | Known-bad control | Repair target | State |
| --- | --- | --- | --- | --- | --- |
| WR04-001 | P1 | Disconnected Home presented recent node data, runtime protocol/port, and outlet identity as one unqualified sidebar state. | Core stopped with retained measurement/outlet data must not present any retained value as current effective network fact. | Separate current runtime, recent measurement, and historical observation. | repaired |
| WR04-002 | P1 | Connections used its ordinary empty state when takeover existed but connectivity was unavailable or unverified. | `trafficTakeover: true`, `networkUsable: false` must expose the unavailable/pending condition and diagnostics route while keeping real rows operable. | State-aware connection guidance. | repaired |
| WR04-003 | P1 | Persistently visible traffic and active-connection values could become stale after navigating away from Home. | Changing mock traffic and connection count on Diagnostics must update the sidebar or explicitly label a frozen observation. | Page-independent runtime summary rendering. | repaired |
| WR04-004 | P2 | Kill-switch looked like a generic quick command, without explicit visible state. | Enabled and disabled fixtures must expose an accessible binary state and retain permission/terminal result behavior. | Stateful binary protection control. | repaired |
| WR04-005 | P2 | Enabled node-row actions looked disabled at rest; current page and truncated profile detail lacked full accessibility semantics. | Default row actions remain visibly operable; each page has one `aria-current`; long profile data has an accessible full-value path. | Discoverable actions and navigation/detail semantics. | repaired |
| WR04-006 | P2 | UI smoke used a public-address-shaped outlet value in screenshots. | Public-address-shaped fixture data and rendered/exported output are rejected unless documented as redacted test data. | TEST-NET fixtures and redaction regression. | repaired |

## Required Closure Evidence

- Preserve the initial failing fixture or a deterministic assertion that rejects
  the old presentation before recording a repaired path.
- Run focused interaction/UI controls first, then fixed-window/DPI UI smoke,
  stress, soak, responsiveness, stability, security, architecture,
  control-plane, and planning-context gates. Do not reduce the existing matrix
  or relax its limits.
- Record command, UTC interval, version, base Git head, dirty worktree summary,
  fixture matrix, and host boundary. A nonzero command, residual test process,
  or host-network side effect leaves this register open.

## Initial Failures Retained

- `npm run smoke:perf:stress` initially exited 2 at
  `2026-07-27T12:01:07Z`: unexpected layout shift was `0.0215`, above the
  unchanged `0.02` budget. Its sources were the empty-to-populated Home region
  strip plus the first runtime-status paint. Reserving the 42px region strip
  removed the structural shift; the final pressure run is recorded below.
- The first attempt to reserve all Home status rows made the quick-action row
  differ from the TUN control by 9px across the fixed window matrix. `npm run
  smoke:ui` correctly exited 2. That over-constraining CSS was removed rather
  than accepting the misalignment; the final matrix reports a maximum offset
  of about 0.7px.
- `npm run audit:status-vocabulary` initially exited 2 because it asserted the
  obsolete shortcut that takeover alone displayed `connected`. The audit now
  requires `effectiveConnectionInfo`, rejects that shortcut, and requires the
  interaction known-bad controls for unverified and verified takeover.

## Closure Evidence

- Version identity at close: `package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`, and `src/index.html` all report `3.6.67`.
  Baseline `HEAD` remained `7720fac057ec290b7ddbbb5e5fd3849f71449f1a`.
- The interaction fixture verifies all six controls: unverified takeover is
  not connected; unavailable takeover offers diagnostics; traffic and active
  connections refresh away from Home; kill switch exposes an accessible
  binary state; one navigation item has `aria-current` and profile summaries
  have focusable full values; default node actions retain opacity at least
  `0.7`; the UI fixture uses TEST-NET `203.0.113.8` and rejects the prior
  public-address-shaped value.
- Exit-0 commands: `npm run smoke:interactions`, `npm run smoke:ui`,
  `npm run smoke:perf:stress`, `npm run smoke:soak`,
  `npm run audit:responsiveness`, `npm run audit:stability`,
  `npm run audit:security`, `npm run audit:status-vocabulary`,
  `npm run audit:architecture`, `npm run audit:control-plane`, and
  `npm run audit:planning-context`. The fixed matrix retained all 14
  window/DPI configurations; stress retained 800 nodes and 420 navigations;
  soak retained 16 cycles.
- Final stress evidence at `2026-07-27T12:06:28Z`: unexpected layout shift
  `0.01036` under the unchanged `0.02` limit, repeated-speed feedback
  `4.9ms`, 800 results, and cancelled Connections rendering with no stale
  rows. Soak at `2026-07-27T12:08:24Z` completed 16 cycles with no failures.
- `git diff --check` exited 0. No exact test-owned temporary root remained
  after interaction, UI, performance, or soak runs. Relevant dirty worktree
  inputs include the existing WR-03 Rust/status work, its evidence, this
  WR-04 UI/audit/evidence work, and regenerated local smoke evidence; none
  was reverted.
- Host boundary held: browser fixtures and isolated data only. No Windows
  takeover, proxy, DNS, firewall, TUN, FlClash, installer, release, GitHub,
  signing, or host-network action occurred.

No P1 remains open for CHANGE-033. The plan is closed and authorizes no
follow-on work without a new user instruction.
