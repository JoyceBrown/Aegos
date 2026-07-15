# Aegos 3.5.93

## 计划项

- 计划项：3.5.93 规则应用前检查。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：检查目标节点是否存在、策略是否有效、是否和已有规则冲突；坏规则不能写进运行配置。

## 实际完成

- 新增前端 `validateRoutingDraftBeforeApply` / `precheckRoutingDraftsBeforeApply`。
- 应用草稿前检查规则类型、条件、目标、当前订阅中是否存在该目标；目标不存在会直接阻止应用。
- 系统保护规则、已有用户规则冲突、重复草稿标记为不能应用；订阅规则覆盖仍保留为可确认 warning。
- 继续保持“用户规则优先”：正常用户规则可以覆盖订阅兜底，但不能覆盖系统保护规则。
- 应用前检查失败会显示错误状态，不会调用后台 `applyRoutingDrafts`。
- 保留后端 `normalize_routing_draft_rule`、目标校验、配置预检作为第二道门。
- 新增 `audit:stage3-preapply-check`，锁定坏规则不可写入运行配置。

## 偏差

- 本版本不做应用后热重载验证，那是 3.5.94。
- 本版本不重构规则列表管理，那是 3.5.95。

## Verification

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

- Source-only checkpoint: no installer was built for 3.5.93.
- SHA-256: Source-only / not applicable.
