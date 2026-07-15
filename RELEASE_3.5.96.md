# Aegos 3.5.96

Source-only checkpoint. No installer is produced at this version.

## 主线位置

- 当前主线：3.5.71 - 3.6.40 用户产品主线。
- 阶段 3：把规则页做成普通用户会用的功能。
- 小版本目标：系统规则解释。

## 计划项

- 3.5.96：系统规则解释。
- 系统规则只读，说明用途，例如落地 IP 查询、Aegos 自身服务、防泄漏保护。
- 验收标准：用户知道这些规则不是乱来的，也知道为什么不能编辑。

## 完成内容

- 系统规则固定解释为三类：落地 IP 查询、Aegos 自身服务、防泄漏保护。
- 后端系统规则快照增加 `systemRuleKind`、`explanation`、`userImpact`、`lockedReason`。
- 落地 IP 查询规则明确说明：不切换节点、不改变模式、不改变智能分流规则。
- 系统规则明细继续只读，不提供编辑、删除入口。
- 系统规则说明强调：用户规则优先；系统保护规则不可覆盖时必须说明原因。

## 验收记录

- 持续保留 3.5.95 规则列表可管理门禁：启用、停用、编辑、删除、排序都是真实配置动作。
- 持续保留 3.5.94 规则应用后验证门禁：部署验证失败自动回滚。
- 持续保留 3.5.93 规则应用前检查门禁：目标不存在和阻断冲突不能写入运行配置。
- 持续保留 3.5.92 规则预览门禁：用户规则优先，预览不写配置、不切节点。
- 持续保留 3.5.91 规则冲突解释门禁：用户规则优先，系统保护规则不可覆盖时必须说明原因。

## Verification

- Passed: `npm run audit:stage3-system-rules`
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

- Source-only checkpoint: no installer was built for 3.5.96.
- SHA-256: Source-only / not applicable.

## 剩余风险

- 本版本不新增安装包。
- 节点页联动和规则测试按钮继续放到 3.5.97 - 3.5.98。
