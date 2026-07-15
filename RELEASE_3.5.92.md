# Aegos 3.5.92

## 计划项

- 计划项：3.5.92 规则预览。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：添加规则前显示清楚的用户结果，例如“youtube.com 将走 自动最快：日本”，并继续说明用户规则优先。

## 实际完成

- 网站规则和应用规则共用 `renderRoutingDraftPreview`，预览结构统一。
- 预览框优先显示最终结果，再显示未生效状态、冲突/优先级提示、内部规则。
- 保持预览只生成未生效草稿，不写配置、不热重载、不切节点。
- 新增多行预览样式，避免把结果、状态、内部规则挤在一行。
- 新增 `audit:stage3-rule-preview`，锁定规则预览行为。

## 偏差

- 本版本不做规则应用前完整强校验，那是 3.5.93。
- 本版本不做应用后热重载验证，那是 3.5.94。

## Verification

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

- Source-only checkpoint: no installer was built for 3.5.92.
- SHA-256: Source-only / not applicable.
