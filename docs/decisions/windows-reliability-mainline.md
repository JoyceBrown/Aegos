# Aegos Windows Real-Use Reliability Mainline

decision_id: AEGOS-DEC-2026-07-WINDOWS-RELIABILITY
status: decided
date: 2026-07-26
reviewed_at: 2026-07-26
execution_authority: none
supersedes: AEGOS-DEC-2026-07-WINDOWS-MATURITY

## Decision

Aegos has one development mainline: **Windows real-use reliability**. The
product will make its existing Windows workflow truthful, recoverable, and
responsive before adding another capability family or chasing parity with other
proxy clients.

`docs/roadmap.md` owns the ordered outcomes. `PLANS.md` is the only document
that authorizes work. This decision records why the order is correct; it cannot
authorize an implementation task.

## What The Product Already Has

The repository already implements subscription import/update, ordinary and
fixed nodes, upstream proxy, controlled routing, configuration compilation and
deployment, system proxy, TUN, kill-switch, DNS/IPv6 and outlet reporting,
diagnostics, recovery journals, and local DPAPI backup. The 3.6.58 through
3.6.62 work added focused domain owners for DNS, IPv6, egress identity, node
selection, task settlement, and backup.

This is sufficient feature breadth for the current Windows product. Adding
more surface would not answer the important day-to-day questions:

1. Did the selected profile and node actually become the managed runtime?
2. Is Windows traffic takeover active, safely standing by, failed, or waiting
   for recovery?
3. Did a switch, disconnect, repair, or cancellation reach a visible terminal
   state?
4. Can the user navigate, read diagnostics, and take the next action while
   that work is occurring?

## Evidence-Based Diagnosis

| Area | Repository evidence | Consequence |
| --- | --- | --- |
| Controlled workflow | The WM-05 register records 222 passing Rust tests, browser interaction/UI smoke, 800-node stress, soak, and the relevant safety and architecture gates. | Preserve the regressions. Do not reopen delivered capability merely to create work. |
| Transaction safety | Configuration deployment, node selection, fixed-node DNS, system takeover, and backup have rollback or recovery-journal paths. | The next proof must be outcome-level: previous state, effective state, and recovery must agree under a real failure. |
| UI responsiveness | `app.js` defers page work, virtualizes large node lists, and isolates measurement from foreground actions; native evidence closed one first-settings long task. | A passing pressure run is protection, not proof that an actual user-reported stall cannot recur. Reproduce a real stall before rewriting UI code. |
| Live Windows coverage | The shared host was intentionally not used for system proxy, TUN, DNS interception, firewall, or external-connectivity takeover. | This is the largest remaining evidence gap. It needs a separate recoverable lab, never an optimistic pass claim. |
| Maintainability | `main.rs` is 14,645 total lines with 52 Tauri commands, and `app.js` is about 9,346 lines. The enforced production budgets are nearly full. | A focused defect may require extraction, but file size alone is not permission for a rewrite. |

The completed Windows Maturity plan correctly removed several real defects,
including false terminal state, fixed-node/DNS divergence, rollback coverage,
and one native first-entry long task. It also reached the correct stopping
point: isolated evidence is not interchangeable with live Windows evidence.

## Competitor Comparison

| Product | Current public emphasis | Relevant lesson | Deliberate non-choice for Aegos |
| --- | --- | --- | --- |
| FlClash | A broad multi-platform ClashMeta client; its recent changelog continues to repair Windows service, TUN, storage, proxy-list, and UI/performance behavior. | Windows takeover and large-list reliability remain ongoing product work even for a mature client. | Copying GPL code/UI, WebDAV, platform breadth, or cosmetic feature volume. |
| Clash Verge Rev | Tauri client spanning Windows, macOS, and Linux with TUN, system-proxy guard, profile merge/scripts, and WebDAV sync. | Tauri is appropriate for this product class; network-state recovery must be treated as a first-class workflow. | Scripts, merge surface, sync, and cross-platform compatibility before Aegos' Windows operation is proven. |
| v2rayN | Multi-platform, multi-core client with extensive release assets and GPG verification. | Distribution hygiene is valuable when public distribution is actually a goal. | More cores, architecture variants, signing/updater work for this private Windows workflow. |
| Clash Party / Mihomo Party | Smart-core and Mihomo configurations, subscription tooling, and networked backup/override options. | Subscription failure handling matters because it is an early workflow failure point. | Networked sync, arbitrary configuration rewriting, and another core. |
| Clash Nyanpasu | Tauri client with multiple cores and YAML/JavaScript/Lua profile enhancement. | Profile ownership and diagnostics need clear boundaries. | Raw configuration exposure, arbitrary code execution, and multi-core expansion. |

Sources checked on 2026-07-26:

- https://github.com/chen08209/FlClash/blob/main/CHANGELOG.md
- https://github.com/clash-verge-rev/clash-verge-rev
- https://github.com/2dust/v2rayN
- https://github.com/mihomo-party-org/clash-party
- https://github.com/libnyanpasu/clash-nyanpasu

These sources are product-comparison evidence only. Aegos must not copy GPL
code, icons, or UI assets.

## Chosen Sequence

1. Establish an evidence-backed real-use defect baseline without changing the
   shared host network. A UI freeze, stuck operation, false success state, or
   recovery contradiction is treated as a route defect immediately.
2. Repair each reproduced P0/P1 in its owning transaction. Preserve one command
   path, one visible-state owner, one focused regression, and the existing
   global gates.
3. When and only when a dedicated recoverable Windows lab exists, prove system
   proxy, TUN, DNS, firewall, interruption, and external-change recovery there.
4. Extract a measured backend or frontend owner only when the repair requires
   it; delete the replaced path and retain the control-plane budgets.

This means the next task is a defect-reproduction and repair route, not an
architecture rewrite and not a feature wishlist.

## Explicit Non-Goals

The following are not pending backlog items in this mainline: signing,
automatic updates, GitHub release automation, WebDAV/cloud synchronization,
remote control, Windows ARM64, macOS, Linux, a second core, raw Controller or
runtime-YAML editing, arbitrary scripts, protocol implementation, a rules
engine, a broad UI redesign, or a frontend-framework migration.

Each needs a later explicit user decision after the Windows reliability route;
none can start from a generic continuation request.

## Guardrails

- A reproduced P0/P1 blocks lower-priority work. P2 has an honest visible
  state and a safe workaround or an explicit user deferral.
- No test result may be described as a live Windows result unless it observed
  the corresponding operating-system fact.
- Do not raise a control-plane budget, remove an assertion, skip a failing
  gate, retain a replacement implementation, or change FlClash to make a
  result look green.
