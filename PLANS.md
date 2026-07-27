# Aegos Windows Real-Use Reliability Plan

plan_id: AEGOS-WINDOWS-RELIABILITY
status: completed
authority: none
current_task_id: none
roadmap_reference: docs/roadmap.md
continuation_policy: validate_then_advance
completion_policy: all_required_items
priority_basis: The current-code three-angle review found P1 truth, recovery,
  and responsiveness defects plus bounded P2 robustness and ownership gaps.
  The user explicitly directed their repair before any new capability work.
delivery_contract: Repair the user-visible high-frequency status vocabulary,
  layout, and stability model; then build a new source-bound unsigned 3.6.69
  NSIS installer, verify its exact bytes and the full required host-safe
  matrix, commit and push the source/evidence, and create a matching GitHub
  Release. Existing release tags and assets remain immutable historical evidence.
latest_change_id: CHANGE-035
latest_change_class: task_adjustment
change_authority_reference: none
delegated_execution: none
on_complete: validate_and_close

## Objective

Make the Windows client dependable in the situations that matter during daily
use: a command must settle honestly, a failed network change must remain
recoverable, and navigation, the status center, and diagnostics must remain
usable while work is running. This is a reliability program for the existing
product, not a feature-expansion program.

The completed `AEGOS-WINDOWS-MATURITY` plan is historical evidence. Its five
closed registers remain under `docs/work/windows-maturity-wm01.md` through
`docs/work/windows-maturity-wm05.md`; they do not authorize another task.

CHANGE-023 is a user-reported display-defect adjustment within WR-01. It
authorizes only the repair and regression coverage for clipped connection-row
actions and the diagnostics overview layout. Packaging, signing, publication,
and controlled network takeover remain excluded.

CHANGE-024 is the user's explicit request for a local installer so the
display-defect repair can be accepted in the desktop application. It permits
one unsigned, unuploaded `3.6.64` x64 NSIS build after the focused UI checks.
It does not authorize publication, signing, automatic updates, or network
takeover.

CHANGE-025 is the user's explicit high-frequency-page presentation audit. It
authorizes visual and interaction checks of Home, Nodes, Rules, Profiles, and
Settings at the existing fixed window/DPI matrix, with focused repair only for
a reproduced display defect. It does not authorize network takeover, release,
or a further installer unless a repair needs desktop acceptance.

CHANGE-026 is the user's explicit request to execute the isolated
operation-state acceptance harness. It verifies subscription, node, routing,
settings, diagnostics, cancellation, and background-work terminal states
without using the host's actual network configuration. It authorizes repair
only for a reproduced inconsistent terminal state.

CHANGE-027 is the user's explicit six-item completion closure. It keeps WR-01
as the current task and requires the acceptance runner to execute and bind the
complete host-safe matrix, align every current authority/evidence document,
build one new source-bound unsigned installer, establish a recoverable Git
baseline, and push that commit to the configured GitHub origin. This is a
task adjustment, not a public-release or product-scope change. GitHub Release,
signing, automatic updates, and live Windows takeover remain excluded.

CHANGE-028 is the user's explicit report of two coupled responsiveness defects:
repeated speed tests do not provide prompt, visibly changing node results, and
the first one or two visits to Nodes or Connections after startup visibly
stutter. It activates WR-02 as one atomic repair. It authorizes focused UI,
measurement-event, page-loading, and regression changes plus one local
unsigned installer; it does not authorize publication, Git actions, live
takeover, or unrelated architecture work.

CHANGE-029 is the user's rejection of the 3.6.66 WR-02 acceptance result. A
testing label alone is not sufficient feedback: each manual click must paint a
numeric elapsed-measurement indicator immediately and keep it moving until a
real result or terminal failure replaces it. The cold-start regression must
also cover leaving Connections while its request, result preparation, startup
prewarm, or startup node work is pending. It reopens WR-02 without changing the
measurement-only or host-safety boundaries.

CHANGE-030 is the user's explicit request to synchronize the completed 3.6.67
candidate with GitHub. It authorizes one source-and-evidence commit and push to
the configured `origin/main` after current source-bound acceptance succeeds.
It does not authorize a GitHub Release, artifact upload, signing, automatic
update, live takeover, or any new product work.

CHANGE-031 is the user's explicit instruction to create the `v3.6.67` GitHub
Release and upload the exact accepted NSIS installer. The release description
must state that the installer is unsigned and provide its SHA-256. It does not
authorize signing, automatic updates, live takeover, or any new product work.

CHANGE-032 is the user's explicit instruction to repair the current-code
three-angle review findings. It activates WR-03 only for: truthful connected
presentation, recovery selection rollback, background-read availability,
corrupt active-takeover evidence, rejected-profile state preservation, and
focused lock/ownership cleanup. Each repaired P1/P2 requires a deterministic
known-bad control and an affected host-safe regression. It does not authorize
controlled live takeover, release, installer work, GitHub publication, signing,
automatic updates, or any action on FlClash.

CHANGE-033 is the user's explicit instruction to implement the 3.6.67 UI
review repairs. It activates WR-04 only for truthful separation of effective
network state from measurement history, unavailable-takeover connection
guidance, non-stale persistent metrics, explicit kill-switch state, discoverable
node actions, navigation semantics, accessible truncated profile information,
and redacted UI fixtures. It does not authorize a broad redesign, a new UI
framework, installer work, release, GitHub publication, signing, automatic
updates, live takeover, or any action on FlClash.

CHANGE-034 is the user's explicit instruction to build an installer and
synchronize GitHub Release delivery after WR-04. It activates WR-05 for one
new `3.6.68` source-bound unsigned NSIS installer, required release gates,
one source/evidence commit and push to `origin/main`, and one new GitHub
Release with the installer SHA-256. It must not replace the existing
`v3.6.67` tag or asset, claim Authenticode signing, enable automatic updates,
perform live takeover, or change FlClash or the host network.

CHANGE-035 is the user's explicit correction of the 3.6.68 primary UI. It
activates WR-06 for only: conventional high-frequency labels (`延迟`, `稳定性`,
`落地 IP`), removal of core-standby and unclaimed-takeover language from the
Home primary surface, full untruncated disconnect-protection wording without
an `未开启` suffix, and a stability model based on 10/30-minute measurement
variance around a rolling average rather than a one-run relative ranking. It
authorizes focused code, fixture, visual, interaction, performance, installer,
commit/push, and one new GitHub Release. It does not authorize live takeover,
FlClash or host-network changes, signing, automatic updates, a UI framework,
or unrelated product work.

## Baseline And Boundaries

- Baseline: clean `main` at `28e539b` / `3.6.65`, already synchronized with
  `origin/main` by the completed CHANGE-027 delivery.
- Verified prior evidence: 222 Rust tests, interaction/UI, 800-node stress,
  soak, backend, responsiveness, stability, security, DNS/IPv6, installer,
  release, architecture, planning, and control-plane gates passed for WM-05.
- Current capacity warning: `main.rs=11691/11770` and
  `core_runtime.rs=2866/2900` production lines. The budgets and assertions are
  hard limits, not values to raise.
- Verified lifecycle closure: the exact interrupted managed-core cases now use
  Windows Job Object ownership, preserve the same-executable sentinel, and
  leave no owned process, listener, or root. Historical residues were removed
  only after exact identity revalidation.
- Current delivery finding: the accepted 3.6.65 installer is the baseline
  artifact. Any WR-02 product change makes it historical and requires a new
  source-bound candidate before another installer is described as current.
- Aegos owns product intent, transactions, Windows takeover facts, diagnostics,
  and recovery. Mihomo remains the one managed data plane.
- FlClash is a dependency of this host. Do not stop, restart, configure, or
  take it over. Do not change this host's system proxy, TUN, DNS, firewall, or
  kill-switch as part of this plan.

## Allowed Scope

- Reproduce, classify, and repair a real or controlled Windows workflow defect
  in import, selection, connection, switching, disconnect, diagnostics, or
  recovery.
- Repair a UI freeze, permanent pending state, stale success claim, blocked
  navigation, or recovery failure discovered while executing that workflow.
- Add only the smallest redacted evidence or regression coverage needed to
  make a finding reproducible and to prove the repair.
- Extract one measured transaction or rendering owner from `main.rs`,
  `core_runtime.rs`, or `app.js` only when it is required to repair the proved
  defect. Remove the replaced path in the same task.
- Use an isolated Aegos data root, sanitized fixtures, local candidate, and
  existing browser/native harnesses. A dedicated recoverable Windows lab may
  be used only after it exists and its recovery procedure is approved.
- For CHANGE-027 only, create a normal Git commit containing the completed
  cumulative worktree and push the current branch to its configured origin
  after all source, candidate, context, and delivery gates pass.
- Remove an exact test-owned process tree and exact per-run temporary root only
  after their identity is revalidated. This narrow cleanup is part of the test
  lifecycle; general process-name, executable-path, prefix, or directory-wide
  cleanup remains excluded.

## Excluded Scope

- Signing, GitHub publishing, public release automation, automatic updates, or
  updater integration.
- WebDAV, cloud backup, synchronization, remote control, or remote execution.
- Windows ARM64, macOS, Linux, or a cross-platform abstraction.
- A second core, raw Mihomo Controller or runtime-YAML UI, arbitrary scripts,
  protocol implementation, or a rules engine.
- A broad UI redesign, framework migration, dependency installation,
  destructive cleanup, or any operation on FlClash. Commit and push remain
  excluded except for the exact CHANGE-027 completion commit above.

These are not a deferred queue. They require a future, explicit user route
decision and cannot displace a proven Windows reliability defect.

## Acceptance Integrity Contract

The acceptance standard is based on demonstrated failure modes, not arbitrary
larger numbers. A result is accepted only when all applicable clauses below are
satisfied. Missing evidence is `untested`, not passed.

### Evidence Freshness And Identity

- Every focused and full-matrix run records a validation run ID, command and
  arguments, exit code, UTC start/end time, Aegos version, Git `HEAD`, relevant
  dirty-worktree content digest, harness/gate digest, fixture and matrix mode,
  Windows and toolchain identity, and the host-side-effect boundary.
- Evidence is current only while its recorded product-input and gate-input
  digests equal the bytes being accepted. A relevant source, fixture, test,
  audit, threshold, or command change makes older evidence historical even if
  its version string and timestamp still look current. File modification time
  alone is never source identity.
- Raw local evidence stays under the ignored `.validation/` root. The WR-01
  register receives a redacted summary and digest; it must not contain local
  private paths, credentials, public IPs, or Controller secrets.
- A rerun does not erase a prior failure. The failure remains open until its
  cause or test defect is explained, a relevant change is made, and the failed
  layer plus its dependent gates pass again.

### Regression Sensitivity

- Every repaired defect needs a behavioral negative control: either preserved
  pre-repair failure evidence or a deterministic known-bad fixture that exits
  nonzero, plus a repaired fixture that passes. A source-string audit may
  supplement this proof but cannot replace runtime behavior.
- An observed P0/P1 cannot be closed because a later run did not reproduce it.
  It remains open until repaired with closure evidence or explicitly deferred
  by the user. Severity may change only from new impact evidence recorded in
  the register.
- A finding is not `repaired` if any required terminal path is untested, if a
  residual object is downgraded to a warning, or if recovery depends on a broad
  process/path scan that can affect an unrelated instance.

### Gate Immutability

- Passing may not be obtained by raising a budget, widening a timeout, removing
  or skipping an assertion, reducing fixture size, cycle count, page, window,
  DPI, failure path, or command, converting a failure to a warning, or deleting
  usable product behavior. A necessary gate edit must document why, show the
  before/after matrix, and prove that the known-bad control is still rejected.
- The verified Windows baseline is a floor, not a target to inflate: at least
  222 discovered Rust tests with 0 failed and 0 ignored; all seven pages across
  the existing 14 UI window/DPI combinations, including 920x640; the 800-node
  stress fixture and 420 navigation switches; and 16 soak cycles with all
  existing required command and job kinds. The observed 262 soak commands are
  evidence, not a hard minimum, because valid call coalescing can reduce calls.
- Current performance and terminal-state budgets remain unchanged. The two
  `clippy::lines_filter_map_ok` findings must become zero, while the remaining
  strict-clippy finding set must not grow from the recorded 35-warning baseline
  under the same recorded toolchain. This does not authorize broad lint work.

### Host And Delivery Truth

- Each isolated runtime case starts with a read-only process, listener, adapter,
  and relevant Windows-state snapshot and ends with the same unrelated-host
  identities. FlClash PID, creation time, executable identity, listeners, and
  adapters must remain unchanged. Aegos takeover remains false on this host.
- Structural installer checks and current-candidate checks are separate. The
  current-candidate claim additionally requires a source-bound provenance
  manifest, a fresh empty build target, unchanged build inputs across the
  build, the final artifact digest, and automated stale/tampered negative
  controls. The older 3.6.62 installer may pass structural history checks but
  must fail a `require-current` provenance check.
- No aggregate green result can override an open P1, an untested live-takeover
  fact, a stale digest, a missing command, or a nonzero required command.

## Milestones

| ID | Status | User-visible result | Start condition |
| --- | --- | --- | --- |
| WR-01 | completed | A trustworthy host-safe real-use and delivery baseline. Each examined journey records Aegos intent, managed-runtime fact, UI timing, terminal result, recovery outcome, test-process cleanup, and artifact provenance without claiming untested live Windows facts. | Completed by CHANGE-027. |
| WR-02 | completed | Every manual speed-test click paints immediate live numeric progress before real results, and cold-start navigation can leave Connections without waiting behind result rendering or startup work. | CHANGE-029 completed in the source-bound 3.6.67 candidate. |
| WR-03 | completed | Connection truth, failed recovery, background status availability, and interrupted-takeover evidence remain correct under controlled P1/P2 negative paths. | Closed with host-safe behavioral controls and affected gates; 3.6.67 Release remains historical baseline. |
| WR-04 | completed | The 3.6.67 UI distinguishes current effective network facts from measurement history without hiding diagnostics or connection management. | Closed with deterministic UI controls and fresh host-safe gates; installer and GitHub delivery remain historical evidence. |
| WR-05 | completed | A source-bound unsigned 3.6.68 installer and matching GitHub Release preserve the completed WR-03/WR-04 work without mutating v3.6.67 history. | Completed: source/tag `e4dd999f1d97ff079676f109900facceb7dfc572`; remote asset SHA-256 matches the recorded installer. |
| WR-06 | completed | The primary status surface uses conventional labels, untruncated protection language, and rolling measurement stability. | Completed: source/tag `ea655b417c2cb6e09d6d93f893912ec3afb41895`; remote unsigned asset SHA-256 matches the recorded installer. |

WR-03 is a host-safe code and isolated-fixture repair task. It is not authority
to perform controlled live takeover testing, which remains blocked until a
separate recoverable Windows environment and rollback procedure are available.

## WR-04: Repair Truthful, Low-Interference UI Workflows

1. Preserve known-bad UI controls before changing product code: a disconnected
   state with retained measurements and outlet data; an active takeover with
   unavailable connectivity; changing traffic while a non-Home page is active;
   a kill-switch state transition; default node-row action discovery; long
   profile metadata; and a public-address-shaped screenshot fixture.
2. Present current runtime, takeover, and connectivity fact separately from
   recent node measurement. Old node measurements may remain useful, but must
   be labelled as recent measurement and never imply an effective connection,
   protocol, proxy port, or outlet. Current outlet identity is shown only when
   verified; a retained observation is explicitly historical.
3. Keep Connections readable and operable in all states. The ordinary empty
   state is used only for verified usable takeover with no active connections.
   Pending or unavailable takeover must explain the condition and retain a
   route to diagnostics without hiding any real rows or close actions.
4. A persistent metric is either refreshed on every visible page or explicitly
   marked historical. Do not make background polling, navigation, diagnostics,
   or status-center access less responsive to obtain this result.
5. Model kill-switch as an explicit binary control with truthful state and
   existing permission/result handling. Keep node-row commands icon-first with
   tooltips and accessible names, but do not make enabled controls resemble
   disabled ones. Add current-page navigation semantics and an accessible full
   value path for truncated profile details.
6. Replace public-address-shaped UI smoke values with documentation-safe test
   addresses and prove UI, screenshot, and export fixture redaction. Do not
   hide real runtime facts merely to satisfy a screenshot assertion.
7. Keep the repair in `src/app.js`, `src/index.html`, `src/styles.css`, and
   focused smoke fixtures unless a proved contract gap requires an existing
   owner. Do not add a second state owner, new network command, or UI framework.

Exit: each known-bad control rejects the prior presentation and passes the
repair; fixed window/DPI, interaction, performance, soak, safety, architecture,
and planning gates pass without relaxed thresholds; no live host-network action,
installer, or publication occurs.

## WR-05: Source-Bound 3.6.68 Delivery

1. Bump package, Cargo, Tauri, and visible-shell versions together. Preserve
   `v3.6.67` and its uploaded asset as immutable historical evidence.
2. Run Rust formatting/tests, interaction, fixed-window/DPI UI, 800-node
   stress, soak, backend, responsiveness, stability, security, status,
   control-plane, architecture, planning, installer, and release-structure
   gates. Do not lower a limit or omit a failing gate.
3. Build the x64 NSIS installer from the accepted source, calculate its exact
   SHA-256 and size, and record both in `RELEASE_3.6.68.md`. The release must
   say that the installer is unsigned; do not claim a signed-trust result.
4. Commit the complete source and evidence set, push `main` to `origin`, tag
   the exact pushed commit `v3.6.68`, and create a GitHub Release targeting
   that tag. Upload only the hash-recorded installer; verify the remote asset
   digest and source target after upload.

Exit: every mandatory gate passes, installer bytes match the release note and
remote asset digest, and `v3.6.68` resolves to the exact source/evidence commit
that produced the asset. A post-publication evidence-only commit may follow on
`origin/main`; no host-network or FlClash action occurs.

## WR-06: Conventional Primary Status And Rolling Stability

1. Preserve deterministic known-bad controls for the clipped sidebar labels,
   the `核心待命`/`尚未接管系统流量` primary copy, the abbreviated or `未开启`
   disconnect-protection presentation, and a one-sample relative stability
   rating that contradicts a stable 10/30-minute history.
2. Replace only the primary-surface vocabulary with `延迟`, `稳定性`, and
   `落地 IP`. Keep detailed effective-state and recovery evidence available in
   status center and diagnostics; do not claim connection where runtime facts
   do not support it.
3. Make the sidebar metric grid guarantee full readable labels and values at
   every existing fixed window/DPI configuration. Do not hide a label merely
   to make the visual check pass.
4. Store bounded per-node latency observations and derive stability from
   10-minute and 30-minute rolling average/deviation evidence. A node whose
   observations remain near its rolling mean is high stability; materially
   volatile or insufficient history is never shown as high. The model remains
   measurement-only and cannot change a node or network state.
5. Run focused behavior controls plus the unchanged Rust, interaction, fixed
   window/DPI UI, 800-node stress, soak, responsiveness, stability, security,
   control-plane, architecture, planning, installer, and release gates.
6. Build source-bound unsigned `3.6.69` NSIS bytes, record exact size/hash,
   push the source/evidence, tag the source commit `v3.6.69`, create a new
   GitHub Release, and verify its remote target, asset size, and SHA-256.

Exit: every known-bad control rejects the previous behavior; all existing
matrix floors remain intact; labels and values fit without clipping; the
artifact and public release match exact bytes; and no live host-network or
FlClash action occurs.

## WR-01: Establish The Real-Use Defect Baseline

### Detailed Action Route

Execute these stages in order. A later stage cannot be used to hide an open
failure in an earlier one.

#### WR01-A0: Freeze The Evidence Contract

1. Create one redacted evidence schema for process/listener snapshots,
   focused regressions, full-matrix reports, and candidate provenance. Separate
   Aegos intent, managed-runtime, Windows, connectivity, UI, recovery, and
   artifact facts rather than collapsing them into one pass flag.
2. Record the current test/gate matrix, its content digest, the 222-test/14-UI-
   configuration/800-node/420-navigation/16-soak-cycle floors, toolchain
   versions, Git baseline, dirty input state, and the exact shared-host limits.
3. Add `tools/wr01-acceptance.js` and its `audit:wr01-acceptance` package
   command. The runner only orchestrates and verifies the required commands and
   evidence identities. It must fail on a missing command, nonzero exit,
   reduced matrix, stale digest, omitted report, or open P1; it must not rewrite
   a failed report into a pass.

Exit: a deliberately missing report, stale digest, reduced fixture, and open-P1
fixture are each rejected by the acceptance runner. No product code or host
network state changes in this stage.

#### WR01-A1: Reproduce And Bound The Managed-Core Leak

1. Use a persistent parent harness to start a worker with a unique run ID,
   exact temporary root, reserved localhost ports, and one sentinel instance
   that uses the same Mihomo executable but a different root. The parent, not
   the worker's `Drop`, owns final assertions.
2. Capture PID, creation time, normalized executable, complete command line,
   root/config identity, parent/child tree, and listeners. Never identify the
   target from process name, executable path, port, or path prefix alone.
3. Exercise independent fresh roots for normal stop, panic while the manager
   mutex is held and poisoned, external interruption after child spawn but
   before Controller readiness, and external interruption after Controller
   readiness while a runtime transaction is active. The parent must confirm the
   exact child is alive for the pre-Controller case and the expected Controller
   listener is ready for the transaction case; a pre-spawn kill is invalid.
4. Preserve the current failure as a negative control. Also make the post-run
   detector fail nonzero when one exact target process, listener, or root is
   deliberately left behind.

Exit: the defect is deterministic or its already-observed residue remains open
with a detector that reliably rejects it. Sentinel, unrelated Aegos, FlClash,
and Windows takeover state are unchanged.

#### WR01-A2: Repair Exact Lifecycle Ownership

1. Put supervision and exact process identity in the responsible bounded
   process/lifecycle module. Do not grow `main.rs` or `core_runtime.rs`; remove
   replaced path-only cleanup and keep one lifecycle path.
2. Repair both proved weaknesses: poisoned-lock cleanup cannot silently skip,
   and stale-core recovery cannot stop every process that shares
   `mihomo.exe`. Cleanup is bounded, idempotent, validates PID creation time and
   exact run identity, waits for process/listener exit, then removes only that
   run's root.
3. Repeat the A1 matrix. Each run must leave zero owned process, child,
   listener, or root; a second cleanup succeeds with zero targets; a new run can
   reuse the released ports; the sentinel and FlClash identities remain stable.
4. Only after the repair passes, revalidate PID, creation time, executable,
   exact command root, and listeners for each of the four recorded historical
   residues. Remove only identities that still match, then prove their exact
   roots/listeners are gone. PID reuse or any mismatch blocks cleanup and is
   reported; no broad fallback is allowed.

Exit: known-bad lifecycle cases fail before the repair and all normal, poisoned
panic, and two external-interruption cases pass after it, with no collateral or
host-network change.

#### WR01-A3: Make Core Log Read Failure Terminal

1. Move the duplicate stdout/stderr loop into one bounded reader owner. Inject
   a scripted `BufRead` sequence: valid sensitive line, first `Err`, then a
   forbidden sentinel read. The current flatten behavior must fail this control.
2. On the first read error, stop reading, emit at most one sanitized Aegos
   diagnostic, expose a joinable/observable terminal result, and keep core
   stop/reap/status/diagnostics usable. Cover stdout/core and stderr/warn,
   normal EOF, repeated error, invalid UTF-8, redaction, and the existing
   700-entry bound.
3. Run the focused tests and targeted clippy lint. A timeout or CPU sample is
   supplemental only; the deterministic read-call count and forbidden sentinel
   prove that no retry loop remains.

Exit: the known-bad reader is rejected, repaired normal/error paths pass, both
`Lines::flatten` findings are absent, and no new strict-clippy finding appears.

#### WR01-A4: Close Local Repository Contamination

Add `.vs/` to `.gitignore` without deleting local files. Prove `.vs/` is
ignored, no `.vs` path is tracked, and the candidate input enumerator excludes
IDE, validation, target, and generated-report state.

Exit: local IDE state cannot enter source, provenance, or candidate evidence.

#### WR01-A5: Add Source-Bound Candidate Provenance

1. Add `tools/candidate-provenance-audit.js` and generate a deterministic
   `productInputDigest` from sorted relative paths, sizes, and SHA-256 values
   for `src/**`; `src-tauri/src/**`; `src-tauri/build.rs` when present;
   Cargo/npm manifests and lockfiles; Tauri config, capabilities, icons; and
   every resolved bundle resource, including Mihomo. Include untracked product
   inputs and detect additions, deletions, and renames.
2. Generate a separate `gateInputDigest` for the executed tools, fixtures,
   package commands, and active acceptance contract. Gate changes require a
   new validation run; they do not falsely claim that unchanged product bytes
   need rebuilding.
3. Record version, validation/build IDs, UTC interval, Git/dirty summary,
   target triple, config overlay, locked toolchain versions, build command,
   both input digests, core digest, and final artifact path/size/SHA-256. Store
   no secret or private absolute path. Do not call this bit-reproducible or a
   third-party attestation.
4. Add deterministic negative fixtures: one-byte source drift; added, removed,
   or renamed product input; changed Mihomo; stale validation after gate change;
   wrong version/target/overlay/build ID; tampered artifact; and mtime-only
   change. All except the mtime-only control must fail `require-current`.

Exit: the old 3.6.62 installer is accepted only as historical and is rejected
as current; every stale/tampered fixture fails while the unchanged fixture and
mtime-only control pass.

#### WR01-A6: Validate, Freeze, Build, And Revalidate

1. Confirm every P1 is repaired or explicitly deferred by the user. Allocate
   the next unused patch version and update package, Tauri, Cargo/lock, and the
   release-note skeleton before validation; a version change after validation
   invalidates that validation.
2. Run focused regressions, then the complete host-safe source matrix below.
   All reports must share the final `productInputDigest`, `gateInputDigest`, and
   validation run ID. Any source/gate change invalidates the affected layers.
3. Freeze the product inputs and create a versioned, empty target/staging
   directory; the intended output path must not already exist. Do not reuse the
   old bundle. Build the next versioned local NSIS candidate. Recompute inputs
   after the build; drift fails the candidate and returns to step 1. Bind the
   artifact digest to the successful validation and provenance manifest.
4. Run candidate provenance, installer structure/regression, release, and
   unsigned local trust checks. Recheck both input digests and the artifact
   digest after evidence/release-note updates. A later product or gate change
   invalidates the applicable claim and restarts from its owning step.

Exit: one current local artifact has fresh source-bound evidence and all
required gates pass. Signing, publication, and live host takeover remain out of
scope; `verify:release` is not used because it requires the excluded signed-
distribution lane.

### Exit Evidence

- The evidence register distinguishes tested, repaired, and untested paths.
- Each reproduced defect has severity, expected versus observed effective
  state, recovery behavior, owner, regression command, and redacted artifact.
- There is no permanent pending operation, false connected state, or page-wide
  freeze in any tested journey. An untested live Windows takeover is stated as
  an environment limit.
- Isolated journeys leave no managed Mihomo process, listener, or temporary
  root after normal completion, panic, or a controlled interrupted runner.
- Any installer described as current is built after the final product-source
  change and has deterministic source-bound provenance evidence in addition to
  its digest.
- Any repair keeps one command path and one state owner; the control-plane
  budget passes without a raised limit or deleted assertion.
- Every repaired finding has a failing known-bad control and a passing repaired
  control, and every accepted report matches the final product/gate digests.
- The fixed baseline matrices are not reduced, no required command is skipped,
  and no first failure is hidden by an unexplained rerun.

## WR-02: Close A Reproducible Defect

This task starts with the two concrete CHANGE-028 entries in
`docs/work/windows-reliability-wr02.md`. They name the user journey, failure
trigger, expected and observed visible states, owner candidates, and focused
regression before product code changes begin.

P0 and P1 defects take precedence over P2 polish. A freeze, blocked navigation,
optimistic success, permanent pending state, non-recoverable rollback, orphaned
managed process, or falsely current delivery artifact is a P1 until evidence
proves otherwise. The fix must preserve browsing and diagnostics during
background work, remove any replaced path, and re-run the affected journey plus
the full gate matrix below.

### WR-02 Acceptance Route

1. Preserve a failing behavioral reproduction for repeated speed-result
   events that arrive inside the current visible-update throttle window. A
   second run must receive a new run ID, immediately show an observable
   testing state, paint progressive results without waiting for terminal
   completion, and never lose a deferred visible update.
2. Reproduce startup navigation while initial status, node data, prewarming,
   and background prefetch can overlap. Nodes and Connections must activate
   synchronously without a main-thread task over 50 ms; their first frame must
   remain within 50 ms in the representative native probe, and loading/content
   progress must be visible rather than presenting a frozen page.
3. Repair the smallest owning UI scheduling or measurement event path. Do not
   change probe semantics, connect or switch nodes during measurement, widen a
   budget, or extract unrelated Mihomo/controller behavior.
4. Run the focused repeated-speed and cold-navigation regression first, then
   interaction, stress, native enabled/suppressed, responsiveness, stability,
   control-plane, security, and the complete 25-command source-bound matrix.
5. After final source and gate bytes settle, bump the candidate version, build
   once in a new empty target, bind provenance, and run installer/release
   structure gates. The artifact remains local and unsigned.
6. Preserve a 3.6.66 negative control in which the first real probe is delayed:
   the test must fail when the UI shows only a static testing label. The repair
   must paint a clearly labelled elapsed value within the first actionable
   frame and advance it at least twice before the delayed real result arrives;
   elapsed progress must never be presented as measured latency.
7. Preserve a cold-start Connections negative control with delayed and large
   response preparation. A user input that leaves Connections must paint the
   destination within 50 ms, connection rendering must be cancellable/chunked,
   and stale work must not mutate the hidden page after navigation.

## WR-03: Close Current-Code Reliability Findings

1. Preserve deterministic negative controls for every P1/P2 found by the
   current-code review. At minimum they must reject: connected presentation
   without usable connectivity, exhausted recovery that changes the selected
   node, a blocked runtime mutation that delays status/diagnostic reads, an
   unreadable active-takeover marker, and a rejected profile switch that clears
   the active profile's speed state.
2. Make visible connection state depend on takeover and the normalized
   `networkUsable` fact. A pending, unavailable, or unverified observation is
   never rendered as connected.
3. Snapshot runtime state before slow recovery probes. Long controller or
   network work must not hold the `CoreManager` mutex while status, diagnostics,
   Connections, or navigation request a read. Use the existing coordinator for
   mutation exclusivity without inventing another command model.
4. Capture and restore the complete selected-proxy map when recovery candidates
   are exhausted. A failed repair must either restore the pre-recovery state or
   return explicit recovery-required evidence; it cannot silently persist the
   last failed candidate.
5. Treat an unreadable active-takeover marker as a visible recovery incident,
   not an empty state. Preserve the marker for manual evidence and prevent
   automatic takeover mutation until it is resolved.
6. Preflight a target profile before cancelling or clearing the active
   profile's speed state. Replace direct poisoned-lock unwraps on repaired
   public/worker paths with product errors; remove confirmed dead code only
   where it has no product behavior.
7. Keep extraction scoped to the proved paths. Do not raise the control-plane
   budget, add a second state owner, or use source-string checks as the sole
   acceptance evidence.

Exit: every WR-03 negative fixture fails before its repair and passes after it;
affected Rust, interaction, responsiveness, runtime, security, architecture,
and planning gates pass; no P1 remains open. The published v3.6.67 artifact is
not relabelled as built from changed source.

## Completion Rules

- If WR-01 finds no reproducible defect, it may close only with an explicit
  tested/untested register and then waits for user review. It does not invent
  WR-02 work.
- If WR-01 or WR-02 finds a P0/P1, every such finding must be repaired or
  explicitly deferred by the user before the plan can close.
- WR-03 closes only when every CHANGE-032 P1/P2 has a repaired behavioral
  control, no open P1 remains, and the current code has passed its affected
  host-safe gates. A new installer or publication requires separate user
  authorization.
- WR-04 closed after its state-truth, stale-summary, action-discoverability,
  accessibility, and fixture-redaction controls passed with fresh UI evidence.
  A changed installer or GitHub delivery was neither required nor authorized.
- `not reproduced` cannot close an already observed P0/P1. A missing negative
  control, stale report, open residual process, or provenance mismatch is an
  incomplete task, not a warning-level completion.
- Do not start controlled host takeover, feature work, updater work, or
  platform work after this plan. `on_complete: wait` is deliberate.

## Validation

Run the focused reproduction first. The focused commands introduced by A2 and
A3 must remain independently runnable and use one test thread where process
identity or reserved ports are involved:

~~~powershell
cargo test --manifest-path src-tauri/Cargo.toml wm03_cleanup_ -- --nocapture --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml core_log_reader_ -- --nocapture
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D clippy::lines_filter_map_ok
~~~

After the final source and gate change, complete this host-safe source matrix.
The WR-01 acceptance runner added in A0 must execute or verify every line rather
than merely search for its script name:

~~~powershell
git diff --check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
node --check src/app.js
node --check tools/wr01-acceptance.js
node --check tools/candidate-provenance-audit.js
npm audit --json
npm run smoke:interactions
npm run smoke:ui
npm run smoke:perf:stress
npm run smoke:soak
npm run smoke:perf:native -- --automatic-speed=enabled
npm run smoke:perf:native -- --automatic-speed=suppressed
npm run audit:backend
npm run audit:responsiveness
npm run audit:stability
npm run audit:security
npm run audit:ipv6-dns
npm run audit:outbound-ip
npm run audit:core-runtime
npm run audit:runtime-regression
npm run audit:control-plane
npm run audit:architecture
npm run audit:planning-context
npm run audit:local-backup
~~~

After the source matrix passes, freeze inputs and build in a new versioned
target/staging directory. The following delivery gates run against that exact
artifact and manifest; they do not make the historical 3.6.62 artifact current:

~~~powershell
npm run audit:wr01-acceptance
npm run audit:candidate-provenance -- --require-current
npm run audit:installer-regression
npm run audit:installer
npm run audit:release
npm run audit:release-trust
~~~

`audit:wr01-acceptance` and `audit:candidate-provenance` are required outputs of
this task. Their JavaScript syntax and known-bad fixture suites must pass before
they count as gates.

## Decision History

| Change | Class | Effect |
| --- | --- | --- |
| CHANGE-001 through CHANGE-019 | Historical | Completed control-plane and Windows Maturity decisions. Their release notes and evidence registers remain traceability records only. |
| CHANGE-020 | roadmap_change | Replaces the completed Windows Maturity plan with one Windows real-use reliability route. It retains the delivered baseline, removes signing, updates, synchronization, and platform work from any queued continuation, and activates WR-01 as the only current task. |
| CHANGE-021 | task_adjustment | Keeps the Windows reliability route and makes WR-01 actionable from the 2026-07-26 audit: close isolated managed-process leakage, fault-inject the core log reader, stop treating the older installer as a current-worktree build, and require source-bound local candidate evidence before delivery. |
| CHANGE-022 | task_adjustment | Keeps WR-01 and strengthens its execution and acceptance integrity at the user's request. It adds ordered A0-A6 stages, deterministic known-bad controls, immutable verified matrix floors, content-bound evidence freshness, exact no-collateral process criteria, and a source-bound candidate gate so stale or weakened evidence cannot pass. |
| CHANGE-027 | task_adjustment | Closes the six identified completion gaps as one unit: executable evidence, current full matrix, consistent authority records, a source-bound unsigned installer, a recoverable Git baseline, and one push to the configured GitHub origin. It does not authorize a GitHub Release, signing, automatic updates, or live takeover. |
| CHANGE-028 | task_adjustment | Activates WR-02 for two bundled user-reported responsiveness defects: delayed or apparently unchanged repeated speed-test feedback, and first-entry stutter on Nodes/Connections after startup. It permits focused repair, regressions, full host-safe validation, and one unsigned local installer, but no Git or publication action. |
| CHANGE-029 | task_adjustment | Reopens WR-02 because the 3.6.66 acceptance missed immediate numeric pre-result feedback and cold-start navigation away from Connections. Both paths require deterministic negative controls, focused repair, the unchanged full matrix, and a new local unsigned installer; Git, publication, and live takeover remain excluded. |
| CHANGE-030 | task_adjustment | The user explicitly authorizes one commit and push of the accepted 3.6.67 source, regression coverage, authority records, and redacted evidence to `origin/main`. GitHub Release, artifact upload, signing, automatic updates, live takeover, and new product work remain excluded. |
| CHANGE-031 | task_adjustment | The user explicitly authorizes one public `v3.6.67` GitHub Release and upload of the exact accepted unsigned NSIS asset. The release body must disclose the unsigned status and SHA-256. Signing, automatic updates, live takeover, and new product work remain excluded. |
| CHANGE-032 | task_adjustment | The user directs repair of the current-code review findings. WR-03 covers truth-state presentation, recovery rollback and read availability, active-takeover corruption, rejected profile state preservation, and focused lock/dead-code cleanup with behavioral negative controls. Release, installer, GitHub publication, signing, automatic updates, live takeover, and FlClash changes remain excluded. |
