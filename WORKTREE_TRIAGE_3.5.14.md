# Worktree Triage 3.5.14

## Keep As Product Work

- `src-tauri/src/core_runtime.rs`, `src-tauri/src/profile_compiler.rs`, `src-tauri/src/config_pipeline.rs`
- `tools/core-runtime-audit.js`, `tools/node-strategy-ui-audit.js`
- `RELEASE_3.4.21.md` through `RELEASE_3.5.13.md`
- Product maturity, routing acceptance, frontend, backend, and audit changes already reflected by release gates.

## Keep But Ignore Binary Backup Noise

- `resources/core/archive/mihomo-v1.19.27-windows-amd64-with-gvisor-77f8dee03001916c2b7c28c3094690bc5f78f0e8c2187f1488073214417dc44d.exe`

Reason:
- `RELEASE_3.5.0.md` records it as the previous managed core backup.
- `tools/core-runtime-audit.js` confirms archive binaries are not bundled by Tauri.
- The archive executable is large and should not keep polluting `git status`, so `.gitignore` now ignores `resources/core/archive/*.exe`.

## Intentional Deletion

- `ROUTING_PRODUCTIZATION_RECOVERY_PLAN.md`

Reason:
- It was replaced by `ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md`.
- `tools/routing-product-audit.js` explicitly requires the old plan to stay deleted and the maturity documents to reference the new standard.

## Do Not Clean Automatically

- Existing modified source/audit/UI files are historical development work, not disposable temporary files.
- No tracked file should be reverted or deleted without a targeted follow-up review.
