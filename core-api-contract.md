# Aegos Mihomo API Contract

Version: 2.9.53
Updated: 2026-07-12

Purpose: this document fixes the boundary between Aegos and mihomo. It defines which controller APIs Aegos may call, whether each call may change runtime state, how it must be wrapped, and which checks must guard future changes.

This is a contract, not a feature wish list. If code needs a mihomo API that is not listed here, update this document and the related audit before implementing the call.

## 1. Non-Negotiable Rules

- Delay tests are measurement-only in Aegos. They may update delay, health, recommendation, confidence, and failure reason. They must not switch the current node, change mode, enable system proxy, enable TUN, or take over traffic.
- All controller calls must go through backend wrappers such as `controller_request` or `CoreManager::controller`. The frontend must not call mihomo controller URLs directly.
- The controller must stay bound to `127.0.0.1` with a generated secret. `allow-lan` remains opt-in and must not be enabled by feature work.
- Every call must have a timeout. UI-visible actions must remain cancellable or detached when they can be slow.
- Errors must be classified before reaching the UI when the user needs a reason: timeout, DNS, TLS, auth, unsupported protocol, controller unavailable, node not found, config, protection blocked, network, unknown.
- Logs, diagnostics, and export reports must not expose controller secret, subscription tokens, node passwords, UUIDs, bearer tokens, or raw subscription URLs.
- Calls that mutate runtime state must be treated as transactions: preflight, apply, verify when possible, rollback or explicit failure state.

## 2. Current Aegos Controller Envelope

Implementation:

- `controller_request(controller_port, secret, method, endpoint, body, timeout_ms)`
- `CoreManager::controller(method, endpoint, body, timeout_ms)`
- `CoreManager::traffic_snapshot(timeout_ms)` for the streaming `/traffic` endpoint.

Envelope requirements:

- Use `http://127.0.0.1:{controller_port}` only.
- Use bearer auth with the Aegos-generated `secret`.
- Use `Client::builder().no_proxy()` so Aegos control-plane requests do not loop through user proxy settings.
- Parse non-empty responses as JSON. Empty successful responses are `{}`.
- Surface non-2xx responses as controller errors and classify them before user display.

## 3. API State Matrix

| API | Current use in Aegos | State effect | Timeout class | Allowed wrappers | Required guards |
|---|---|---|---|---|---|
| `GET /version` | core readiness check | read-only | 300-900 ms | `wait_for_controller`, `ensure_core_for_delay_test` | Must not block UI; failure means controller not ready. |
| `GET /proxies` | proxy groups snapshot | read-only | about 1200 ms | `controller_proxy_groups_snapshot`, `assemble_proxy_groups_snapshot` | Hide strategy-group references from ordinary node lists; merge local speed cache only after snapshot. |
| `GET /proxies/{name}/delay?timeout=&url=` | single proxy delay probe | measurement-only, should not select node | probe timeout, protocol-aware | `test_proxy_delay_request`, `test_proxy_delay_fast`, `test_proxy_delay_with_retry` | Must use encoded proxy name and URL; must not call `change_proxy`; must classify failed probes. |
| `PUT /proxies/{group}` | user-initiated group selection | mutates selected proxy | 1500-5000 ms | `change_proxy`, `sync_outbound_ip_group_selection` | Only allowed for explicit user node switch or hidden landing-IP group sync; rollback selected map on failure. |
| `PATCH /configs` with `{ "mode": ... }` | user-initiated mode switch | mutates runtime mode | about 3000 ms | `set_mode` | Only allowed for explicit mode change; unsupported modes rejected before call. |
| `PATCH /configs?force=true` | hot reload runtime profile | mutates active runtime config | release/profile timeout | `hot_reload_profile` | Must follow preflight and atomic runtime config write; fallback restart if hot reload fails. |
| `GET /traffic` | lightweight traffic snapshot | read-only streaming endpoint | 120 ms status heartbeat | `traffic_snapshot` | Read one line only; never use long streaming read on UI heartbeat. |
| `GET /connections` | connections page and active count | read-only | 350-900 ms | `connections`, `active_connection_count` | Active count must stay lightweight; failures return empty count/list rather than blocking UI. |
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
- A failed call must restore `selected_proxy_map` and save settings.
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

- `npm run audit:speed`: speed tests update delay/health/recommendation only, exclude unsafe targets, remain non-blocking, and align with FlClash-style delay target behavior.
- `npm run audit:security`: controller bind, secret, allow-lan, logs, speed measurement-only, firewall scoped rules.
- `npm run audit:release`: controller, speed, traffic, connections, and release-level behavior.
- `npm run audit:opensource`: requires this contract before future open-source absorption work continues.

Required future guards:

- `core-api-contract.md` must be updated for every new mihomo endpoint.
- New mutating endpoints require rollback tests.
- New read endpoints require timeout and UI non-blocking tests.
- New measurement endpoints require "does not change current node" tests.

## 8. Sources

- Mihomo API documentation: `https://wiki.metacubex.one/en/api/`
- Mihomo general configuration documentation: `https://wiki.metacubex.one/en/config/general/`
- Aegos local implementation: `src-tauri/src/main.rs`
- Aegos speed closure audit: `tools/speed-closure-audit.js`
- Aegos open-source absorption standard: `research/opensource-absorption-standard.md`
