# Aegos Provider Healthcheck Contract

Version: 2.9.56
Updated: 2026-07-12

Purpose: define how Aegos may adopt mihomo provider healthcheck without confusing it with user node switching or ordinary speed testing.

## 1. Product Meaning

Provider healthcheck means "subscription/provider health", not "connect to this node".

It may answer:

- Is the provider available?
- How many provider nodes can be tested by mihomo?
- Which provider nodes are failing and why?
- Is a subscription likely stale or broken?

It must not imply:

- The current connected node changed.
- Aegos selected the best node.
- A recommendation became the active node.
- A user profile switch happened.

## 2. API Boundary

Planned API:

- `GET /providers/proxies`
- `GET /providers/proxies/{provider}/healthcheck`

Current status:

- Exposed as an explicit profile-level background job.
- Called only through Aegos' typed controller boundary.
- Not allowed inside ordinary one-click speed test.
- Not allowed inside single-node speed test.

Before enabling:

- Add a backend wrapper such as `provider_healthcheck`.
- Run through the same controller envelope as other mihomo APIs.
- Add timeout and cancellation.
- Add logs that say provider healthcheck, not speed test.
- Add result fields separate from node delay cache.
- Add audit proving current node and `selected_proxy_map` do not change.

## 3. Data Separation

Provider healthcheck result must not write into:

- `selected_proxy_map`
- current node
- current mode
- system proxy state
- TUN state
- traffic takeover state

Provider healthcheck may write into a future provider health cache:

```text
providerHealth[providerName] = {
  running,
  checkedAt,
  ok,
  failed,
  lastError,
  nodes: [...]
}
```

This cache must stay separate from `speed.delays` unless a later version explicitly defines a merge rule.

## 4. UI Rules

Allowed labels:

- 订阅健康
- Provider 健康
- 机场健康

Forbidden labels:

- 当前节点
- 已连接
- 推荐已生效
- 自动切换

If shown in UI, provider healthcheck must clearly say:

```text
这是订阅健康检测，不会切换当前节点。
```

## 5. Safety Proof Required Before Implementation

To enable provider healthcheck, Aegos must pass a fixture or live-local test:

1. Start from a known current group and node.
2. Record `selected_proxy_map`.
3. Run provider healthcheck.
4. Read current proxy group selection again.
5. Assert selected node and selected map did not change.
6. Assert no `change_proxy` path ran.
7. Assert no system proxy, TUN, or traffic takeover changed.

## 6. Current implementation decision

The healthcheck is explicit, background-only, and verifies after completion that selected nodes, Windows proxy intent, TUN intent, and traffic takeover have not changed. A failed integrity check discards the result.

## 7. Acceptance

- `audit:provider-healthcheck` passes.
- `audit:speed` still proves ordinary speed tests do not call provider healthcheck.
- `audit:release` knows the provider healthcheck gate.
- No UI entry point calls provider healthcheck yet.
