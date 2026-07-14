# Aegos 3.5.14

Source-only checkpoint.

## Configuration Pipeline Closure

- Moved runtime DNS hardening and DNS safety reporting behind `config_pipeline`.
- Kept runtime YAML normalization, physical adapter `interface-name` binding, and atomic runtime-profile writes behind `core_runtime`.
- Restored readable config preflight diagnostics for malformed YAML, missing proxies, missing group targets, and port/controller mismatches.

## Safety And Diagnostics

- Added a clear disable-failure prefix for disconnect protection rollback errors.
- Restored the IPv6/DNS safety card copy and kept the user-facing IPv6 mode as automatic.
- Added the `audit:ipv6-dns` alias for the IPv6/DNS safety gate.

## Worktree Triage

- Kept historical release/source/audit/UI work as product work.
- Ignored archived mihomo backup executables under `resources/core/archive/*.exe`.
- Recorded the worktree decision in `WORKTREE_TRIAGE_3.5.14.md`.

## Verification

- `npm run check`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:core-runtime`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run audit:stability`
- `npm run audit:ipv6-dns`
- `npm run smoke:interactions`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
