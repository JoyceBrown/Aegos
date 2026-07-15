# Aegos 3.5.87

## 计划项

- 计划项：3.5.87 规则页重新定义。
- 当前主线：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 璁″垝椤?：3.5.87 规则页重新定义。
- 褰撳墠涓荤嚎：`CURRENT_MAINLINE_3.5.71_TO_3.6.40.md`。
- 目标：页面改成三个普通用户能理解的入口：网站规则、应用规则、系统规则。

## 实际完成

- 规则页主入口改为“网站规则 / 应用规则 / 系统规则”。
- “场景”不再作为规则页主入口，避免用户先被策略组、场景、YAML 概念绕晕。
- 系统规则改成只读解释区，说明落地 IP 查询、Aegos 自身服务、防泄漏保护的用途。
- 底层配置规则明细继续收在高级区域，不作为普通用户第一操作入口。
- 新增 `audit:stage3-rules-page`，专门锁定 3.5.87 的规则页重新定义要求。

## 偏差

- 本版本不做 3.5.88/3.5.89 的完整网站/应用向导深化，也不打安装包。
- 旧的场景草稿函数暂时保留为历史兼容逻辑，但已从主入口移除，后续按规则优先级和冲突解释统一收口。

## Verification

- Passed: `npm run audit:stage3-rules-page`
- Passed: `npm run audit:current-mainline`
- Passed: `npm run audit:routing-ux`
- Passed: `npm run audit:routing-product`
- Passed: `npm run audit:stability`
- Passed: `npm run audit:release`
- Passed: `npm run smoke:interactions`
- Passed: `npm run smoke:perf`
- Passed: `node --check src/app.js`
- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.87.
- SHA-256: Source-only / not applicable.
