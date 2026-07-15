# Aegos 3.5.95

Source-only checkpoint. No installer is produced at this version.

## 主线位置

- 阶段 3：把规则页做成普通用户会用的功能。
- 小版本目标：规则列表可管理。
- 当前主线：3.5.71 - 3.6.40 用户产品主线。

## 计划项

- 3.5.95：规则列表可管理。
- 必须支持启用、禁用、编辑、删除、排序。
- 验收标准：操作直接、不卡顿、不丢规则，且真实影响运行配置。

## 完成内容

- 用户规则列表支持启用、停用、编辑、删除、上移、下移。
- 启用、停用和排序都会通过后端修改真实运行配置，不做前端假状态。
- 停用规则会从运行配置移除，但保留在 Aegos 用户规则登记里，后续可重新启用。
- 用户规则登记从旧数组兼容升级为 `active / disabled` 双列表。
- 规则页快照会显示停用规则，并标记“已停用”，避免用户误以为仍在生效。
- 所有规则管理操作都走后台任务，不阻塞导航、日志查看和其他只读操作。

## 验收记录

- 持续保留 3.5.92 规则预览门禁：用户规则优先，草稿预览只展示结果，不写配置、不切节点。
- 持续保留 3.5.93 规则应用前检查门禁：目标不存在、空目标、错误类型、阻断冲突都不能写入运行配置。
- 持续保留 3.5.94 规则应用后验证门禁：部署验证必须检查 controller readiness，失败自动回滚。
- `npm run audit:stage3-rule-list-management`
- `npm run audit:stage3-postapply-verify`
- `npm run audit:stage3-preapply-check`
- `npm run audit:stage3-rule-preview`
- `npm run audit:stage3-conflict-explanation`
- `npm run audit:stage3-strategy-selector`
- `npm run audit:stage3-app-rules`
- `npm run audit:stage3-website-rules`
- `npm run audit:stage3-rules-page`
- `npm run audit:current-mainline`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `node --check src/app.js`
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

## 剩余风险

- 本版本不新增安装包。
- 规则测试按钮、节点页联动、系统规则解释的完整产品化继续放到 3.5.96 - 3.5.99。

## Verification

- Passed: `npm run audit:stage3-rule-list-management`
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

- Source-only checkpoint: no installer was built for 3.5.95.
- SHA-256: Source-only / not applicable.
