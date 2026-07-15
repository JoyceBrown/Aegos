# Aegos 3.5.85

## 计划项

- 计划项：3.5.85 落地 IP 查询防卡死。
- 同步确立当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 补阶段 1/2 对齐审查：`PHASE_1_2_ALIGNMENT_3.5.85.md`。

## 实际完成

- 旧落地 IP 查询在节点变化后只允许过期失败，不再返回旧缓存污染当前节点。
- 后台任务默认不再占用全局 `backgroundJobBusy`，避免后台任务长轮询导致页面刷新和数据同步延迟。
- 旧路线、旧门禁、旧架构消化计划降级为后续工程债，不能替代当前主线。

## 偏差

- 3.5.79 - 3.5.84 的历史 release 名称和当前主线任务不完全一致，已在对齐审查中明确记录。
- 本版本不进入阶段 3，阶段 3 必须在 3.5.86 连续操作压力测试后开始。

## Verification

- Passed: `npm run audit:current-mainline`
- Passed: `npm run audit:backend`
- Passed: `npm run audit:stability`
- Passed: `npm run audit:release`
- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.85.
- SHA-256: Source-only / not applicable.
