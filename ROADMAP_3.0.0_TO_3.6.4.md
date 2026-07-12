# Aegos 3.0.0 To 3.6.4 Execution Roadmap

This roadmap is the execution contract for the 3.x foundation lane. It keeps the
user's main requirement explicit: no skipped small versions, no vague "done"
claims, and every checkpoint must have a deliverable, verification, and commit.

## Canonical Planning Rule

This file is the single source of truth for version execution.

- Research documents under `research/` are absorption notes and reference
  material. They must not define a conflicting version route.
- If a research document discovers a useful capability, it must be merged into
  this roadmap before implementation starts.
- The 3.3.x lane is the routing-assistant lane because 3.3.0 opened that gate
  and 3.3.1-3.3.3 have already shipped as source checkpoints.
- Manual-node and protocol-field maturity from the open-source absorption plan
  is preserved in 3.6.x and later migration lanes, not in 3.3.x.

## Non-Negotiable Rules

- Speed tests never connect, switch nodes, switch mode, or take over traffic.
- Current node, recommended node, outbound IP, system proxy, TUN, and protection
  state must remain consistent after every operation.
- Heavy work must run in background jobs or non-blocking polling; navigation and
  normal buttons must remain usable.
- User/core/subscription text must render through safe text nodes or
  `textContent`; no production `innerHTML`.
- Subscription URLs, tokens, passwords, UUIDs, real IPs, and local paths must be
  redacted in logs and exported diagnostics.
- New rules, routing, IPv6, system proxy, firewall, file writes, and Tauri
  commands must add matching security checks.
- Open-source projects may be absorbed as contracts, strategies, adapter
  patterns, or validation fixtures. Do not copy GPL code, icons, UI assets, or
  protected implementation.

## Version Route

| Version | Goal | Required Acceptance |
|---|---|---|
| 3.0.0 | Mature proxy-client foundation gate | Existing release, security, speed, stability, responsiveness, installer-regression, copy, and open-source absorption gates pass together. |
| 3.1.0 | Read-only routing page skeleton | Route/rule page exists as read-only, with no config writes. |
| 3.1.1 | Routing page entry | Navigation, deferred loading, and page cache are wired without slowing existing pages. |
| 3.1.2 | Current mode summary | Smart/global/direct mode summary is visible and matches backend status. |
| 3.1.3 | Strategy group list | Strategy groups are listed separately from ordinary nodes. |
| 3.1.4 | Strategy type classification | select/url-test/fallback/load-balance are labeled clearly. |
| 3.1.5 | Current strategy selections | Current selection/automatic behavior is shown without implying a speed test connected. |
| 3.1.6 | Recent rule hits | Recent connection rule hits are summarized with sensitive data redacted. |
| 3.1.7 | Read-only routing acceptance | Routing page performance, layout, and security gates pass. |
| 3.2.1 | Rule list parser | Current rules are parsed into structured records. |
| 3.2.2 | Rule target validation | Rules pointing to missing strategy groups are reported. |
| 3.2.3 | Rule order/conflict detection | Risky order and obvious conflicts are diagnosed. |
| 3.2.4 | Profile-switch rule validation | Subscription switch validates rules before trusting runtime config. |
| 3.2.5 | Rule hot-reload preflight | Future rule writes have preflight contract and rollback plan. |
| 3.2.6 | Rule rollback mechanism | Failed rule changes restore previous working config. |
| 3.2.7 | Rule diagnostics report | Diagnostics page can explain routing-rule problems. |
| 3.2.8 | Rule foundation acceptance | Parser, validation, diagnostics, and security gates pass. |
| 3.3.1 | Website routing wizard | Ordinary users can express website proxy/direct without YAML. |
| 3.3.2 | App routing wizard | Ordinary users can express app/process proxy/direct with validation. |
| 3.3.3 | Generate rule from connection | Connection records can seed a draft rule safely. |
| 3.3.4 | Region/strategy target wizard | Region or strategy target can be selected without editing raw YAML. |
| 3.3.5 | Rule conflict prompts | Conflicts are visible before applying. |
| 3.3.6 | One-click undo | User-created rules can be undone. |
| 3.3.7 | Rule effectiveness verification | Applied rules can be verified without disrupting connection. |
| 3.3.8 | Simple/advanced rule separation | Ordinary and advanced rule surfaces are separated. |
| 3.3.9 | Routing assistant acceptance | Wizard, rollback, diagnostics, and smoke tests pass. |
| 3.4.1 | Local IPv6 capability | Local IPv6 capability is detected and displayed. |
| 3.4.2 | Current-node IPv4 outlet | IPv4 outlet check represents the current node. |
| 3.4.3 | Current-node IPv6 outlet | IPv6 outlet check represents the current node when supported. |
| 3.4.4 | Node IPv6 support | Node IPv6 support is classified without changing connection. |
| 3.4.5 | IPv6 leak detection | IPv6 leak risk is separated from "node unsupported". |
| 3.4.6 | DNS leak detection | DNS leak risk is classified and user-actionable. |
| 3.4.7 | IPv6 automatic mode | User-facing IPv6 mode becomes automatic, not manual confusion. |
| 3.4.8 | IPv4 fallback or block | Unsupported IPv6 falls back or blocks leakage safely. |
| 3.4.9 | Plain user prompt | User sees a plain explanation when IPv6 falls back. |
| 3.4.10 | IPv6/DNS acceptance | Leak checks, fallback, diagnostics, and safety gates pass. |
| 3.5.1 | Connection failure classifier | Connection failures are categorized with next actions. |
| 3.5.2 | Subscription failure classifier | Subscription failures are categorized with next actions. |
| 3.5.3 | Speed failure classifier | Speed failures remain visible and never hang the UI. |
| 3.5.4 | Outbound IP anomaly prompt | Stale or failed outbound IP lookups are canceled and explained. |
| 3.5.5 | System proxy repair | Repair is transaction-safe and reversible. |
| 3.5.6 | Port conflict suggestion | Port conflicts show occupying process when available. |
| 3.5.7 | Same-region recovery suggestion | Unavailable nodes suggest same-region alternatives only. |
| 3.5.8 | Airport-wide failure prompt | Whole-provider failure suggests subscription switch but requires user confirmation. |
| 3.5.9 | Smart recovery acceptance | Recovery is explainable, cancelable, non-invasive, and audited. |
| 3.6.1 | Favorite node persistence | Favorite nodes survive restart/profile refresh safely. |
| 3.6.2 | Frequent node statistics | Frequent nodes use real connection history, not fake metrics. |
| 3.6.3 | Fixed node protocol fields | Manual fixed nodes expose validated Reality, uTLS, SNI, ALPN, fingerprint, flow, obfs, ShadowTLS, Snell, HY2, and TUIC fields where supported. |
| 3.6.4 | Fixed node CRUD/import/export acceptance | Manual fixed nodes support edit/delete/import/export, aliases, fixture coverage, clear unsupported-field prompts, and no corruption of real proxy names. |

## Absorption Alignment

The open-source absorption plan is merged into this route as follows:

- MetaCubeXD and mihomo rule visibility map to 3.1.x and 3.2.x.
- Hiddify-style ordinary-user routing expression maps to 3.3.x.
- v2rayN and NekoBox/NekoRay protocol/manual-node lessons map to 3.6.x.
- v2rayN migration research is deferred to the 4.x migration lane.
- Snell/ShadowTLS server-side material stays reference-only until a later
  template/documentation lane; Aegos must not execute server shell scripts.
- sing-box/CoreAdapter work is deferred until after the current mihomo-based
  Windows lane remains stable.

## Checkpoint Discipline

Each version must include:

- A release note for that exact version.
- A version bump across package, lockfile, Tauri config, Cargo, and sidebar.
- Either code, audit, smoke, or documentation that matches the version goal.
- Verification commands recorded in the release note.
- A git commit for that version before moving to the next one.

## Stop Gates

Stop and fix before moving forward if any of these occur:

- Speed test switches or connects a node.
- Diagnostics, speed test, subscription switch, or logs block navigation.
- Subscription token or node secret appears in logs/export.
- Rule/routing work writes config before the read-only and rule-foundation gates
  are complete.
- IPv6/DNS checks change the user's connection, mode, or current node.
- Release, security, speed, stability, or responsiveness audit fails.
