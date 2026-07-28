# REL-01 Release Evidence Register

record_kind: evidence_register
execution_authority: exclusive
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: REL-01
change_id: CHANGE-050
evidence_state: in_progress
opened_at: 2026-07-28T11:49:45Z
updated_at: 2026-07-28T16:15:07Z
base_git_head: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
candidate_version: 3.6.70
host_boundary: Host-safe fixtures, isolated native probes, local build output,
  and Git/GitHub delivery only. No installation, Windows takeover, proxy, DNS,
  firewall, TUN, kill-switch, FlClash, or host-network action.

## Scope

REL-01 authorizes one fresh source-bound unsigned `3.6.70` x64 installer,
one accepted source/evidence push, and one matching GitHub Release asset. It
does not authorize installation, signing, FlClash changes, or host-network
changes.

## Retained Failure Closure

- Acceptance runs `wr01-20260728105811-18644` and
  `wr01-20260728113902-3188` are retained as nonzero pre-fix evidence. Their
  deterministic Connections journey observed a newer connection snapshot,
  then applied a delayed no-takeover status snapshot and rejected the disabled
  close action.
- The repair records observation ownership for the visible connection
  snapshot. A stale status-count refresh may no longer overwrite its supported
  actions. The same behavioral assertion remains in
  `tools/interaction-smoke.js`; no action or gate was deleted.

## Current Local Evidence

- Source baseline: `941d1f6fc591a0c89709948a42e4e6a6cbcf5564`
  with the recorded dirty Aegos product, test, evidence, and authority set.
- The post-fix acceptance run `wr01-20260728114945-18560` ran from
  `2026-07-28T11:49:45.786Z` through `2026-07-28T11:55:01.388Z`. All 30
  required commands exited 0: 232 Rust tests, 13 product journeys, 14 fixed
  window/DPI configurations, 800 nodes/420 navigations, 16 soak cycles, both
  native modes, and every backend, responsiveness, security, runtime,
  control-plane, architecture, routing, connection, debt, and planning gate.
- Because the release note and authority inputs were still bound to the old
  candidate, REL-01 does not treat that successful run as final publication
  evidence. A new complete matrix must bind the settled inputs.
- `npm run build` ran after that source acceptance, from approximately
  `2026-07-28T11:56:01Z` through the artifact write at
  `2026-07-28T11:59:24.237Z`.

## Artifact Identity

- Path:
  `src-tauri/target/release/bundle/nsis/Aegos_3.6.70_x64-setup.exe`
- Name: `Aegos_3.6.70_x64-setup.exe`
- Size: `16,341,772` bytes
- SHA-256:
  `9c6ebab99f9c80792e3e2b9d6ab766c55fcac5092aa19575bb27cb87126ef261`
- Authenticode status: `NotSigned`; this is an explicitly unsigned candidate.
- The candidate is not installed and has not changed FlClash or host
  networking.

## Pending Closure

- Commit and push the accepted in-scope set to `origin/main`.
- Publish `v3.6.70` with this exact installer and SHA-256, then verify the
  public tag, target commit, asset byte count, and downloaded digest.

## Final Local Acceptance

- Final run `wr01-20260728160831-15884` ran from
  `2026-07-28T16:08:31.117Z` through `2026-07-28T16:12:51.717Z` against the
  settled release and authority inputs. Source digest:
  `e4ac7cd3dccb35b58367c7b1b137b380e14e2d5d1270bf311f2ac547400383fd`;
  gate digest:
  `3b6be77a478b6b16917ffa8f52b5937961907229f0fe5a098d3ee55f4a469df0`;
  immutable matrix digest:
  `ce18496398c2bb4205bcdfd90cc5cbbbdb94acc994f62b1a48a332d9c6c6aab9`.
- All 30 commands exited 0. The run retained 232 passing Rust tests, 13
  product journeys, all 14 fixed window/DPI configurations, 800 nodes and
  420 navigations, 16 soak cycles, both native modes, zero residual test roots,
  and no open P0/P1.
- Candidate provenance binds that acceptance report, the current product and
  gate records, build `rel01-build-20260728115924`, the bundled Mihomo digest,
  and the exact installer bytes. `audit:candidate-provenance`,
  `audit:installer`, `audit:release`, and `audit:release-trust` exited 0.
- The acceptance known-bad fixtures rejected stale gate digests, reduced or
  missing commands, fake/tampered logs, mid-run input drift, and an open P1.
  The provenance fixtures rejected source/gate/artifact/acceptance tampering
  and proved that mtime-only changes do not refresh content identity.
- The only matching live process after the matrix was the pre-existing
  `FlClash.exe` PID 13184. No Aegos, Node, Cargo, or Rust test process
  remained; FlClash was not stopped, restarted, reconfigured, or taken over.
