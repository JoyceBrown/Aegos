# Aegos 2.4 to 3.0 Roadmap

## Goal

Surpass FlClash in the user's target workflow: Windows desktop use, Codex/FlClash coexistence, stable subscription switching, fast node evaluation, clear diagnostics, and non-blocking operation.

## Mainline Constraints

- Do not trade responsiveness for correctness: UI state updates immediately, slow work runs through background jobs, and failures roll back visible state.
- Do not occupy FlClash/Codex port `7890`; Aegos keeps `7891` as the default mixed port.
- Do not add one-off UI patches for latency. Any slow interaction must use the shared optimistic UI, cached page, scheduler, or job-center pattern.
- Do not package patch-only releases unless explicitly requested. Package minor or major checkpoints.
- Every new slow operation must add smoke or audit coverage before it is considered complete.

## Small Changes: 2.3.x

Purpose: tighten the existing 2.3 architecture without broad behavior changes.

- Add digest-based config apply skip so unchanged profiles do not restart or hot-reload mihomo unnecessarily.
- Add serialized queues for system proxy, TUN, and core power operations.
- Expand runtime logs around failed subscription switching with exact profile, config path, controller response, and rollback result.
- Add focused regression tests for the subscription that still fails to switch.
- Tune node-list rendering, delay display, and pending states only through shared UI primitives.

Release rule: bump `2.3.0 -> 2.3.1`, `2.3.2`, etc. Source-only by default; no installer unless needed for runtime verification.

## Medium Changes: 2.4.0, 2.5.0

Purpose: catch up to and then exceed FlClash in reliability and speed-test strategy.

### 2.4.0 Reliability Engine

- Implement a single operation scheduler for config apply, profile switch, core restart, system proxy, TUN, and recovery.
- Add idempotent apply: same profile digest plus same patch settings must be a no-op.
- Add transaction logs for profile switch: preflight, backup, apply, controller reload, selected-map restoration, rollback.
- Add live integration smoke that switches between two local test subscriptions while the core is running.
- Package installer after all checks pass.

### 2.5.0 Speed And Route Engine

- Replace simple batch speed tests with adaptive scheduling: fast first sample, bounded retries, protocol-aware concurrency, and early result streaming.
- Track per-node health history: last success, failure streak, median delay, jitter, and protocol type.
- Build low-latency candidate ranking from real leaf proxy delay, not group labels.
- Add smart route recommendation: only nodes under 100 ms enter the low-latency list; failed or unstable nodes are excluded.
- Package installer after all checks pass.

Release rule: bump minor version and build installer.

## Large Changes: 3.0.0

Purpose: make Aegos not just a FlClash-style client, but a more automated Windows network control center.

- Add a first-class self-healing connection layer: detect outage, test candidates, switch group/node, then verify external connectivity.
- Add multi-subscription failover owned by Aegos, not by unsafe edits to FlClash app state.
- Add policy profiles: Codex-safe, gaming-low-latency, streaming, direct-first, global-safe.
- Add a structured event timeline so users can see exactly why Aegos switched, failed, rolled back, or recovered.
- Add import/export of Aegos settings and diagnostics bundle.
- Add long-running soak tests for repeated start/stop, profile switch, speed test, and recovery cycles.

Release rule: bump major version and build installer only after full test and runtime verification.

## Current Next Step

Start with 2.3.1 source-only work:

1. Audit and fix the remaining subscription switching failure with evidence from logs and code.
2. Add digest-based no-op config apply.
3. Add operation serialization for system proxy/core profile actions.
4. Extend backend and release audits so these guarantees cannot regress.

## Required Gates

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run audit:backend`
- `npm run audit:release`
