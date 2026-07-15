# Aegos 3.5.99

Source-only checkpoint. No installer is produced at this version.

## Mainline

- Current mainline: 3.5.71 - 3.6.40 user-product mainline.
- Stage 3: make the rules page usable by ordinary users.
- Small-version target: 规则 UX 打磨.

## 计划项

- 3.5.99: 规则 UX 打磨.
- 当前主线: 3.5.71 - 3.6.40 user-product mainline.
- Acceptance: empty states, error states, loading feedback, hover/focus, and button copy are understandable without a manual.

## Completed

- Rule test button copy changed to "测试当前规则".
- Added example buttons for `youtube.com`, `openai.com`, and `telegram.org`.
- Rule test now explains the unloaded snapshot state instead of pretending there is no match.
- Added local `is-pending` / `aria-busy` feedback for rule testing without starting a backend task.
- Added stable hover/focus styling for the rule test card and compact example buttons.

## Continuous Gates

- 3.5.91 规则冲突解释：用户规则优先；系统保护规则不可覆盖时必须说明原因。
- 3.5.92 规则预览：用户规则优先；预览不写配置、不切节点。
- 3.5.93 规则应用前检查：目标不存在、空对象、空目标、阻断冲突不能写入运行配置。
- 3.5.94 规则应用后验证：热重载后继续做部署验证；目标不存在或 controller 不可用必须回滚。
- 3.5.95 规则列表可管理：启用、停用、编辑、删除、排序都走真实配置动作。
- 3.5.96 系统规则解释：系统规则只读，并解释落地 IP 查询、Aegos 自身服务、防泄漏保护。
- 3.5.97 节点页和规则页联动：从节点页指定网站走某个节点，仍使用 `applyRoutingRuleEdit`.
- 3.5.98 规则测试按钮：测试只读，不写配置、不热重载、不切节点。

## Verification

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

## Artifact

- Source-only checkpoint: no installer was built for 3.5.99.
- SHA-256: Source-only / not applicable.

## Remaining Risk

- 3.6.0 must produce the Stage 3 acceptance installer and verify the normal user path end to end.
