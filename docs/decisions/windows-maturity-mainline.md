# Windows Maturity Mainline

decision_id: AEGOS-DEC-2026-07-WINDOWS-MATURITY
status: historical
date: 2026-07-26
reviewed_at: 2026-07-26
execution_authority: none
superseded_by: AEGOS-DEC-2026-07-WINDOWS-RELIABILITY

> Historical closeout. This decision records the completed 3.6.58-3.6.62
> Windows Maturity program. It has no execution authority and cannot select
> work. The current route rationale is
> `docs/decisions/windows-reliability-mainline.md`.

## Decision

Aegos has one development mainline: make the existing Windows product workflow
dependable from subscription import through recovery. The goal is not to match
other proxy clients feature-for-feature. It is to make the supported workflow
truthful, transactional, recoverable, and usable while background work runs.

`docs/roadmap.md` owns the outcome sequence. `PLANS.md` is the only document
that authorizes implementation work. This decision explains why that sequence
is the right one; it cannot authorize a task itself.

## Product Position

Aegos is a Windows control plane over one managed Mihomo data plane. It owns
the user's intent, configuration transaction, Windows takeover, normalized
effective state, diagnostics, and recovery. Mihomo owns proxy protocols, DNS,
TUN, forwarding, and rule execution.

The useful distinction is therefore not "more features than another client".
It is whether Aegos can always answer these user questions honestly:

1. Was my subscription, profile, and selected node actually applied?
2. Is traffic really being taken over, or is the core only standing by?
3. Did a switch, disconnect, or repair finish, fail, or require recovery?
4. Can I keep navigating and diagnose the next action while it is working?

## Route Assessment

The 2026-07-26 reassessment confirms that the product's immediate risk is not
missing proxy protocols or configuration surface. The source already contains
subscription and fixed-node management, controlled configuration deployment,
system takeover and journals, DNS/IPv6 and outlet observations, diagnostics,
and local backup. The unresolved risk is whether those features continue to
show an honest, recoverable, responsive Windows workflow under load and
failure.

The assessment separates four kinds of evidence:

| Evidence | Current conclusion | Planning consequence |
| --- | --- | --- |
| Source and isolated runtime tests | Transaction, rollback, redaction, command coordination, and recovery mechanisms exist and 222 Rust tests pass. | Preserve them; do not reopen the delivered feature program as a new route. |
| Mocked browser pressure and interaction smoke | Bounded large lists, navigation, terminal job states, and ten interaction journeys pass. | Treat this as regression protection, not proof of native WebView2 or live Windows behavior. |
| Native WebView2 measurement | Matched hidden-native 800-node enabled and suppressed runs now show bounded node and routing rendering, cancellable measurement, and no action-associated diagnostic long task. The initial settings construction hotspot was removed by idle warming its static structure. | WM-04 is closed; preserve its native regression gate while WM-05 reruns the complete acceptance matrix. |
| Architecture budgets | The current audit reports `main.rs=11678/11770` and `core_runtime.rs=2896/2900` production lines; total source size is larger because the same file retains integration tests. | New behavior cannot be appended to these owners. Extract only the measured policy or transaction and remove the replaced code path. |

The mainline is therefore **Windows Maturity with reliability before feature
breadth**: truthful effective state and recovery first, responsive observation
second, full acceptance third. After acceptance, the repository waits for user
review instead of automatically starting a second product track.

## Evidence Review

| Area | Verified repository evidence | Route implication |
| --- | --- | --- |
| Supported workflow | Subscription import/update, ordinary and fixed nodes, upstream proxy, configuration deployment, system proxy, TUN, kill-switch, DNS, IPv6, outlet identity, diagnostics, recovery, and local DPAPI backup are implemented. | The immediate need is integration reliability, not another capability family. |
| Safety mechanisms | Configuration deployment, node selection, Windows takeover, and backup have preflight, rollback, or recovery-journal paths. | Each mechanism needs outcome-level proof: prior state survives a failed or interrupted operation and the UI presents the resulting fact. |
| Async control | Command coordination, visible operation state, terminal task settlement, bounded waits, and stale-result guards exist. | Test real paths for stuck, optimistic, or stale states before extracting more infrastructure. |
| Resolved Windows defects | WM01-001 fixed invalid one-group profile normalization; WM02-001 fixed premature connected/disconnected display; WM02-002 fixed safe-standby being overwritten as disconnected. | Continue from the next unproven workflow segment instead of reopening a completed feature program. |
| Current gate state | On 2026-07-26, `cargo test --manifest-path src-tauri/Cargo.toml` passed 222 tests. Interaction/UI smoke, stress, soak, configuration/deployment, planning-context, control-plane, and release audits also passed. The current control-plane audit reports `main=11678/11770`, `core_runtime=2896/2900`. | Existing boundaries hold. Budgets and assertions must not be weakened. |
| Resolved WM-03 isolation | The loopback subscription journey now uses a test-only direct downloader and a request-reading local server. It proves valid, invalid, slow, and stale-address updates without changing production HTTP/HTTPS proxy behavior. | The old local `502` is resolved test isolation, not a product failure or a remaining blocker. |
| WM-03 closure | The isolated managed-Mihomo journey now proves ordinary selection, fixed-node selection, DNS reload rollback, fixed-node save/delete rollback, Controller truth, runtime digest, and runtime-YAML restoration. A custom terminal `MATCH` route now remains the DNS and outbound-lookup primary group; test-only process serialization prevents local listener contention. | WM-03 is complete. Its regressions remain guarded through WM-05 acceptance. |
| WM-04 closure | Matched 800-node enabled/suppressed native runs retained 43 rendered node rows, a bounded 100-row routing result, 29.6-30.9 ms node first paint, 10.9-12.9 ms routing first paint, and a 50.7 ms measurement-cancellation terminal state. Synchronous navigation and diagnostics work stayed at or below 0.7 ms. Idle warming removed the intermittent first-settings over-120 ms long task without a second render path. | WM04-001 and WM04-002 are closed. The retained 62-76.5 ms hidden-host composition samples are warnings, while the 120 ms paint and action-long-task limits remain blocking checks. |
| Maintainability risk | `main.rs` has 52 Tauri command entries and about 14,645 total lines; `app.js` has about 9,346 lines. | Do not rewrite based on size alone. A future post-acceptance plan may extract only a demonstrated hot path, with one state owner and no dual path. |

The old 219- and 220-test results, their loopback failure, and the missing
selection evidence are historical records only. The current 222-test result
includes the resolved WM-03 selection and rollback journeys.

## Competitive Comparison

| Product | Publicly stated focus | What Aegos should learn | What Aegos should not copy now |
| --- | --- | --- | --- |
| FlClash | Broad multi-platform ClashMeta client. Its recent changelog still includes Windows service, TUN, storage, performance, proxy-list, and UI fixes, alongside themes, WebDAV, and release breadth. | Windows network integration and large-list performance remain real maintenance work even in a broad product. | GPL code or UI assets, WebDAV, platform expansion, or feature breadth as a substitute for recovery evidence. |
| Clash Verge Rev | Tauri client for Windows, Linux, and macOS with embedded Mihomo, system proxy/TUN, profile helpers, scripts, and WebDAV sync. | Tauri is a sound native shell for this product class. | The large compatibility, script, merge, sync, and multi-platform surface before Windows behavior is proven. |
| v2rayN | Cross-platform GUI supporting multiple cores, architecture variants, release assets, and GPG verification. | Distribution discipline is valuable when public distribution becomes a goal. | Signing, updater work, second cores, or platform variants for a private Windows workflow. |
| Mihomo Party | Smart Core plus Mihomo, broad configuration rewrite, WebDAV backup/restore, and Sub-Store integration. | Subscription experience matters, but it must remain reliable under failure. | Networked backup/sync, arbitrary configuration rewriting, and an additional core. |
| Clash Nyanpasu | Tauri client supporting multiple cores and YAML, JavaScript, and Lua profile enhancement. | Profile management needs clear ownership and diagnostics. | Arbitrary script execution, raw runtime configuration exposure, and multi-core support. |

Sources consulted on 2026-07-26:

- https://github.com/chen08209/FlClash/blob/main/CHANGELOG.md
- https://github.com/clash-verge-rev/clash-verge-rev
- https://github.com/2dust/v2rayN/blob/master/README.md
- https://github.com/mihomo-party-org/clash-party/blob/smart_core/README.md
- https://github.com/libnyanpasu/clash-nyanpasu/blob/main/README.md

These descriptions are comparison evidence only. Aegos must not copy
competitor code, icons, or UI assets.

## Chosen Route

| Milestone | User-visible result | Why it comes now |
| --- | --- | --- |
| WM-01, completed | A safe Windows truth baseline and one real managed-Mihomo profile-compiler repair. | Established that static gates cannot be mistaken for end-to-end evidence. |
| WM-02, completed | Correct pending and terminal connection states, safe-standby remediation, and durable proxy-restore recovery. | Eliminated known lies about connection and recovery state. |
| WM-03, completed | Transactional subscription update, selection, and deployment now preserve the prior usable state across valid, invalid, slow, stale, and injected rollback paths. | This closes the earliest import/selection divergence point with real isolated managed-runtime evidence. |
| WM-04, completed | Diagnostics, navigation, status center, and large lists remain usable during work; idle warmup fixed the reproduced first-settings long task without retaining a second path. | Responsiveness is now guarded by matched native, interaction, UI, stress, soak, and safety evidence. |
| WM-05, completed | One representative Windows maturity matrix, full regression evidence, and private unsigned package evidence. | The host-safe matrix passed and stops for user review; it does not activate a continuation route. |

## Continuation Direction

After WM-05, the next route is chosen only after user review. The ordered
direction is controlled Windows takeover recovery evidence, then
feedback-driven Windows defect closure, then measured ownership reduction.
Each needs a new exclusive plan and can start only when its environment or
reproduction condition is available. This keeps the product focused on the
same Windows workflow rather than reopening feature competition with broader
clients.

## Explicit Deferrals

The following are deliberately outside this mainline. They require a new
roadmap decision after Windows maturity, not an opportunistic implementation:

- signing, GitHub release publication, automatic updates, and updater design;
- WebDAV, cloud backup, synchronization, remote control, or remote execution;
- Windows ARM64, macOS, Linux, and cross-platform abstraction;
- a second core, raw Mihomo Controller or runtime-YAML UI, arbitrary scripts,
  and protocol or rules-engine implementation.

## Decision Rules

- A reproduced P0 or P1 blocks the current milestone. A UI freeze, permanent
  pending indicator, blocked navigation, stale success, or unrecoverable
  rollback is a current-route defect, not a separate feature track.
- P2 work needs an honest visible state and a safe workaround; it remains
  recorded in its owning milestone unless the user explicitly defers it.
- An unavailable live system-proxy or TUN environment is an explicit evidence
  limitation. It is never reported as a passing test.
- No plan can pass by raising the control-plane budget, deleting an assertion,
  skipping a failed gate, or retaining a replacement implementation beside its
  successor.
