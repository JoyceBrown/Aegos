# Aegos 3.6.35

Automatic first-test and complete node-list repair for Windows x64.

## Fixed

- Aegos starts one managed first speed test after the initial runtime and node snapshots are ready.
- The first test stays in the background, leaves navigation available, and never connects, changes mode, selects a node, or enables system proxy/TUN.
- Temporary startup preparation failures retry for up to 60 seconds; a user-started test suppresses a redundant automatic run.
- Ordinary subscriptions render every matching node. The previous 24-row truncation and misleading `24 / total` state are removed.
- Very large subscriptions retain the complete filtered/sorted collection behind a bounded virtual viewport, so every node remains reachable without creating thousands of DOM rows.
- Configuration-rule details retain their 80-row paging instead of rendering thousands of rows during startup prefetch.
- Mihomo automatic groups remain lazy; startup measurement timing belongs to Aegos.

## Verification

- Interaction smoke requires exactly one startup test after status and node readiness, with no connection or proxy-switch side effects.
- The ordinary-subscription fixture renders all 89 of 89 nodes.
- The pressure fixture keeps 8,000 nodes scroll-reachable with a bounded node DOM and passes navigation, speed-stream, layout-shift, and long-task budgets.
- Rust, backend, security, runtime, responsiveness, installer, and release gates are required before packaging.
- Runtime closure is verified with `npm run audit:runtime-regression`, `npm run audit:installer-regression`, `npm run audit:stability`, and `npm run audit:core-runtime`.

## Limits

- The automatic first test still depends on the active subscription being valid and the local measurement runtime becoming available within the startup retry window.
- Extremely large subscriptions use virtual scrolling, so only the visible viewport exists in the DOM at one time; search, filter, sort, and scrolling still address the complete collection.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.35_x64-setup.exe`
- Size: `16,088,860` bytes
- SHA-256: `F8027159954AF35A45BB475CB544D3468C75328159D11F8D065D826ABA2B68A9`
