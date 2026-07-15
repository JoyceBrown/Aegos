# Aegos 3.5.91

## 计划项

- 计划项：3.5.91 规则冲突解释。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：文案采用“用户规则优先”；系统保护规则不可覆盖时必须说明原因。

## 实际完成

- 规则草稿的冲突解释区分三类：用户规则冲突、订阅规则被用户规则覆盖、系统保护规则不可覆盖。
- 系统保护规则说明用途：落地 IP 查询、Aegos 自身服务、防泄漏保护。
- 节点页“目标网站”入口同步同一套冲突逻辑，避免规则页和节点页说法不一致。
- 清理当前主线 UI 中旧的“场景规则”优先级表达，改为“用户规则优先；越具体的网站/应用规则越先判断”。
- 新增 `audit:stage3-conflict-explanation`，锁定冲突解释和系统保护说明。

## 偏差

- 本版本不做规则提交前的完整预览，那是 3.5.92。
- 本版本不做坏规则写入前的强校验，那是 3.5.93。

## Verification

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

- Source-only checkpoint: no installer was built for 3.5.91.
- SHA-256: Source-only / not applicable.
