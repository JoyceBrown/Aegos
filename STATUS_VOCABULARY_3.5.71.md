# Aegos 3.5.71 Status Vocabulary

This checkpoint defines the user-facing status words that Aegos must keep stable.

## Runtime State

- 未运行: core process is not running.
- 核心待命: core is running, but Aegos has not taken over system traffic.
- 已接管: Aegos has taken over traffic through TUN, system proxy, or a runtime-controlled path.
- 未接管: no system traffic takeover is active.

## Traffic And Proxy State

- 已开启: the feature is enabled and effective.
- 未开启: the feature is disabled.
- 待生效: the user preference is enabled, but the effective runtime state has not applied it yet.
- 待连接: system proxy preference is enabled, but Aegos must connect before Windows proxy is applied.

## Permission And Safety State

- 管理员: Aegos is running with administrator permission.
- 普通权限: Aegos is running without administrator permission.
- 已保存原状态: Aegos has a system proxy snapshot that can be restored.

## Environment And Diagnostics State

- 未检查: no environment check has run yet.
- 正常: the check passed.
- 警告: the check can still work, but the user should review the hint.
- 错误: the check failed and needs action.

## Product Rules

- The same concept must use the same word on home, settings, diagnostics, and notices.
- A status word must describe the effective state, not only the desired setting.
- If a state is only a preference, the UI must say 待生效 or 待连接 instead of 已开启.
- User-visible strings in `src/index.html` and `src/app.js` must not contain mojibake or abnormal Unicode fragments.
- New status text should be routed through `STATUS_TEXT`, `enabledLabel`, `systemProxyUiLabel`, or `runtimeSummaryLabel` unless it is a one-off explanatory sentence.
