# Aegos Open-Source Absorption Roadmap

Updated: 2026-07-13

Canonical execution plan: `ROADMAP_3.0.0_TO_3.6.4.md`

This document is a research and absorption map. It does not define independent
version numbers. If a capability here needs implementation, it must first be
merged into the canonical roadmap.

## Planning Decision

The previous draft conflicted with the canonical roadmap by assigning 3.3.x to
manual-node and protocol-field maturity while the canonical roadmap assigns
3.3.x to the routing assistant. That conflict is resolved as follows:

- `ROADMAP_3.0.0_TO_3.6.4.md` is the only execution contract.
- 3.3.x remains the routing-assistant lane.
- Manual-node and protocol-field maturity moves to 3.6.x.
- v2rayN migration research moves to the later 4.x migration lane.
- Snell/ShadowTLS server-side script material remains reference-only unless a
  future template/documentation lane passes security review.

## Absorption Rules

- Absorb contracts, product strategy, API semantics, test methods, validation
  fixtures, and architecture boundaries.
- Do not copy GPL code, icons, UI assets, or protected implementation details.
- Do not introduce a new runtime core until the mihomo Windows lane remains
  stable and the CoreAdapter boundary is designed.
- Do not execute server-side shell scripts from the desktop client.
- Every absorbed item needs an audit, fixture, smoke test, checklist, or release
  note before being called complete.

## Project Mapping

| Source | Useful Lessons | Canonical Lane |
|---|---|---|
| mihomo official API | Controller contract, rules, groups, connections, traffic, healthcheck semantics | 3.1.x, 3.2.x, 3.3.x |
| MetaCubeXD | Dashboard information structure for rules, connections, logs, providers | 3.1.x, 3.2.x |
| Hiddify App | Ordinary-user routing expression without YAML | 3.3.x |
| FlClash | Responsiveness, non-blocking speed tests, simple interaction rhythm | Continuous gates and 3.7+ polish |
| Clash Verge Rev | Tauri desktop engineering, system proxy, tray, platform boundaries | 3.6.x and later platform work |
| v2rayN | Protocol compatibility, migration research, manual import lessons | 3.6.x for manual nodes; 4.x for migration |
| NekoBox/NekoRay | Manual-node field coverage and protocol boundary lessons | 3.6.x |
| sing-box | Future CoreAdapter, IPv6/TUN/routing model reference | After current mihomo lane stabilizes |
| jinqians/snell.sh | Snell/ShadowTLS parameter template ideas only | Reference-only until a safe documentation lane |

## Canonical Version Mapping

### 3.1.x: Read-Only Routing Foundation

Absorbs mihomo and MetaCubeXD ideas.

- Show current mode, strategy groups, automatic group types, current selections,
  and rule/routing summaries.
- Keep strategy-group references out of ordinary node lists.
- Keep the page read-only. No config writes.
- Acceptance belongs to the canonical 3.1.x route.

### 3.2.x: Rule Parser, Validation, Preflight, Rollback

Absorbs mihomo rule semantics and MetaCubeXD-style diagnostics.

- Parse current rules into structured records.
- Validate targets, order, conflicts, and profile-switch risks.
- Define hot-reload preflight and rollback before any write-enabled UI.
- Keep all routing changes read-only until the foundation gates pass.

### 3.3.x: Ordinary-User Routing Assistant

Absorbs Hiddify-style ordinary-user expression.

Current canonical route:

| Version | Canonical Goal |
|---|---|
| 3.3.1 | Website routing wizard |
| 3.3.2 | App/process routing wizard |
| 3.3.3 | Generate rule draft from connection |
| 3.3.4 | Region/strategy target wizard |
| 3.3.5 | Rule conflict prompts |
| 3.3.6 | One-click undo |
| 3.3.7 | Rule effectiveness verification |
| 3.3.8 | Simple/advanced rule separation |
| 3.3.9 | Routing assistant acceptance |

Rules for this lane:

- Users should express intent as website, app, region, proxy, direct, or reject.
- Drafts must not write config until preflight, rollback, undo, and verification
  gates are ready.
- Speed tests must never switch or connect nodes.
- Heavy work must remain backgrounded and navigation must stay responsive.

### 3.4.x: IPv6/DNS Automatic Safety

Preserves the user-requested future IPv6 direction:

- Local IPv6 detection.
- Current-node IPv4 and IPv6 outlet checks.
- Node IPv6 support classification.
- IPv6 and DNS leak detection.
- Automatic IPv6 mode with IPv4 fallback or leak blocking.

This lane must not change the user's current node, mode, or connection while
probing.

### 3.5.x: User-Facing Failure Classification And Recovery

Absorbs FlClash-style clarity and mature-client recovery behavior.

- Classify connection, subscription, speed-test, outbound-IP, system-proxy, and
  port-conflict failures.
- Suggest same-region alternatives and provider-level actions only when safe.
- Keep recovery explainable, cancelable, and non-invasive.

### 3.6.x: Node Personalization And Manual-Node Maturity

Absorbs v2rayN and NekoBox/NekoRay lessons that previously conflicted with the
3.3.x route.

| Version | Canonical Goal |
|---|---|
| 3.6.1 | Favorite node persistence |
| 3.6.2 | Frequent node statistics from real history |
| 3.6.3 | Fixed-node protocol fields |
| 3.6.4 | Fixed-node CRUD/import/export acceptance |

Manual-node field scope:

- Reality, uTLS, SNI, ALPN, fingerprint, flow.
- obfs, ShadowTLS, Snell, Hysteria2, TUIC extension parameters where supported.
- Clear unsupported-field prompts.
- Fixture coverage before claiming support.

## Deferred Lanes

- v2rayN migration import belongs to a later 4.x migration lane.
- CoreAdapter and sing-box runtime experiments require a separate architecture
  gate and must not destabilize the mihomo default path.
- Snell/ShadowTLS server-side helpers may become documentation/template
  generation only after security review; no remote shell execution by default.
- macOS/Linux support needs platform abstraction and release gates before user
  promises.

## Immediate Next Step

Continue from the canonical roadmap:

- Current completed source checkpoints: 3.3.1, 3.3.2, 3.3.3.
- Next planned checkpoint: 3.3.4, region/strategy target wizard.

Before 3.3.4 implementation starts, verify:

- `ROADMAP_3.0.0_TO_3.6.4.md` remains the single source of truth.
- No research document contains a conflicting 3.3.x route.
- Routing assistant remains draft-first and write-disabled.
