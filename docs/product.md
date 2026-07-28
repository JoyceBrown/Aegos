# Aegos Product Definition

## Evidence Boundary

- Verified: delivered capability is supported by the current source tree,
  release notes, and runnable audits.
- Decided: product and safety boundaries come from the user and the
  control-plane decisions.
- Planned: future work becomes executable only when the active plan in
  PLANS.md authorizes it.
- Open: no real production-wide defect is asserted without reproduction or
  runtime evidence.

## User Problem

Proxy clients often confuse a running core, a fast node, and a successfully
taken-over Windows network. Advanced needs such as fixed outlets, upstream
proxies, remote DNS, and leak protection then force users into raw
configuration. Aegos turns those needs into a Windows workflow with effective
state, bounded choices, diagnosis, and recovery.

## Target Users

- Windows users who need to import a subscription, choose a node, connect, and
  recover without learning Mihomo configuration.
- Users who need verifiable fixed outlet, upstream proxy, DNS, IPv6, and
  system takeover facts.
- Advanced users who need structured diagnostics and controlled routing without
  reading a Controller secret or runtime YAML.

## Product Promise

The user sees verified Aegos connection and protection state. High-risk
network changes are preflighted, explained, and reversible. Measurement and
diagnostics do not change the active network.

## Primary Windows Workflow

1. Import or update a subscription, or create a persistent fixed node.
2. Choose an ordinary node, fixed node, or fixed outlet with an upstream proxy.
3. Connect while Aegos deploys configuration and verifies core, takeover, and
   connectivity facts in the background.
4. Observe the selected node, runtime node, outlet, DNS, TUN, IPv6, and
   protection conclusion.
5. Switch or disconnect without a stuck pending state or stale success claim.
6. Diagnose and recover from an interrupted operation or a failed takeover.

## Current Scope

- Windows 10/11 x64 desktop client.
- Subscription and node management, fixed nodes, upstream proxy, and common
  routing.
- Connect, disconnect, system proxy, TUN, kill-switch, and recovery journals.
- Measurement-only node testing, outlet identity, DNS and IPv6 effective
  state, diagnostics, and redacted export.
- On-demand connection explanation from the current Aegos-normalized connection
  snapshot. It is visible only for a user-selected connection and shows only
  the available target, matched rule, managed route, process, and transport
  facts; it does not claim per-connection DNS or outlet facts that were not
  observed.
- A user-run diagnostic repair that returns to the current Aegos session
  retains an item-scoped recheck receipt: verified, unresolved, or unavailable.
  It is not a persisted repair history and does not imply that a new diagnosis
  has been run.
- Controlled rules and YAML extensions with line-level errors, intent preview,
  preflight, transactional apply, and rollback.
- Aegos-owned user rules are structured product state and may be edited only
  through preflighted product commands. Subscription/Mihomo rules and Aegos
  protection rules are observable but read-only; neither raw runtime YAML nor
  Controller data is editable from the UI.
- Managed Mihomo identity, capability, and configuration admission.
- DPAPI local backup and disconnected restore of settings, subscription
  configuration, and user routing rules only. Restore confirmation identifies
  the selected local snapshot before it can replace current product data.

## Windows Reliability Definition

Aegos is dependable enough for its current Windows scope only when the primary
workflow has repeatable evidence across normal, slow, interrupted, failed, and
real-use states:

- A saved preference is never presented as an effective connection or
  protection state without runtime and Windows evidence.
- Import, update, select, connect, switch, disconnect, and recovery either
  complete, fail with an actionable cause, or reach a terminal cancelled state.
- System proxy, TUN, DNS, and kill-switch operations are reversible and leave
  recoverable evidence after interruption.
- Navigation, diagnostics, and the status center remain useful while a
  background task is running.
- Any reproduced P0 or P1 defect blocks advancement until it is fixed or the
  user explicitly accepts its deferral.

## Development Priority

The product already exposes a broad capability baseline. The mainline is not
to add another capability family, but to make the existing primary workflow
dependable in the order a Windows user experiences it:

1. truthful import, selection, connection, takeover, switch, disconnect, and
   recovery outcomes;
2. usable navigation, status, diagnostics, and bounded large-data views while
   background work is pending, cancelled, failed, or stale; and
3. evidence from real or controlled Windows operation, including takeover
   recovery only when a separate recoverable environment is available.

A feature proposal belongs on a later route only when current workflow
evidence shows a user problem that cannot be solved by reliability,
observability, recovery, or focused ownership work. Feature breadth, multiple
cores, arbitrary execution, remote synchronization, distribution automation,
and platform expansion are not substitutes for that evidence.

The completed Windows Maturity matrix is a regression baseline, not a claim
that every live Windows path is proven. The current route reproduces real-use
defects and closes them within the existing workflow. A controlled recovery lab
and an evidence-backed ownership extraction are conditional follow-up outcomes;
they do not activate automatically and do not broaden product scope.

## Explicit Non-goals

- Reimplementing Mihomo protocols, DNS, TUN, forwarding, or rules execution.
- A second core, raw core configuration editor, arbitrary JavaScript overrides,
  or remote shell scripts.
- Authenticode work, automatic updates, GitHub updater integration, public
  release automation, WebDAV, cloud synchronization, or remote backup.
- Windows ARM64, macOS, Linux, cloud control, or multi-user collaboration.

These are not an implicit future queue. They require a later explicit user
decision and cannot displace a reproducible Windows reliability defect.

## Non-negotiable Domain Rules

- Speed testing must not connect, change nodes, or change system proxy, TUN,
  routing, firewall, or traffic takeover.
- Connected is displayed only when runtime, Windows takeover, and connectivity
  evidence agree.
- Configuration and network changes require preflight, apply, verification,
  and rollback on failure.
- DNS and IPv6 requested values are not effective-state claims. Slow and stale
  observations cannot overwrite a newer route identity.
- Subscription URLs, tokens, credentials, secrets, private keys, real public
  IPs, and local private paths must be redacted.

The rationale, competitor comparison, and accepted sequence are owned by
docs/decisions/windows-reliability-mainline.md.
