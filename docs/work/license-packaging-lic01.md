# LIC-01 License And Installer Packaging Evidence

record_kind: evidence_register
evidence_state: closed
task_id: LIC-01
change_id: CHANGE-051
plan_id: AEGOS-WINDOWS-RELIABILITY
version: 3.6.71
execution_authority: none
active_plan: ../../PLANS.md
updated_at: 2026-07-29

## Objective And Boundary

LIC-01 closes the Aegos `GPL-3.0-only`, third-party NOTICE, exact managed
Mihomo provenance/license, fail-closed gate, and actual NSIS payload gap as one
unit. The authorized output is one local, unsigned, uninstalled, unpublished,
source-bound 3.6.71 candidate.

Installation, signing, Git commit/push, GitHub publication, updater work, live
takeover, host proxy/TUN/DNS/firewall/kill-switch changes, and every FlClash
action are excluded.

## Fixed Inputs

| Input | Verified identity |
| --- | --- |
| Aegos license | `GPL-3.0-only`; unmodified GNU GPLv3 text, 35,149 bytes, SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |
| Mihomo upstream | `v1.19.28`, commit `cbd11db1e13a75d8e680e0fe7742c95be4cba2be` |
| Official asset | `mihomo-windows-amd64-v1-v1.19.28.zip`, 17,730,829 bytes, SHA-256 `e1a47d4eb9b864e242e92ef4d501b052241c7e4eb5a592f2b124959e8efb2312` |
| Managed executable | `resources/core/mihomo.exe`, 47,942,656 bytes, SHA-256 `c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517`; byte-identical to the fixed official asset member |
| Mihomo license | `GPL-3.0-only`; fixed upstream GPLv3 text, 35,149 bytes, SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |

## Evidence Register

| Gate | State | Evidence |
| --- | --- | --- |
| Deterministic NOTICE generation | verified | 284 unique locked Windows x64 MSVC normal/build third-party packages; `THIRD_PARTY_NOTICES.md` and `third_party/rust/THIRD_PARTY_LICENSES.txt` write/check paths passed before gate integration |
| Missing crate license texts | verified | Ten crates without cached text are explicitly documented and supplied from fixed, hash-checked equivalent upstream/standard material in `third_party/rust/LICENSE_EXCEPTIONS.md` |
| License audit and known-bad fixtures | verified | Real audit passed; all eight isolated bad fixtures were rejected without editing the real tree |
| Existing host-safe acceptance floors | verified | The pre-closure 32-command run passed with 232 Rust tests, 13 product journeys, 14 window/DPI configurations, 800 nodes/420 navigations, 16 soak cycles, and both native modes; the canonical final report is regenerated after this self-referential gate-input record |
| 3.6.71 NSIS candidate | verified | Fresh isolated-target build produced `Aegos_3.6.71_x64-setup.exe`, 16,399,892 bytes, SHA-256 `a3215fbdc3f08db76c57ab193cf8ef7b4aabd1236518697785d2788fa52bc887` |
| Actual NSIS license payload | verified | Direct NSIS extraction found the managed core and all eight `licenses/` files; each matched its repository source byte-for-byte and by SHA-256 |
| Artifact hash and signature | verified | SHA-256 above; Authenticode `NotSigned` |
| Residual process/root and FlClash boundary | verified | No Aegos, Cargo, or rustc process remained; FlClash PID 13184 remained present and was not targeted or changed |

## Fresh Verification

The first complete attempt, `wr01-20260728182016-6900`, is retained as an
invalid failure: 22 commands passed, then `audit:runtime-regression` correctly
rejected the new release record because it had not yet listed the four
unchanged runtime recovery gates. After the release record was repaired, the
changed strategy was validated with focused runtime, license, and planning
audits before another full run.

The pre-closure complete matrix
`wr01-20260728182938-16000` ran from
`2026-07-28T18:29:38.227Z` through `2026-07-28T18:33:35.054Z` and passed all
32 commands. Its source digest was
`f9e6b8171f11b1b3c81951a864c290ae0c4d0f736442c58bec34d97d08c1f7b7`;
its gate digest was
`ce2acda08d7c88140970e0ba0f2c6f3de18d1bc1b385ef6ed3bcd7d3fa5edc9c`.
The canonical completion run is the current
`.validation/wr01/acceptance.json` generated after the final edits to this
record, `PLANS.md`, and `docs/work/current.md`; its run identity is not copied
back into these self-referential gate inputs.

The isolated build started at `2026-07-28T18:33:52.824Z` with
`CARGO_TARGET_DIR=.validation/lic01/target-3.6.71-20260729` and
`npm run build`. The final installer was written at
`2026-07-28T18:41:28.670Z`; the successful command exited 0. Toolchains were
Node `v24.18.0`, `rustc 1.96.1`, and `cargo 1.96.1` on Windows x64.

Actual payload verification used official 7-Zip 26.02. The fixed official
`7z2602-extra.7z` archive was 1,758,916 bytes with SHA-256
`081df9e9311dfd9c9e0e98c1c80180b99bb51e4cb24156b5f3057fe3c259d70a`.
Its reduced `7za.exe` correctly failed to open NSIS and was not retried. The
changed method extracted the official `7z2602-x64.exe` SFX (1,657,896 bytes,
SHA-256
`6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0`)
without installation and used its complete `7z.exe` (576,000 bytes, SHA-256
`83967f1b02b43c4efeda302795722c809e0e81b8307de73558d10484d5676a7d`).
The payload audit completed at `2026-07-28T18:48:36.904Z`, reported NSIS-3
Unicode/LZMA, matched nine source/payload pairs, and deleted its temporary
extraction root.

The first post-matrix provenance write exposed a pre-existing digest-schema
gap: acceptance serialized records as `{file,size,sha256}` while provenance
serialized the same boundary as `{path,bytes,sha256}`, and its old check did
not require the two digests to equal. That manifest was not accepted as final.
The provenance audit now hashes the acceptance record schema, directly
requires both source and gate digests to equal the current acceptance report,
and has separate known-bad source/gate mismatch fixtures. The canonical
provenance record is rewritten only after the repaired final matrix.

## Current Repository State

Baseline remains published v3.6.70 commit/tag
`01fd0151a9b7a79f793ff5b009676c546874fdd1`. Existing post-release evidence,
checkpoint, provider-panel scripts/images, research, and temporary directories
are user-owned dirty-worktree content and were preserved. LIC-01 itself is
uncommitted, unpushed, unsigned, uninstalled, and unpublished. No Git,
publication, updater, signing, live takeover, host-network, or FlClash action
occurred.

## Exact Next Action

Wait for explicit user authority. LIC-01 does not authorize installation,
commit, push, signing, publication, updater work, host-network changes, or any
FlClash action.
