# Aegos 3.5.94

## 计划项

- 计划项：3.5.94 规则应用后验证。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：规则编译成配置后预检、热重载、验证；失败自动回滚。目标不存在仍必须在应用前拦截。

## 实际完成

- 后端 `apply_routing_drafts` 在热重载后继续验证控制器运行时是否就绪。
- 如果热重载后验证失败，会恢复旧配置并尝试热重载回旧运行时。
- 应用成功返回 `deploymentValidation`，包含预检、热重载、控制器就绪、回滚可用和验证时间。
- 规则页应用状态显示“部署验证：已通过/未通过/未验证”。
- 继续保持 3.5.92/3.5.93 行为：用户规则优先、预览只生成未生效草稿、目标不存在会在应用前拦截。
- 保留 3.5.93 的目标不存在、坏规则不可写入检查。
- 新增 `audit:stage3-postapply-verify`，锁定应用后验证和回滚行为。

## 偏差

- 本版本不做规则列表完整管理，那是 3.5.95。
- 本版本不扩展系统规则解释，那是 3.5.96。

## Verification

- Passed: `npm run audit:stage3-postapply-verify`
- Passed: `npm run audit:stage3-preapply-check`
- Passed: `npm run audit:stage3-rule-preview`
- Passed: `npm run audit:stage3-conflict-explanation`
- Passed: `npm run audit:stage3-strategy-selector`
- Passed: `npm run audit:stage3-app-rules`
- Passed: `npm run audit:stage3-website-rules`
- Passed: `npm run audit:stage3-rules-page`
- Passed: `npm run audit:current-mainline`
- Passed: `npm run audit:release`
- Passed: `npm run smoke:interactions`
- Passed: `npm run smoke:perf`
- Passed: `node --check src/app.js`
- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.94.
- SHA-256: Source-only / not applicable.
