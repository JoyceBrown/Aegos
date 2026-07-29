# Current Work Checkpoint

record_kind: checkpoint
execution_authority: none
active_plan: ../../PLANS.md
plan_id: AEGOS-WINDOWS-RELIABILITY
current_task_id: DG-01
latest_change_id: CHANGE-052
latest_change_class: priority_branch
updated_at: 2026-07-29

This checkpoint records current facts only. CHANGE-052 and the active exclusive
`PLANS.md` authorize the ordered DG-01 delivery-readiness unit. The authority
is limited to two exact source-control closures, a read-only isolated-Windows
capability probe, and a minimal Windows CI lane.

The pre-consolidation checkpoint is retained at
`archive/current-2026-07-28-rel01.md`. Historical decisions belong to their
individual evidence registers under `docs/work/`, not to this current file.

## Current Decision

CHANGE-052 / DG-01 is active after the user approved the proposed sequence:

1. review, validate, commit, and push only the accepted v3.6.70 closure and
   v3.6.71 source/license/evidence files;
2. inspect Hyper-V, Windows Sandbox, and existing VM capability read-only; and
3. add a separate, least-privilege Windows CI commit without weakening the
   local full release matrix.

The user-owned provider-panel scripts, preview images, temporary directories,
and research note remain explicitly excluded. Public release, tags, installer
upload, certificate purchase, signing, installation, Aegos launch, live
takeover, host-network mutation, and every FlClash action remain excluded.

Fresh remote checks on 2026-07-29 show `gh auth status` succeeds for
`JoyceBrown` with repository/workflow scope, no local/global/environment proxy
is configured, and `git ls-remote origin` resolves `main` to the local baseline
`01fd0151a9b7a79f793ff5b009676c546874fdd1`. The previous proxy/credential
blocker is therefore not current.

## Previous Completed Decision

CHANGE-051 / LIC-01 is complete under the user's explicit selection of GPL-3.0
for Aegos and direction for Codex to complete all license and installer
materials. The task allocated local candidate version 3.6.71 because the
published v3.6.70 source, tag, and asset are immutable.

LIC-01 includes the Aegos GPL-3.0-only license, exact Mihomo provenance and
license, deterministic third-party notices, Tauri/NSIS resources, fail-closed
license gates and negative fixtures, a complete host-safe matrix, and a new
local unsigned source-bound installer. It excludes installation, publication,
Git commit/push, signing, live takeover, FlClash, and host-network changes.

Fresh source verification identified the exact managed-core origin:

- release/tag: Mihomo `v1.19.28`, commit
  `cbd11db1e13a75d8e680e0fe7742c95be4cba2be`;
- official asset: `mihomo-windows-amd64-v1-v1.19.28.zip`, 17,730,829 bytes,
  SHA-256
  `e1a47d4eb9b864e242e92ef4d501b052241c7e4eb5a592f2b124959e8efb2312`;
- extracted official executable: 47,942,656 bytes, SHA-256
  `c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517`,
  exactly matching `resources/core/mihomo.exe`.

## Previous Completed Decision

CHANGE-050 / REL-01 is complete. Commit
`01fd0151a9b7a79f793ff5b009676c546874fdd1` is on `origin/main`, is the
`v3.6.70` tag target, and owns the public non-draft, non-prerelease release:

`https://github.com/JoyceBrown/Aegos/releases/tag/v3.6.70`

The one published `Aegos_3.6.70_x64-setup.exe` asset is 16,341,772 bytes.
GitHub reported state `uploaded` and server digest
`sha256:9c6ebab99f9c80792e3e2b9d6ab766c55fcac5092aa19575bb27cb87126ef261`,
matching the local candidate. Authenticode is `NotSigned`; the installer was
not installed.

The final source-bound 30-command host-safe matrix, provenance, installer,
release, trust, and known-bad fixture gates passed. A separate binary download
through this host reset or stalled, so no independent downloaded-file hash is
claimed. No Aegos or test process/root remained and FlClash PID 13184 was
unchanged. Full evidence is in `release-3.6.70-rel01.md`.

## Current Worktree

`main`, `HEAD`, and `origin/main` all resolve to
`01fd0151a9b7a79f793ff5b009676c546874fdd1`.

Eight tracked files contain the uncommitted post-publication closure and final
matrix refresh:

- `PERFORMANCE_NATIVE_3.6.70.auto-speed-enabled.json`
- `PERFORMANCE_NATIVE_3.6.70.auto-speed-suppressed.json`
- `PERFORMANCE_PRESSURE_3.6.70.json`
- `PERFORMANCE_SOAK_3.6.70.json`
- `PLANS.md`
- `PRODUCT_SMOKE_3.6.70.json`
- `docs/work/current.md`
- `docs/work/release-3.6.70-rel01.md`

This checkpoint consolidation additionally creates the archived checkpoint,
the maintenance register, and documentation-index changes. No commit or push
is authorized by REL-01 because its single source commit/push authorization
was already consumed.

LIC-01 additionally changes the 3.6.71 manifests/UI version, release record,
README license disclosure, installer checklist, acceptance/provenance/release
gates, and creates the root license, NOTICE, Mihomo/Rust third-party materials,
license/payload audits, 3.6.71 performance reports, and its evidence register.
Those changes remain uncommitted and unpushed at the opening of DG-01; the full
current inventory is the live `git status`, not the older eight-file REL-01
list above. CHANGE-052 now authorizes their exact reviewed source-control
closure, but does not authorize staging any excluded user-owned file.

The local Codex provider-panel scripts, preview images, research note, and
temporary directories are user-owned and out of scope. They must not be
deleted, moved, staged, or treated as Aegos release inputs.

## Fresh Verification

The following read-only checks were rerun on 2026-07-29 (2026-07-28 UTC):

- `npm run audit:control-plane`: exit 0; production budgets are
  `main=11707/11770` and `core_runtime=2866/2900`.
- `npm run audit:architecture`: exit 0.
- `npm run audit:debt`: exit 0 with every counted debt class at zero.
- `npm run audit:planning-context`: exit 0 after this consolidation.
- `npm audit --json`: exit 0 with zero vulnerabilities.
- The top-level npm freshness query (`outdated --json`) exited 0 with no update
  reported.
- `resources/core/mihomo.exe -v`: exit 0, Mihomo Meta `v1.19.28`,
  Windows amd64, Go 1.26.5.
- The managed core is 47,942,656 bytes with SHA-256
  `c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517`.
- The local 3.6.70 installer is still present at the recorded 16,341,772 bytes
  and recorded SHA-256; it was not executed or installed.

No product source, release artifact, host network, FlClash state, or external
release state was changed by the context audit.

The complete 32-command host-safe matrix must pass after the final edit to this
checkpoint because this file is a candidate gate input. Its final run identity
belongs to `.validation/wr01/acceptance.json` and the maintenance register; it
is deliberately not copied into this self-referential gate input.

One interrupted attempt is retained rather than hidden: an outer tool timeout
terminated the coordinator for
`wr01-20260728171734-15120` after two recorded commands. Its orphaned
`cargo test` completed 232/232, but the attempt is invalid because the
coordinator could not record the remaining commands. No residual test process
or network side effect remained.

## Historical Invariants

These compact invariants preserve existing fail-closed planning coverage while
the full narratives remain archived:

- CHANGE-037 was a narrow post-release UI repair that retained the fixed
  window/DPI matrix and did not broaden product scope.
- CHANGE-039 / WR-08 is complete; its responsiveness evidence and delivery
  exclusions remain owned by `windows-reliability-wr08.md`.
- CHANGE-029 closed the reopened WR-02 after its deterministic regressions and
  complete acceptance matrix passed.

## Exact Next Action

Stabilize the CHANGE-052 plan/checkpoint and stale maintenance register, rerun
the affected license/planning/release checks and the complete 32-command
host-safe matrix, review the exact staged set, then commit and push only the
accepted v3.6.70 closure plus v3.6.71 source/license/evidence files. After the
push, probe isolated-Windows capability read-only and implement the separately
reviewable minimal Windows CI commit.

Do not install, launch, publish, tag, upload, purchase or sign, perform live
takeover, affect FlClash, or change the host network.
