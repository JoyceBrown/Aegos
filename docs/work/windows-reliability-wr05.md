# WR-05 Source-Bound Delivery Evidence Register

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-05
change_id: CHANGE-034
evidence_state: closed
opened_at: 2026-07-27T12:10:00Z
updated_at: 2026-07-27T12:38:19Z
closed_at: 2026-07-27T12:38:19Z
base_git_head: 7720fac057ec290b7ddbbb5e5fd3849f71449f1a
candidate_version: 3.6.68
host_boundary: Browser fixtures and isolated build data only. No Windows
  takeover, proxy, DNS, firewall, TUN, FlClash, or host-network action.

This register records completed CHANGE-034 delivery facts. It cannot authorize
follow-on work.

## Artifact Identity

- Path: `src-tauri/target/release/bundle/nsis/Aegos_3.6.68_x64-setup.exe`
- Name: `Aegos_3.6.68_x64-setup.exe`
- Size: `16,335,672` bytes
- SHA-256: `839804d895d4c5af77568e2e876407a6b29f17bf33fdd9e771165ea387b7ade4`
- Embedded product/file version: `3.6.68`
- Authenticode status: `NotSigned`; this is an explicitly unsigned release.
- v3.6.67 tag and installer are historical and were not altered.

## Required Matrix

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: exit 0.
- `cargo test --manifest-path src-tauri/Cargo.toml`: exit 0; 228 passed,
  0 failed, completed at `2026-07-27T12:27:25Z`.
- `npm run smoke:interactions`: exit 0. The fixture includes a first outbound
  IP lookup failure and requires the visible `查询失败` state.
- `npm run smoke:ui`: exit 0 across 14 fixed window/DPI configurations.
- `npm run smoke:perf:stress`: exit 0 at `2026-07-27T12:25:14Z`; 800 nodes,
  420 navigations, 3.9ms repeated-speed feedback, 800 streamed results, and
  `0.01031` layout shift under the unchanged `0.02` limit.
- `npm run smoke:soak`: exit 0; 16 cycles, 262 commands, no failures.
- Exit 0: `audit:backend`, `audit:responsiveness`, `audit:stability`,
  `audit:security`, `audit:status-vocabulary`, `audit:control-plane`,
  `audit:architecture`, `audit:core-domain`, `audit:home-product`,
  `audit:routing-product`, `audit:routing-assistant-maturity`,
  `audit:subscription-product`, `audit:outbound-ip`, `audit:local-backup`,
  `audit:installer-regression`, and `audit:planning-context`.
- `node tools/installer-candidate-audit.js --installer
  src-tauri/target/release/bundle/nsis/Aegos_3.6.68_x64-setup.exe`: exit 0 at
  `2026-07-27T12:35:38Z`; version, bytes, hash, NSIS/WebView2/core/port
  constraints passed.
- `npm run audit:release`: exit 0 at `2026-07-27T12:36:16Z`.
- `npm run audit:release-trust`: exit 0 with `requireSigned: false`; the
  stricter signed-candidate command is intentionally not passed because no
  signing certificate or signing authorization exists. The release note and
  GitHub Release must state this unsigned status.

## Retained Failure Closure

- At `2026-07-27T12:22:57Z`, `audit:home-product` and `audit:outbound-ip`
  exited nonzero. A first failed outbound-IP request could render `-`, which
  was not an explicit failed measurement. The repair makes an empty-history
  failure render `查询失败`; a historical address remains visibly marked as a
  prior observation. The interaction fixture rejects the old state, and both
  audits passed afterward.
- At `2026-07-27T12:35:39Z`, `audit:release` exited nonzero because its
  compact-node-table assertion still expected the obsolete `稳定性` label.
  The actual UI had the clearer `最近稳定性` label while retaining all
  no-address/no-recent-filter/status constraints. The assertion was updated
  to the shipped label; the full release audit passed afterward.
- The initial active-plan context guard still expected WR-04 after CHANGE-034
  opened WR-05. It was corrected to require the immutable v3.6.67 history and
  the 3.6.68 unsigned source-bound candidate; the active planning audit then
  passed at `2026-07-27T12:26:40Z`.

## Safety And Residue

- All verification used browser fixtures, sanitized TEST-NET addresses, and
  local build output. No real takeover or network-changing command ran.
- Exact temporary-root checks found no residual interaction, UI, performance,
  or soak harness root after the final matrix.
- The dirty source/evidence worktree includes cumulative accepted WR-03/WR-04
  repairs plus this delivery work; no unrelated change was reverted.

## Publication Closure

- Source commit and tag: `e4dd999f1d97ff079676f109900facceb7dfc572` /
  `v3.6.68`.
- GitHub Release: `https://github.com/JoyceBrown/Aegos/releases/tag/v3.6.68`
  published at `2026-07-27T12:38:19Z`.
- Remote asset: `Aegos_3.6.68_x64-setup.exe`, state `uploaded`,
  `16,335,672` bytes, digest
  `sha256:839804d895d4c5af77568e2e876407a6b29f17bf33fdd9e771165ea387b7ade4`.
- The remote target, asset name, byte count, and SHA-256 equal this record and
  the local built candidate. The release is public, not draft, not prerelease,
  and explicitly unsigned.
