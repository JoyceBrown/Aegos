# Aegos 3.6.0

Stage 3 acceptance checkpoint with installer.

## Mainline

- Current mainline: 3.5.71 - 3.6.40 user-product mainline.
- Stage 3: make the rules page usable by ordinary users.
- Small-version target: 规则页验收安装包.

## 计划项

- 3.6.0: 规则页验收安装包.
- 当前主线: 3.5.71 - 3.6.40 user-product mainline.
- Acceptance: ordinary users can create, verify, modify, delete, and test a website/app routing rule.

## Completed

- Preserved website rules, app rules, strategy selector, conflict explanation, preview, pre-apply check, post-apply verification, list management, system-rule explanation, node/rule linkage, rule test, and UX polish gates.
- 3.5.99 historical gate: UX polish gates were preserved and rechecked with `npm run audit:stage3-ux-polish`.
- Added a 3.6.0 acceptance audit to require a real installer and installer hash.
- Installer generated for user testing.

## Stage 3 Gate Index

- 3.5.87: 规则页重新定义, verified by `npm run audit:stage3-rules-page`.
- 3.5.88: 网站规则向导, verified by `npm run audit:stage3-website-rules`.
- 3.5.89: 应用规则向导, verified by `npm run audit:stage3-app-rules`.
- 3.5.90: 策略选择器, verified by `npm run audit:stage3-strategy-selector`.
- 3.5.91: 规则冲突解释, 用户规则优先, verified by `npm run audit:stage3-conflict-explanation`.
- 3.5.92: 规则预览, 用户规则优先, verified by `npm run audit:stage3-rule-preview`.
- 3.5.93: 规则应用前检查, 目标不存在 is blocked before apply, verified by `npm run audit:stage3-preapply-check`.
- 3.5.94: 规则应用后验证, 目标不存在 and 部署验证 failures are surfaced, verified by `npm run audit:stage3-postapply-verify`.
- 3.5.95: 规则列表可管理, verified by `npm run audit:stage3-rule-list-management`.
- 3.5.96: 系统规则解释, verified by `npm run audit:stage3-system-rules`.
- 3.5.97: 节点页和规则页联动, verified by `npm run audit:stage3-node-rule-link`.
- 3.5.98: 规则测试按钮, verified by `npm run audit:stage3-rule-test`.
- 3.5.99: UX polish gates, verified by `npm run audit:stage3-ux-polish`.

## Verification

- Passed: `npm run audit:stage3-acceptance`
- Passed: `npm run audit:stage3-ux-polish`
- Passed: `npm run audit:stage3-rule-test`
- Passed: `npm run audit:stage3-node-rule-link`
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
- Passed: `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.0_x64-setup.exe`
- SHA-256: `c84f575e2cae3d3533ae20c6498d2e47990df9df8063cc59ac99f60f9a143ddc`

## Remaining Risk

- Stage 4 begins at 3.6.1 and must turn all configuration deployment into an explicit safe transaction.
