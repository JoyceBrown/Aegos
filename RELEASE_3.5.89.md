# Aegos 3.5.89

## 计划项

- 计划项：3.5.89 应用规则向导。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：用户选择 Telegram/Chrome/Steam 等应用后，指定走某条线路、直连或阻止，不要求用户知道 `PROCESS-NAME`。

## 实际完成

- 应用入口改成“应用规则向导”。
- 支持输入应用名或 `.exe` 路径，输入 `Telegram` 会自动补成 `Telegram.exe`。
- 应用走向改成人话选项：选择线路或节点、直连、不访问。
- 预览文案改成“某应用将走某线路”，底层规则只作为草稿详情记录。
- 生成草稿仍然不直接生效，必须由用户验证并确认应用。
- 新增 `audit:stage3-app-rules`，锁定应用规则向导的用户可理解性。

## 偏差

- 本版本不做策略选择器统一抽象，那是 3.5.90。
- 本版本不做规则冲突解释深化，那是 3.5.91。

## Verification

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

- Source-only checkpoint: no installer was built for 3.5.89.
- SHA-256: Source-only / not applicable.
