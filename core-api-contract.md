# Aegos Mihomo API Contract

Version: 3.6.33
Updated: 2026-07-17

Purpose: this document fixes the boundary between Aegos and mihomo. It defines which controller APIs Aegos may call, whether each call may change runtime state, how it must be wrapped, and which checks must guard future changes.

This is a contract, not a feature wish list. If code needs a mihomo API that is not listed here, update this document and the related audit before implementing the call.

## 1. Non-Negotiable Rules

- Delay tests are measurement-only in Aegos. They may update delay, health, recommendation, confidence, and failure reason. They must not switch the current node, change mode, enable system proxy, enable TUN, or take over traffic.
- All controller calls must go through `CoreController`. Raw controller response fields must be normalized into Aegos domain types before they reach commands, product logic, or the frontend.
- The controller must stay bound to `127.0.0.1` with a generated secret. `allow-lan` remains opt-in and must not be enabled by feature work.
- Every call must have a timeout. UI-visible actions must remain cancellable or detached when they can be slow.
- Errors must be classified before reaching the UI when the user needs a reason: timeout, DNS, TLS, auth, unsupported protocol, controller unavailable, node not found, config, protection blocked, network, unknown.
- Logs, diagnostics, and export reports must not expose controller secret, subscription tokens, node passwords, UUIDs, bearer tokens, or raw subscription URLs.
- Calls that mutate runtime state must be treated as transactions: preflight, apply, verify when possible, rollback or explicit failure state.

## 2. Current Aegos Controller Envelope

Implementation:

- Private `CoreController::request` and `controller_request` transport functions for authenticated JSON requests. Product modules may not call either function; every endpoint requires a named typed `CoreController` method.
- `CoreController::traffic_snapshot(timeout_ms)` for the streaming `/traffic` endpoint.
- `connection_snapshots_from_controller(payload, sanitize)` as the only parser for raw `/connections` fields.
- `ProxyCatalog` as the product-owned node/group model after `/proxies` normalization. Default groups, selected-map resolution, nested-group leaf resolution, and fixed-node metadata are applied once through this model; product code must not recreate those behaviors with independent JSON mutation helpers.

Envelope requirements:

- Use `http://127.0.0.1:{controller_port}` only.
- Use bearer auth with the Aegos-generated `secret`.
- Use `Client::builder().no_proxy()` so Aegos control-plane requests do not loop through user proxy settings.
- Parse non-empty responses as JSON. Empty successful responses are `{}`.
- Surface non-2xx responses as controller errors and classify them before user display.

## 3. API State Matrix

| API | Current use in Aegos | State effect | Timeout class | Allowed wrappers | Required guards |
|---|---|---|---|---|---|
| `GET /version` | core readiness and post-deploy verification | read-only | 300-900 ms | private `CoreController::version_probe` through readiness/deployment methods | Response must normalize into `RuntimeVersionSnapshot` with a non-empty version; arbitrary successful JSON is not readiness evidence; must not block UI. |
| `GET /proxies` | proxy groups snapshot | read-only | about 1200 ms | `CoreController::proxy_groups_snapshot`, `proxy_groups_from_controller`, `ProxyCatalog` | Raw records are normalized into `ProxyGroupSnapshot` and `ProxyNodeSnapshot`; history is reduced to the latest delay; internal/empty groups are filtered; unknown controller fields do not reach product logic. Product defaults, nested-group resolution, selected state, and fixed-node metadata are applied by `ProxyCatalog`. Merge local speed cache only after catalog shaping. |
| `GET /proxies/{name}/delay?timeout=&url=` | single proxy delay probe | measurement-only, should not select node | probe timeout, protocol-aware | `CoreController::proxy_delay_result_with_client`, Aegos speed scheduler | Response fields are normalized into `DelayProbeSnapshot` before classification; malformed envelopes fail closed; encoded proxy name/URL are required; must never call node selection. |
| `PUT /proxies/{group}` | user-initiated group selection | mutates selected proxy | 1500-5000 ms | `change_proxy`, `sync_outbound_ip_group_selection` | Only allowed for explicit user node switch or hidden landing-IP group sync; rollback selected map on failure. |
| `PATCH /configs` with `{ "mode": ... }` | user-initiated mode switch | mutates runtime mode | about 3000 ms | private transport plus `CoreController::apply_mode` | Only allowed for explicit mode change; unsupported modes are rejected; runtime apply must succeed before preference save, and save failure must restore the previous runtime mode. |
| `PATCH /configs?force=true` | hot reload runtime profile | mutates active runtime config | release/profile timeout | `CoreRuntimeApplyTransaction` | Raw controller response is discarded; success requires a typed version probe and produces an Aegos deployment receipt; must follow preflight and atomic runtime config write, with restart/rollback on failure. |
| `GET /traffic` | lightweight traffic snapshot | read-only streaming endpoint | 120 ms status heartbeat | `CoreController::traffic_snapshot` | Read one line only; normalize it into `TrafficSnapshot`; reject non-object envelopes; never carry raw JSON or use a long streaming read on UI heartbeat. |
| `GET /connections` | connections page, active count, recent rule hits | read-only | 350-900 ms | `CoreController::connections_snapshot`, `active_connection_count`, `recent_rule_hits_snapshot` | Raw `metadata`, `destinationIP`, and `chains` are normalized once into `ConnectionSnapshot`; frontend and derived features may only consume Aegos fields. Failures return empty count/list rather than blocking UI. |
| `DELETE /connections/{id}` | close one connection | mutates connection table only | about 2000 ms | `close_connection` | User action only; no config or proxy selection change. |
| `DELETE /connections` | close all connections after switch or user action | mutates connection table only | 1500-3000 ms | `change_proxy`, `close_connections` | Safe after explicit node switch; must not be used as hidden reconnect loop. |
| `GET /rules` | planned read-only routing page | read-only | TBD | future routing wrapper | Read-only first. No rule editing in 3.0. |
| `GET /providers/rules` | planned read-only routing/provider page | read-only | TBD | future routing wrapper | Read-only first. Provider data must not leak remote URLs/tokens. |
| `GET /providers/proxies` | planned subscription/provider health page | read-only | TBD | future provider wrapper | Must distinguish provider health from user node selection. |
| `GET /providers/proxies/{provider}/healthcheck` | planned provider healthcheck | measurement-only at provider level | TBD | future provider health wrapper | Must prove it does not change current user selection before enabling in UI. |
| `GET /group`, `GET /group/{name}` | planned strategy group page | read-only | TBD | future strategy wrapper | Strategy groups must not be rendered as ordinary nodes. |
| `GET /group/{name}/delay` | planned strategy-group delay test | dangerous measurement API | TBD | blocked until wrapper exists | Official semantics can clear fixed selection for automatic strategy groups. Do not use for ordinary Aegos speed test until guarded. |

## 4. Measurement-Only Speed Contract

Current approved path:

- UI calls `start_proxy_delay_test`.
- Backend calls `start_proxy_delay_test_for_run`.
- Backend ensures a controller exists through `ensure_core_for_delay_test`.
- If Aegos is disconnected, standby core may start without traffic takeover.
- Backend collects targets from proxy groups while excluding:
  - `DIRECT`, `REJECT`, `PASS`, `COMPATIBLE`
  - subscription metadata pseudo nodes
  - fake-IP targets
  - proxy-group reference rows such as `HK`, `JP`, `SG`, `TW`, `US`
- Backend probes each proxy through `GET /proxies/{name}/delay`.
- Backend updates speed cache, node health, recommendation, low-latency list, and failure reason.

Forbidden in this path:

- `PUT /proxies/{group}`
- `PATCH /configs`
- `DELETE /connections`
- system proxy enable
- TUN enable
- traffic takeover
- selected proxy map mutation

The only exception is hidden landing-IP group sync, which must remain separate from speed testing and exists only to query the current selected node's outbound IP in smart mode.

## 5. Mutating API Rules

`PUT /proxies/{group}`:

- Allowed only from explicit user node switch, explicit "switch to recommended" style action if reintroduced later, or hidden `Aegos Landing IP` group sync.
- Runtime selection is applied before preference commit. Apply failure leaves preferences unchanged; preference save failure restores the previous runtime node and in-memory selection, and rollback failure is surfaced.
- The UI must not call this from speed-test success.

`PATCH /configs`:

- Allowed for explicit mode changes only.
- Mode values are limited to `rule`, `global`, `direct`.

`PATCH /configs?force=true`:

- Allowed only after profile/runtime config preflight.
- Runtime config must be written atomically into Aegos app data.
- Failure must fall back to restart or rollback profile switch.

`DELETE /connections`:

- Allowed after explicit node switch to clear stale existing flows.
- Allowed from user "close all connections".
- Not allowed as a retry loop for failed speed tests.

## 6. Planned API Adoption Gates

Before Aegos implements provider healthcheck:

- Add a wrapper that records whether the call can change provider/group state.
- Add an audit proving provider healthcheck does not call `change_proxy`.
- Add cancellation/timeout behavior.
- Add UI copy that says provider health is not the current connected node.

Before Aegos implements routing/strategy page:

- Add read-only wrappers for `/rules`, `/providers/rules`, `/group`, and `/group/{name}`.
- Keep editing disabled in the first version.
- Do not mix strategy groups into ordinary node lists.
- Do not expose raw provider tokens in UI or logs.

Before Aegos uses `/group/{name}/delay`:

- Confirm actual mihomo behavior against a test profile with `url-test`, `fallback`, and `load-balance`.
- Prove current node and fixed selection do not change, or block the API for automatic strategy groups.
- Add audit coverage for "group delay did not change selection".
- Prefer `/proxies/{name}/delay` for Aegos ordinary speed tests.

## 7. Existing Audit Coverage

Current guards:

- `npm run audit:core-domain`: raw connection JSON stays at the backend boundary; UI, counts, and rule hits use `ConnectionSnapshot`.
- `npm run audit:speed`: speed tests update delay/health/recommendation only, exclude unsafe targets, remain non-blocking, and align with FlClash-style delay target behavior.
- `npm run audit:security`: controller bind, secret, allow-lan, logs, speed measurement-only, firewall scoped rules.
- `npm run audit:release`: controller, speed, traffic, connections, and release-level behavior.
- `npm run audit:opensource`: requires this contract before future open-source absorption work continues.

Required future guards:

- `core-api-contract.md` must be updated for every new mihomo endpoint.
- New mutating endpoints require rollback tests.
- New read endpoints require timeout and UI non-blocking tests.
- New measurement endpoints require "does not change current node" tests.

## 8. Configuration Ownership Contract

Aegos owns the configuration lifecycle. Mihomo receives only a validated runtime artifact; it does not define how subscriptions, manual nodes, user rules, settings, or rollback state are stored.

Required chain:

`subscription source -> ProfileCatalog -> RuntimeDeploymentPlan -> ConfigDeploymentCandidate -> atomic promotion -> runtime apply and verification -> completion or rollback`

Boundary rules:

- `ProfileCatalog` is the only product model for subscription nodes, groups, and counts. Its public summaries contain names, protocol types, and counts only; they must not expose server addresses, passwords, UUIDs, controller secrets, or subscription tokens.
- `RuntimeDeploymentPlan` binds the preserved subscription source and the generated runtime configuration to separate catalogs, YAML artifacts, and SHA-256 digests. A caller must not parse and compile the same source again during one deployment.
- `config_pipeline` exclusively owns runtime mutation and preflight: port/controller policy, DNS and TUN shaping, airport metadata filtering, manual-node injection, default groups, internal outbound-IP rules, and the direct call into `core_runtime::preflight_runtime_config`. `main.rs` may request a compiled plan but must not rebuild these policies.
- Subscription import and update persist `source_yaml`. Generated runtime fields must never be written back to a subscription source file. This includes Aegos ports, controller bind and secret, DNS policy, TUN policy, hidden groups, and internal rules.
- Manual nodes are stored as `ManualNodeConfig`. UI-only metadata is added only at the product response boundary and is removed from runtime YAML.
- `ConfigDeploymentCandidate` binds the confined active root/path, operation, profile identity, content, and digest before a transaction can be staged.
- Promotion is atomic and confined to Aegos app-data/profile paths. Runtime apply must use the same preflighted plan, verify controller readiness and runtime identity, then complete the transaction. Failure restores the previous source and running state or records an explicit rollback failure.
- Diagnostics and IPv6/DNS checks consume the same compiler path. They may inspect a generated runtime catalog but must not write source or runtime files.
- The removed `patch_profile_source`, `patch_and_preflight`, `preflight_profile_source`, and `RenderedProfile` entry points are forbidden. Reintroducing a parallel config path requires a contract change and a migration that removes the superseded path.

Enforcement:

- `npm run audit:config-domain` guards source/runtime separation, typed models, single-plan routing deployment, diagnostics reuse, path-bound deployment candidates, and absence of legacy entry points.
- Rust tests verify that generated controller/TUN/internal policy stays out of subscription source files and that summaries do not leak credentials or endpoints.

## 9. Sources

- Mihomo API documentation: `https://wiki.metacubex.one/en/api/`
- Mihomo general configuration documentation: `https://wiki.metacubex.one/en/config/general/`
- Aegos local implementation: `src-tauri/src/main.rs`
- Aegos speed closure audit: `tools/speed-closure-audit.js`
- Aegos open-source absorption standard: `research/opensource-absorption-standard.md`
