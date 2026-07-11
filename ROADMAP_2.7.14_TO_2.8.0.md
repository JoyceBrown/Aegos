# Aegos 2.7.14 to 2.8.0 Roadmap

## Baseline

- Stable baseline: `2.7.14`.
- Main goal: reach a daily-use stability checkpoint, not a visual redesign checkpoint.
- Installer cadence: source-only for `2.7.x` unless runtime testing requires an installer; build installer at `2.8.0`.

## Non-Negotiable Rules

- Speed tests measure only; they must never connect, restart into traffic takeover, or switch nodes.
- Navigation, page switching, filters, diagnostics, speed tests, and subscription jobs must remain non-blocking.
- User-visible state can update optimistically, but failed backend work must roll back or show a clear actionable error.
- Aegos keeps the default mixed port at `7891` to avoid FlClash/Codex `7890` conflicts.
- Layout changes must keep the 2.7.14 stable home sizing model and must not reintroduce height-dependent jumping.
- Visual icon work is out of scope until after the 2.8.0 stability checkpoint.

## Version Path

### 2.7.15 Runtime Closure

- Recheck start, stop, restart, connect, disconnect, system proxy preference, and app exit recovery rules.
- Add guards so disconnected system-proxy preference cannot be mistaken for active traffic takeover.
- Verify package, Tauri, Cargo, lockfile, sidebar label, release note, and installer metadata alignment.

### 2.7.16 Speed Closure

- Recheck one-click, batch, and single-node speed tests as measurement-only operations.
- Preserve UI interactivity while protection rules are opened for speed testing.
- Guard low-latency membership and delay colors with the `<100 ms` rule.

### 2.7.17 Subscription And Node Stability

- Stress the subscription menu, profile switching, rename, update, and removal paths.
- Keep node rows stable while selecting or retesting nodes; active rows should not jump unexpectedly.
- Preserve fixed/favorite/frequent/region filter behavior.

### 2.7.18 Landing IP Closure

- Keep the user-facing label as `落地 IP`.
- In smart/rule mode, query internal IP-check domains through the current selected node.
- Prevent stale IP checks from overwriting newer node changes or leaving the UI stuck.

### 2.7.19 Diagnostics And Logs Closure

- Diagnostics must run in the background and never pin the user to the diagnostics page.
- Logs must remain categorized, filterable, and exportable.
- Error surfaces must include reason, suggested action, and a path to logs or diagnostics.

### 2.7.20 Responsiveness Audit

- Stress navigation, menus, filters, node search, diagnostics, and speed tests.
- Treat visible pauses as regressions even when backend work continues.
- Ensure large node lists remain windowed and cached.

### 2.7.21 System Takeover And Recovery

- Recheck system proxy, TUN, disconnect protection, port conflicts, and Windows proxy restore.
- Ensure protection cleanup and proxy restore are diagnosable after abnormal states.

### 2.7.22 Real Scenario Soak Harness

- Add a lightweight automated soak harness for repeated start/stop, profile switch, speed test, diagnostics, and status refresh loops.
- The soak harness should be mockable, fast enough for local verification, and suitable for future real-device expansion.

### 2.8.0 Daily-Use Stability Checkpoint

- Run the full gate set.
- Build an installer.
- Release as a daily-use stability candidate, with known limits written clearly.

## Required Gates

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `node --check tools/backend-audit.js`
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release`
- `cargo test --manifest-path src-tauri/Cargo.toml`
