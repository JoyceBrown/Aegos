# Aegos Maintenance Register

record_kind: maintenance_register
execution_authority: none
snapshot_at: 2026-07-29
git_baseline: 90a17ea
release_baseline: v3.6.70

This document answers what still needs maintenance after the v3.6.70 release.
It is a verified register and priority recommendation, not an executable plan.
An item becomes work only through a newer explicit user instruction and, for
long-running development, an active exclusive `PLANS.md`.

Status vocabulary:

- **Verified**: observed by a fresh command or current repository evidence.
- **Decided**: an explicit product or architecture boundary.
- **Open**: a real gap that has not been authorized as work.
- **Conditional**: needed only if distribution or product scope expands.

## Current Assessment

Aegos is a mature Windows-only reliability-focused desktop control plane, not
an early prototype. Its current release closure is strong: the exact source,
tag, GitHub asset, installer digest, host-safe matrix, negative fixtures, and
managed-core identity are recorded. Fresh control-plane, architecture, debt,
planning, and npm security audits pass.

The main risk has moved from missing behavior to maintainability and delivery
governance. The control-plane budgets are almost full, the current test system
has 124 package scripts and 108 JavaScript tools in the live Aegos change set,
historical release evidence occupies most of the tracked file list, the first
minimal Windows CI lane is being landed by DG-01, and Authenticode signing
remains a later distribution decision. The previous license-packaging blocker
is closed by LIC-01.

## Verified Repository Facts

| Area | Status | Fresh evidence |
| --- | --- | --- |
| Release | Verified | `v3.6.70` points to `01fd0151`; the public asset is 16,341,772 bytes with SHA-256 `9c6ebab9...ef261`; unsigned and not installed. |
| Release regression | Verified | The final REL-01 record binds 30 host-safe commands, 232 Rust tests, 13 journeys, 14 window/DPI configurations, 800 nodes/420 switches, 16 soak cycles, and both native modes. |
| Working tree | Active | Commit `90a17ea` landed the post-publication and v3.6.71 license/source set; only the DG-01 CI/evidence change remains. Unrelated provider-panel experiments remain user-owned and excluded. |
| Control plane | Verified, near limit | `main=11707/11770` production lines and `core_runtime=2866/2900`; audit passes but only 63 and 34 lines of budget remain. |
| Frontend | Verified, concentrated | `src/app.js` is 464,899 bytes/9,912 lines and `src/styles.css` is 237,774 bytes/8,114 lines. |
| Backend | Verified, concentrated | `src-tauri/src/main.rs` is 577,008 bytes/14,536 physical lines and `core_runtime.rs` is 158,369 bytes/4,532 physical lines. Production-line budgets use a narrower count than physical lines. |
| Test tooling | Verified, fragmented | `package.json` exposes 124 scripts; 108 tracked JavaScript files live under `tools/`. |
| Context density | Verified | 751 tracked files include 358 root `RELEASE_*.md` files and 71 root performance JSON files. They are evidence, but their location makes the root and search results noisy. |
| CI | Active | DG-01 adds one least-privilege Windows source-check workflow; native UI, soak, packaging, publication, and live takeover remain outside CI. |
| npm supply chain | Verified | `npm audit --json` reports zero vulnerabilities; the top-level `outdated --json` freshness query reports no update. |
| Rust graph | Verified | The lockfile resolves successfully. Duplicate transitive major versions exist through Tauri/WebView2 and are not independently actionable without an upstream-aware update. |
| Managed core | Verified | Bundled Mihomo Meta is `v1.19.28`, 47,942,656 bytes, SHA-256 `c14bda8d...6517`; source and audits pin the same identity. |
| Local build retention | Open | `target/release/bundle/nsis` contains 34 ignored installers totaling about 526.2 MiB, from 3.6.36 through 3.6.71. |
| Durable evidence | Open | `.validation/` is ignored while release documents refer to its acceptance/provenance reports. A clean clone cannot reproduce those local files from Git alone. |
| Text normalization | Open | No `.editorconfig` or `.gitattributes` exists; Git warns that current evidence files will change LF to CRLF when touched. |

## Maintenance Priorities

### MNT-01 — Distribution licensing and notices

Item state: completed by CHANGE-051 / LIC-01.

Verified closure:

- Aegos declares `GPL-3.0-only` and includes the unmodified GPLv3 text at the
  repository root and in the NSIS application resources.
- `THIRD_PARTY_NOTICES.md` inventories 284 locked Rust packages; fixed
  upstream/standard material and documented exceptions cover missing cached
  texts.
- Mihomo is pinned to `v1.19.28`, commit
  `cbd11db1e13a75d8e680e0fe7742c95be4cba2be`, with official archive and
  executable hashes, source link, provenance record, and GPLv3 text.
- Direct extraction of the 3.6.71 NSIS candidate matched the managed core plus
  all eight required `licenses/` resources byte-for-byte (9/9 payload pairs).
- Fail-closed license and payload gates plus known-bad fixtures passed. Full
  evidence is owned by `docs/work/license-packaging-lic01.md`.

This records a compliance implementation and is not legal advice.

### MNT-02 — Close the post-publication repository state

Item state: completed by CHANGE-052 commit `90a17ea`.

Eight pre-existing tracked files contain the final post-publication matrix and
REL-01 closure. This context consolidation adds three intended repository
files: `docs/INDEX.md`, this register, and the archived checkpoint. The eleven
closure/context files and the completed v3.6.71 license/source set were reviewed
as one 45-file commit and pushed so a fresh clone no longer stops at the
pre-publication checkpoint. Unrelated untracked files remained excluded.

Completion condition:

- review the exact staged list;
- rerun context and release-evidence gates affected by documentation changes;
- commit and push only the accepted closure/context files;
- verify `HEAD == origin/main` without claiming a new release or changing the
  immutable `v3.6.70` tag.

### MNT-03 — Prove real Windows recovery in an isolated lab

Item state: conditional and permission-blocked after the DG-01 read-only probe.

Hyper-V and its management service are enabled, but the current non-elevated
account is not in Hyper-V Administrators; VM/host/switch inventory queries are
denied. Windows Sandbox is disabled. The minimum next action is a later
elevated read-only `Get-VM` probe or Hyper-V Administrators membership plus
sign-out/sign-in. Creating or starting a VM still requires separate authority.

The host-safe matrix deliberately avoids changing this host's proxy, TUN, DNS,
firewall, kill-switch, and FlClash. That is correct, but it leaves real
takeover, interrupted recovery, reboot recovery, administrator relaunch, and
network restoration dependent on isolated/static evidence.

Completion condition:

- use a disposable Windows 10/11 VM or dedicated lab host, never this host's
  FlClash dependency;
- capture before/after system state and an automatic rollback route;
- cover proxy, TUN, firewall, DNS/IPv6, process interruption, reboot, corrupt
  recovery journal, and failed core startup;
- retain failure evidence and prove cleanup of processes, listeners, files,
  and network state.

### MNT-04 — Continue ownership extraction before budget exhaustion

Priority: high.

Do not raise the current budgets. New behavior must enter focused modules. The
next extraction should be selected by a concrete defect or change hotspot, not
by file size alone.

Completion condition:

- keep `audit:control-plane` budgets at or below 11,770/2,900;
- move one coherent owner at a time with behavioral regression coverage;
- delete the replaced path and preserve one command/status model;
- avoid a second frontend framework or second control plane.

### MNT-05 — Add a minimal Windows CI lane

Item state: authorized as the second, independently reviewable source-control
closure inside CHANGE-052 / DG-01, after MNT-02 and the read-only MNT-03 probe.

The pending `.github/workflows/windows-ci.yml` validates
formatting, Rust tests, JavaScript syntax, npm security, architecture,
control-plane, debt, planning-context, and negative fixture suites. Native UI,
soak, installer, and live Windows takeover should remain separate release/lab
lanes with explicit environment requirements.

Completion condition:

- one documented Windows CI workflow with pinned actions and least privilege;
- no secrets exposed to pull-request code;
- cache policy and timeouts documented;
- local/full release matrix remains authoritative for native and packaging
  evidence rather than being silently weakened to fit CI.

### MNT-06 — Consolidate the audit command surface

Priority: medium.

The 120 package scripts and 105 JavaScript tools preserve extensive coverage,
but discovery and change impact are difficult. Some planning checks depend on
historical prose strings, so simplifying a document can fail unrelated gates.

Completion condition:

- publish a small command taxonomy: focused, host-safe source, native,
  packaging, publication, and isolated-lab;
- keep current individual commands as implementation details or compatibility
  aliases while one manifest owns command membership and floors;
- replace prose-string coupling with structured metadata where it does not
  reduce assertions, fixtures, matrix dimensions, or failure paths;
- prove every known-bad fixture still exits nonzero.

### MNT-07 — Make release evidence durable and policy-consistent

Priority: medium.

The ignored `.validation/` reports provide strong local evidence but are not
recoverable from a clean clone. Also, `verify:release` always requires a signed
candidate, while the current release policy explicitly allowed an unsigned
asset and therefore used lower-level gates.

Completion condition:

- choose a durable, redacted evidence format: committed summary plus digests,
  or immutable CI/release artifacts with stable links and retention;
- distinguish `verify:unsigned-release` from
  `verify:signed-distribution`, or parameterize one fail-closed command;
- keep unsigned disclosure explicit and never let a permissive mode satisfy a
  signed-distribution gate.

### MNT-08 — Migrate historical evidence out of the root

Priority: medium; do not bulk-move without a migration plan.

357 release notes and 67 performance JSON files are legitimate traceability
records, but together they are 424 of 730 tracked files. Moving them now would
break hard-coded references and historical audits.

Completion condition:

- first create a machine-readable release/evidence index;
- update consumers and links with tests;
- move records gradually to versioned archive directories;
- retain Git history and release identity;
- remove obsolete aliases only after all consumers use the new locations.

### MNT-09 — Define UTF-8 and line-ending policy

Priority: medium-low.

Add `.editorconfig` and `.gitattributes` in a dedicated normalization change,
then review `git add --renormalize` output before accepting it. Do not mix a
mass line-ending rewrite into product or release evidence changes.

### MNT-10 — Routine dependency and build-output hygiene

Priority: routine.

- Review npm and Cargo updates on a scheduled cadence, with Tauri/WebView2
  compatibility and the complete affected regression layer.
- Review Mihomo releases separately; admit a new core only through version,
  digest, capability, regression, license, and rollback gates.
- Keep only the current and one known-good local installer when disk pressure
  matters. The ignored historical installers are recoverable build outputs,
  but deleting them is a user-approved cleanup action, not part of this audit.
- Record the build toolchain used for each release. The current machine uses
  Rust/Cargo 1.96.1, Node 24.18.0, and npm 11.16.0.

## Explicit Non-Priorities

The following are decided non-goals or require a separate roadmap decision:

- macOS, Linux, ARM64, cloud control, multi-user collaboration, or WebDAV;
- a second proxy core, a second rule engine, or raw Controller/runtime-YAML UI;
- automatic updates, signing infrastructure, or public release automation;
- cosmetic framework migration or broad feature expansion;
- refactoring solely to reduce line counts without a product or ownership
  reason.

## Context Consolidation Verification

Item state: Verified.

- The first full-matrix attempt
  `wr01-20260728171734-15120` was interrupted when its outer coordinator timed
  out after two recorded commands. The orphaned Rust suite completed 232/232,
  but the attempt remains invalid and is not used as passing evidence.
- The final post-consolidation matrix
  `wr01-20260728172424-12704` ran from
  `2026-07-28T17:24:24.336Z` through
  `2026-07-28T17:27:50.116Z`. All 30 commands passed, including 232 Rust tests,
  13 product journeys, all 14 window/DPI configurations, 800 nodes/420
  navigation switches, 16 soak cycles, and both native modes.
- Source digest is
  `e4ac7cd3dccb35b58367c7b1b137b380e14e2d5d1270bf311f2ac547400383fd`;
  final gate digest is
  `599519c522be317972da68748db4a33f90783bbcfe1fe683210f042156ea1681`;
  immutable matrix baseline is
  `ce18496398c2bb4205bcdfd90cc5cbbbdb94acc994f62b1a48a332d9c6c6aab9`.
- `audit:wr01-acceptance` and current candidate provenance both exit 0 after
  rebinding the unchanged original build metadata to the fresh validation.
- The installer remains 16,341,772 bytes with SHA-256
  `9c6ebab99f9c80792e3e2b9d6ab766c55fcac5092aa19575bb27cb87126ef261`.
  It was not rebuilt, executed, installed, uploaded, or republished.
- The standard project-context validator exits 0 with no errors. Its remaining
  warnings concern manual Cargo verification and already indexed historical
  plan-like filenames; they do not create execution authority.
- No Aegos/test process remains. FlClash remains PID 13184 with its original
  start time; no host-network operation was performed.

## Recommended Order

1. Finish the authorized source/license repository closure.
2. Record whether an isolated Windows recovery lab is already available; do
   not enable or create one on this host without separate authority.
3. Add and land the authorized minimal Windows CI lane.
4. Protect module budgets and consolidate audit/evidence infrastructure.
5. Migrate historical files and normalize text only through dedicated,
   independently reviewable changes.

No item in this order is automatically authorized by this document.
