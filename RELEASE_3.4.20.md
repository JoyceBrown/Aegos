# Aegos 3.4.20

## Scope

3.4.20 is the whole-product maturity candidate for the 3.4.11 to 3.4.20 recovery lane.

- Package, Tauri, Cargo, and in-app version labels are aligned to 3.4.20.
- The candidate must pass product, security, stability, responsiveness, routing, diagnostics, settings, subscription, and installer gates before delivery.
- The installer is produced only after the full gate set passes.

## User Value

用户可以拿这一版安装包完整测试 Aegos 的核心代理客户端能力：导入和切换订阅、连接和断开、测速不误连接、节点选择、落地 IP、诊断、日志导出、设置检查、分流基础流程。

## Safety

- No new proxy switching behavior is introduced in this candidate note.
- Speed tests remain measurement-only and must not connect or switch nodes.
- Diagnostics, settings checks, and speed tests must not lock navigation or make other pages unusable.
- Logs and exported diagnostics must keep sensitive subscription, token, UUID, password, local path, and IP details redacted according to the existing audit gates.

## Verification

Passed:

- `npm run check`
- all non-installer `audit:*` gates except the post-build `audit:installer` / `audit:release` pair, 51 gates total
- `npm run audit:product-maturity`
- `npm run audit:connection-closure`
- `npm run audit:node-speed-product`
- `npm run audit:subscription-product`
- `npm run audit:home-product`
- `npm run audit:routing-product`
- `npm run audit:diagnostics-product`
- `npm run audit:settings-security-product`
- `npm run audit:global-interaction-product`
- `npm run audit:security`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run audit:installer-regression`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `git diff --check`
- `npm run build`
- `npm run audit:installer`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.4.20_x64-setup.exe`
- Size: 15,502,359 bytes

SHA-256: 2E7AE19EBAF93067D90C0922CA84DED95F1D10FD5CF4E35D46E29F98206104C0
