# Aegos Speed Target And Failure Reason Contract

Version: 2.9.55
Updated: 2026-07-12

Purpose: keep batch speed tests, single-node speed tests, current-node refresh, and benchmark reports aligned on the same delay target family and the same failure reason vocabulary.

## 1. Target URL Contract

Primary batch target:

- `https://www.gstatic.com/generate_204`

Expected behavior:

- The target is expected to behave like a 204/no-content connectivity endpoint.
- Aegos does not parse the body directly. Aegos calls mihomo `/proxies/{name}/delay?timeout=&url=` and lets mihomo perform the delay probe.
- Aegos records the returned `delay` when mihomo returns success.
- If mihomo returns a controller error, network error, timeout, or non-delay result, Aegos records a structured failure reason.

Full single-node diagnostic target family:

- `http://www.gstatic.com/generate_204`
- `https://www.gstatic.com/generate_204`
- `http://cp.cloudflare.com/generate_204`
- `https://cp.cloudflare.com/generate_204` for protocols that need a deeper HTTPS fallback path.

Why this split exists:

- Batch speed tests should return quickly, so they use the single FlClash-style primary URL.
- Single-node tests can probe deeper because the user explicitly requested detail for one node.
- Current-node latency refresh uses the single-node path and must still not switch nodes.

## 2. Failure Reason Contract

Backend reason keys:

| Key | User-facing meaning |
|---|---|
| `dns-fake-ip` | DNS 污染 |
| `protection-blocked` | 保护拦截 |
| `node-not-found` | 节点缺失 |
| `node-connect` | 节点不通 |
| `controller-delay-error` | 核心测速失败 |
| `probe-failed` | 探测失败 |
| `timeout` | 超时 |
| `dns` | DNS 失败 |
| `tls` | TLS 失败 |
| `auth` | 认证失败 |
| `controller-unavailable` | 核心未响应 |
| `unsupported-protocol` | 协议不支持 |
| `config` | 配置错误 |
| `network` | 连接失败 |
| `unknown` | 测速失败 |

Rules:

- A tested failed node must show a reason. It must not silently return to "untested".
- `lastFailureReason` is the frontend canonical camelCase field.
- `last_failure_reason` is accepted as a backend/snake_case compatibility field.
- UI labels are generated through `speedFailureReasonLabel`.
- Node status display is generated through `nodeSpeedNoteInfo`.

## 3. Entry Point Alignment

| Entry point | Path | Target behavior | Result display |
|---|---|---|---|
| Home one-click speed test | `start_proxy_delay_test` | Fast primary URL | Home and node page both update |
| Node page batch speed test | `start_proxy_delay_test` | Fast primary URL | Home and node page both update |
| Single node speed test | `test_single_proxy_delay` | Full probe family | Row status updates reason or delay |
| Current node refresh | `test_single_proxy_delay` | Full probe family | Current node metric updates only |

All four entry points must remain measurement-only.

## 4. Acceptance

- `audit:speed` must pass.
- `audit:speed-target` must pass.
- Batch target remains `https://www.gstatic.com/generate_204`.
- Full diagnostic target includes gstatic and Cloudflare generate_204 endpoints.
- Backend classifier and UI label map cover timeout, DNS, TLS, auth, protection, unsupported protocol, controller, config, network, and unknown failures.
- Tested failed nodes show a visible reason.
