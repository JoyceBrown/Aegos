# Aegos 3.5.86

## 计划项

- 计划项：3.5.86 连续操作压力测试。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。

## 实际完成

- 新增 `audit:phase2-pressure`，把阶段 2 的连续操作验收绑定到当前主线。
- 复用真实 Chrome smoke：快速切页、测速中切页、诊断中切页、切订阅预览、后台任务中心。
- 本版本不新增阶段 3 功能，职责只收尾阶段 2。

## 偏差

- 无计划外功能替代。本版本只做阶段 2 压力验收。

## Verification

- Passed: `npm run audit:phase2-pressure`
- Passed: `npm run audit:current-mainline`
- Passed: `npm run smoke:interactions`
- Passed: `npm run smoke:perf`
- Passed: `npm run audit:stability`
- Passed: `npm run audit:release`
- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.86.
- SHA-256: Source-only / not applicable.
