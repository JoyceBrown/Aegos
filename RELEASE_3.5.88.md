# Aegos 3.5.88

## 计划项

- 计划项：3.5.88 网站规则向导。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：用户输入 `youtube.com` 或完整网址后，选择“走线路/节点、直连、阻止”，不要求用户写 `DOMAIN-SUFFIX`。

## 实际完成

- 网站规则入口改成“网站规则向导”。
- 支持粘贴完整网址，Aegos 自动提取域名。
- 网站走向改成人话选项：选择线路或节点、直连、不访问。
- 预览文案改成“某网站将走某线路”，底层规则只作为草稿详情记录。
- 生成草稿仍然不直接生效，必须由用户验证并确认应用。
- 新增 `audit:stage3-website-rules`，锁定网站规则向导的用户可理解性。

## 偏差

- 本版本不做应用规则向导深化，那是 3.5.89。
- 本版本不做完整策略选择器抽象，那是 3.5.90。

## Verification

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

- Source-only checkpoint: no installer was built for 3.5.88.
- SHA-256: Source-only / not applicable.
