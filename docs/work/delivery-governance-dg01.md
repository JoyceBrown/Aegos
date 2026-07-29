# DG-01 Delivery Governance Evidence

record_kind: evidence_register
evidence_state: in_progress
task_id: DG-01
change_id: CHANGE-052
plan_id: AEGOS-WINDOWS-RELIABILITY
execution_authority: none
active_plan: ../../PLANS.md
updated_at: 2026-07-29

## Objective And Boundary

DG-01 makes the completed v3.6.70 closure and v3.6.71 license/source state
durable, establishes whether this host already exposes an isolated Windows
acceptance environment, and adds a minimal independently reviewable Windows
CI lane.

Public release, tags, installer upload, certificate purchase, signing,
installation, Aegos launch, Windows feature enablement, VM creation/start,
live takeover, host-network mutation, and every FlClash action are excluded.

## Source And License Closure

- Exact commit: `90a17ea` (`chore: close 3.6.71 license packaging`), 45 files.
- Push: `origin/main` advanced from
  `01fd0151a9b7a79f793ff5b009676c546874fdd1` to the source-closure commit.
- Exact staged review excluded every `.tmp-*`, `CodexProviderPanel*`,
  `panel-*-preview*.png`, and
  `research/2xapi-sub2api-architecture-2026-07-28.md` path.
- Final pre-commit host-safe run
  `wr01-20260729071254-7808` ran from
  `2026-07-29T07:12:54.432Z` through
  `2026-07-29T07:16:24.128Z`; all 32 commands passed with 232 Rust tests,
  13 product journeys, all 14 window/DPI configurations, 800 nodes/420
  navigation switches, 16 soak cycles, and both native modes.
- Product input digest:
  `484b1923a71da394e9661d9ce07d26e5b1a18b2a926be89d1be4d2931f534316`.
- Gate input digest:
  `73feef4055a0a37320c1fdc9a79ada404215b68adf844625375ed0d6aa9bced6`.
- Candidate provenance, 9/9 direct NSIS payload matches, installer regression,
  installer, release, and unsigned trust gates all exited 0 against the same
  16,399,892-byte candidate and SHA-256
  `a3215fbdc3f08db76c57ab193cf8ef7b4aabd1236518697785d2788fa52bc887`.
- The standard project-context validator exited 0 with 0 errors. Its 28
  retained prompts are existing Cargo manual-verification and indexed
  historical-planning warnings.

The extra staged whitespace check reported six trailing spaces inside the
generated aggregate of upstream Rust license/notice text. Those upstream
license lines were preserved; no repository-wide whitespace or line-ending
normalization was mixed into DG-01.

## Isolated Windows Capability Probe

Read-only inspection found:

- Windows 11 Enterprise x64, version `10.0.26200`, build `26200`;
- `HypervisorPresent=true`; Hyper-V, its platform/hypervisor, and Virtual
  Machine Platform report enabled; the `vmms` service is running and automatic;
- Windows Sandbox reports disabled and
  `C:\Windows\System32\WindowsSandbox.exe` is absent;
- the Hyper-V PowerShell module is installed, while VirtualBox `VBoxManage`
  and VMware `vmrun` are absent and no matching installed product was found;
- the current identity `JIE\JIE` is not elevated, the local Hyper-V
  Administrators group is empty, and read-only `Get-VM`, `Get-VMHost`, and
  `Get-VMSwitch` calls all returned the same required-permission error.

Result: Hyper-V infrastructure exists, but this task cannot determine whether
an existing disposable VM is available. The minimum user action is to grant
the account Hyper-V Administrators membership and sign out/in, or run a later
read-only probe from an elevated PowerShell. If `Get-VM` then returns no
disposable Windows 10/11 VM, creating one requires separate explicit authority.
Windows Sandbox remains disabled and was not enabled.

## Host Boundary

Before and after the host-safe matrix, the pre-existing FlClash PID `6864`
(started `2026-07-29 14:32:13 +08:00`) and pre-existing Aegos PID `21440`
(started `2026-07-29 14:40:46 +08:00`) retained the same identities. Neither
was started, stopped, restarted, inspected through its UI, or sent a command.
No Cargo or rustc process remained after validation.

## Windows CI

The pending workflow is `.github/workflows/windows-ci.yml`. It uses
least-privilege `contents: read`, no secrets, no `pull_request_target`, a
35-minute job timeout, same-ref concurrency cancellation, pinned action commit
SHAs, exact Node/Rust toolchains, and only npm's download cache. It does not
cache `node_modules`, Cargo targets, installers, validation reports, or
credentials.

It covers Rust formatting/tests, every tracked JavaScript file's syntax, npm
security, architecture, control-plane, debt, planning, license, and the
existing license/subscription/acceptance/provenance negative fixtures. Native
UI, soak, packaging, publication, and live Windows takeover remain separate
local/release/lab lanes.

The first pushed workflow run, `30432914806` at commit `6bc48e5`, is retained
as failed evidence. Rust formatting/tests, all tracked JavaScript syntax, npm
security, architecture, and control-plane checks passed, but `audit:debt`
failed on the clean Windows checkout because its test-module boundary matched
only LF while checkout materialized CRLF. That made two test-only `fs::write`
fixtures look like production writes. The repair makes the boundary explicitly
LF/CRLF tolerant and adds deterministic controls proving that LF and CRLF test
writes are ignored while production `fs::write`, production `fs::copy`, and a
missing test boundary still fail closed. The failed run is not reclassified or
hidden by a retry.

The second pushed workflow run, `30433739435` at repair commit `e7fc324`,
proved the debt repair and its bad fixtures on the clean runner, then failed at
`audit:licenses`. Repository-retained upstream fallback license texts were
hashed as raw checkout bytes, so CRLF materialization changed the pinned digest
even though the text was unchanged. The repair canonicalizes only CR/LF line
endings for those two repository text files while keeping Cargo-cache license
hashes byte-exact. Its fixtures require identical LF/CRLF pin results and still
reject a one-byte text mutation. This second failure also remains historical
evidence rather than being overwritten by a later run.

The third pushed workflow run, `30434882044` at repair commit `0188d02`,
passed Rust formatting/tests, all tracked JavaScript syntax, npm security,
architecture, control-plane, debt plus its bad fixtures, and planning before
failing at `audit:licenses`. The root Aegos and retained Mihomo GPL texts still
used raw checkout bytes and byte counts, so their LF provenance pins rejected
CRLF checkout material. The follow-up applies the same CR/LF-only text
canonicalization to these two repository GPL files, checks their canonical
35,149-byte identity, and adds an integrated CRLF audit control while keeping
tampered GPL text rejected. The third failed run remains historical evidence.

## Exact Next Action

Validate the workflow and updated gate inputs locally, commit and push the CI
change separately, observe its GitHub Actions result, then close DG-01 with an
evidence-only context update. Do not enable a Windows feature, create or start
a VM, publish, sign, install, launch Aegos, affect FlClash, or change the host
network.
