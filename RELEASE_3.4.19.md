# Aegos 3.4.19

## Scope

3.4.19 closes the whole-app interaction and performance lane:

- Settings-page IPv6/DNS checks now have a busy guard.
- Settings-page install/security readiness checks now have a busy guard.
- Rapid navigation cannot pile up duplicated settings probes.
- A new global interaction product audit keeps navigation, background jobs, bounded lists, and non-disabling pending UI in one gate.

## User Value

用户快速切换首页、节点、连接、订阅、分流、诊断、日志、设置时，后台检测不会堆积成卡顿源。按钮 pending 仍是视觉反馈，不会把软件变成“点不了”。

## Safety

- No proxy, routing, firewall, or system-proxy behavior was changed.
- The changes are read-only UI scheduling guards and audit gates.

## Verification

- `npm run check`
- `npm run audit:global-interaction-product`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:release`

## Artifact

Source-only checkpoint. No installer is produced for 3.4.19.

SHA-256: source-only
