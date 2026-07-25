# Aegos 3.6.54

## Scope

- Keep the 3.6.53 visual, subscription, fixed-node, routing, and control-plane
  baseline.
- Make the first-screen node identity and runtime state truthful during empty,
  loading, and transient-failure states.
- Remove invalid actions and background observation collisions that users can
  perceive as unresponsive or misleading behavior.

## Changes

- The current-node badge is no longer hard-coded to Hong Kong. Node name and
  region now update together from the selected runtime node.
- A subscription name is never substituted for a missing node. Empty and
  loading states explicitly say that no node is selected or node data is still
  loading.
- A transient `app_status` failure preserves the last verified runtime
  snapshot and displays a stale-data warning instead of fabricating a stopped
  core, empty subscription list, and default profile.
- Node-list refresh failures also retain the last usable node snapshot.
- Home and status-center notices state connection truth directly and no longer
  prefix the message with the inactive protection label.
- Connection close, subscription update, diagnostic copy/export, and node
  speed-test commands are disabled when they have no valid target.
- Manual connection refresh no longer passes its click event as a stale page
  token. Failed connection loads remain retryable instead of caching the error
  for 15 seconds.
- Connection counts and action availability reconcile immediately after
  closing one or all connections.
- Region and resident-action context menus expose menu roles, keyboard
  `ContextMenu` and `Shift+F10` entry, arrow/Home/End navigation, initial focus,
  Escape close, and trigger-focus restoration.
- The shared runtime notice is a polite atomic live region.
- Job, active-connection, status, and recovery observations now use one
  staggered scheduler that starts at most one background observation per
  scheduler cycle.
- Key read-only Rust command boundaries return lock-poison errors instead of
  panicking, allowing the UI to retain its last verified snapshot.
- Release gates now cover dynamic node identity, truthful stale status,
  empty-state commands, context-menu accessibility, and staggered polling.

## Verification

- 189 Rust unit tests passed.
- JavaScript syntax checks passed for the application and routing UI module.
- Full interaction smoke passed, including transient status failure, dynamic
  node identity, empty-state commands, keyboard customization, startup
  measurement-only speed testing, subscription lifecycle, fixed-node editing,
  routing, diagnostics, and background jobs.
- UI smoke passed across 920 x 640 through 1700 x 900 and 1.0 through 2.0 DPI
  with no horizontal overflow, text overflow, clipped controls, or missing
  icon labels.
- Performance smoke passed with 420 rapid navigation changes at about 0.3 ms
  P95, bounded node DOM, three retained intervals, and no failed budget.
- Cargo check, Cargo clippy, release build, product audits, security audits,
  and release audits passed.
- FlClash was not stopped or modified during development, testing, or
  packaging.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.54_x64-setup.exe`
- Size: `16213617` bytes
- SHA-256: `1308e54bceabbe4e2b7ca5e0eec76729ceca521169ea851403c18dc2ef874d05`
- Signature: unsigned open-source build

## Known Limits

- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Real-device long-duration stability was not used as a release blocker
  because the current test host has known disk, CPU, and memory constraints.
