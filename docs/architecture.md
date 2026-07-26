# Aegos Architecture

## Durable Boundary

- Decided: Aegos owns the Windows product control plane. Mihomo is the managed
  data plane for proxy protocols, DNS, TUN, forwarding, and rule execution.
- Decided: Windows real-use reliability is achieved by making the existing
  control plane observable, transactional, recoverable, and maintainable; it
  is not achieved by adding another core or a raw-core UI.
- Verified: DNS policy, IPv6 policy, outlet identity, node selection, backup,
  command coordination, and task settlement now have focused owners outside
  main.rs.
- Open: actual Windows environment coverage must be built from reproducible
  workflow evidence. Static gates and unit tests do not substitute for it.

## System Shape

~~~text
WebView2 UI
  -> Tauri product commands
    -> Aegos command coordinator and domains
      -> config compiler and deployment transaction
      -> Windows takeover and recovery journal
      -> narrow managed-Mihomo adapter
~~~

The UI never reads Controller secrets, raw Controller envelopes, or runtime
YAML. It sends product commands and renders Aegos-normalized snapshots.

## Module Ownership

| Area | Owner |
| --- | --- |
| User workflows and effective-state presentation | src/app.js, src/index.html, src/styles.css |
| Tauri composition and command entry points | src-tauri/src/main.rs |
| Exclusive runtime mutation vocabulary and visible operation snapshot | runtime_command.rs |
| Background task terminal state and cancellation | task_runtime.rs |
| Aegos settings and persisted intent | app_config.rs |
| Subscription parsing and source updates | subscription_runtime.rs |
| Fixed-node persistence and controlled metadata | manual_node_runtime.rs |
| Node selection, DNS reload, and selection rollback | node_selection.rs |
| DNS, IPv6, and outlet identity product snapshots | dns_policy.rs, ipv6_policy.rs, egress_identity.rs |
| Configuration validation, compilation, deployment, and rollback | config_extensions.rs, config_pipeline.rs, profile_compiler.rs, config_deployment.rs |
| User routing domain and store | routing_domain.rs, routing_store.rs |
| Managed Mihomo boundary and normalized snapshots | dataplane.rs, core_runtime.rs, core_domain.rs |
| Windows proxy, routing, firewall, TUN takeover, and recovery journal | system_takeover.rs |
| Constrained storage, DPAPI local backup, and bounded Windows processes | storage_runtime.rs, backup_runtime.rs, windows_process.rs |
| Measurement-only speed scheduling | speed_runtime.rs, speed_scheduler.rs |

## Primary Transaction Contract

1. A UI product command acquires the runtime coordinator when it changes
   profile, configuration, core, or Windows state.
2. The control plane compiles and preflights a candidate from Aegos intent.
3. Deployment records rollback information, applies the candidate, and verifies
   managed runtime identity.
4. Windows takeover records recovery state and verifies the operating-system
   effect.
5. A normalized snapshot exposes the effective state and terminal operation
   result to the UI.
6. Failure restores the correct prior configuration, selection, or takeover
   state. Interrupted work remains visible to startup recovery.

## Reliability Architecture Work

The Windows reliability route may extract responsibilities from main.rs and
app.js only when a reproduced workflow defect, UI stall, recovery failure, or
acceptance gap requires it. Extraction must keep one command path and one state
owner; it must remove the replaced path. The existing control-plane no-growth
budgets remain enforced and may not be raised to pass an audit.

No current architecture work authorizes:

- a second proxy core or protocol implementation;
- raw runtime YAML or Controller access in the UI;
- WebDAV, cloud sync, automatic update, or remote execution;
- cross-platform abstraction before a later explicit route decision.

## Current Architecture Priority

The architectural risk is concentrated in orchestration surfaces rather than
missing abstractions. On the 2026-07-26 control-plane audit, `main.rs` used
11,678 of its 11,770 production-line budget and `core_runtime.rs` used 2,896
of 2,900. The frontend is also a large shared workflow surface. Those counts
are capacity warnings, not permission for a rewrite.

The only acceptable extraction sequence is:

1. reproduce a user-visible delay, stale result, terminal-state error, or
   recovery failure;
2. identify the current owner and its consumers with trace or test evidence;
3. move one cohesive policy or transaction to its named domain module while
   retaining one command path and one visible-state owner; and
4. delete the replaced orchestration, then validate the affected workflow and
   the no-growth budget.

In particular, measurement scheduling must remain detached from traffic
takeover, and slow observation must be cancellable or generation-checked
before it can update a visible product snapshot. UI work must keep navigation,
the status center, and diagnostics available while those operations run. File
size and a near-budget count alone never authorize an architecture-only
milestone.

## Cross-cutting Constraints

- High-risk operations are preflighted, verified, recoverable, and
  restart-aware.
- Slow checks and network calls do not block navigation.
- Dynamic user and core text is rendered as text, not injected HTML.
- Sensitive values stay out of UI logs, fixtures, screenshots, and exports.
- Code scans supplement, but never replace, behavioral evidence.

The current mainline decision is docs/decisions/windows-reliability-mainline.md.
