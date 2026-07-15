# Aegos 3.5.90

## 计划项

- 计划项：3.5.90 策略选择器。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：用户看到的是自动最快、手动选择、固定节点、直连、阻止，不把 `url-test/fallback/select` 当作主要概念。

## 实际完成

- 规则向导的线路选择显示为用户语言：自动最快、自动备用、自动均衡、手动选择、固定节点、收藏节点、节点、直连、阻止。
- 网站和应用规则预览使用同一套显示标签，不再直接把底层目标名当成用户说明。
- 底层 Mihomo 组类型仍保留用于生成配置和诊断，但不作为普通用户第一层概念。
- 新增 `audit:stage3-strategy-selector`，锁定策略选择器的用户语言映射。

## 偏差

- 本版本不做规则冲突解释，那是 3.5.91。
- 本版本不改变底层策略组结构，只调整用户选择和预览表达。

## Verification

- Passed: `npm run audit:stage3-strategy-selector`
- Passed: `npm run audit:stage3-app-rules`
- Passed: `npm run audit:stage3-website-rules`
- Passed: `npm run audit:stage3-rules-page`
- Passed: `npm run audit:current-mainline`
- Passed: `npm run audit:routing-ux`
- Passed: `npm run audit:routing-product`
- Passed: `npm run audit:release`
- Passed: `npm run smoke:interactions`
- Passed: `npm run smoke:perf`
- Passed: `node --check src/app.js`
- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.90.
- SHA-256: Source-only / not applicable.
