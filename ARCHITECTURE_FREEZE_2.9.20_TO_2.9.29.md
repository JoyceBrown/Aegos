# Aegos 2.9.20 - 2.9.29 Architecture Freeze

This file is the freeze record for the 3.0 foundation lane. From 2.9.20 onward, Aegos is not adding major user-facing features. Work is limited to bug fixes, tests, architecture cleanup, and security hardening until the 3.0 gate is passed.

## 2.9.20 Feature freeze

### Freeze inventory
- No new major pages before 3.0. Strategy/routing UI, rule editor, IPv6 automation, and advanced shortcut customization stay out of scope.
- No new connection semantics. Connect, disconnect, system proxy, TUN, and disconnect protection must keep their current user meanings.
- Speed tests are measurement-only. They may update delay, recommendation, low-latency lists, health metadata, and last-tested time, but must not switch or connect a node.
- Diagnostics, logs, subscription updates, outbound IP lookup, and speed tests must run as background work without locking navigation.
- The 3.0 pre-release lane only accepts changes that reduce bugs, remove duplicated logic, add tests, or close a security gap.

### Known risk list
- `src-tauri/src/main.rs` and `src/app.js` are still large files. The important models are now guarded by audits, but module extraction remains a 3.x cleanup target.
- Frontend rendering still uses template strings in several list renderers. Dynamic values are escaped and dangerous insertion APIs are audited, but a future DOM-builder rewrite would reduce XSS review cost.
- Some backend commands remain exported for compatibility and test coverage. The frontend release path must continue to use the background job model rather than direct legacy invokes.
- Windows firewall, system proxy, and TUN are OS-level operations. Transactional rollback is required, but failures can still depend on local policy, antivirus, or privilege state.
- Subscription content is untrusted input. Parser/preflight/rollback coverage exists, but new airport formats can still reveal parser gaps.
- Smart-mode outbound IP lookup depends on internal current-node routing. This should remain covered by integration and smoke tests whenever strategy-group behavior changes.

### Architecture cleanup list
- Fence old profile-patching paths that mutate the source subscription directly, then remove them during the lower-risk 3.x module extraction pass.
- Keep one connection truth surface: core running, traffic takeover, system proxy applied, TUN, disconnect protection, current node, and outbound IP known state.
- Keep one background task entrypoint for long work: connection, subscription, speed test, diagnostics, outbound IP, settings changes.
- Keep one frontend interaction layer for optimistic state, pending state, rollback, and error display.
- Keep one config generation chain: preflight, runtime copy/render, hot reload, verification, rollback.
- Keep one diagnostics/logging layer with user logs, debug logs, core logs, diagnostic reports, and default redaction.
- Keep one security audit script that checks CSP, ACL/capabilities, controller binding, allow-lan, secret handling, log redaction, and PowerShell boundaries.

### Initial security threat model
- Assets: subscription URLs and tokens, node passwords, Windows proxy settings, firewall rules, local controller secret, runtime profile files, user logs, diagnostic exports, outbound IP data.
- Trust boundaries: UI WebView, Tauri command bridge, Aegos backend, mihomo controller, Windows system proxy, Windows firewall, remote subscriptions, remote IP/speed-test endpoints.
- Primary threats: malicious subscription input, token leakage in logs, controller exposure beyond localhost, stale firewall rules, system proxy left behind after failure, command injection through PowerShell arguments, dangerous HTML rendering of node names, config path traversal, denial of service through repeated background jobs.
- Current controls: localhost controller binding, default `allow-lan: false`, generated controller secret, capability-limited Tauri window permissions, CSP, centralized PowerShell launcher with escaping, system proxy snapshots and repair, firewall wrappers with named rules, preflight before config apply, hot reload rollback, background job cancellation/timeout model, log and diagnostic redaction.
- Required 3.0 gate: security audit, architecture audit, release audit, smoke tests, Rust tests, and installer hash all pass on the same commit.

### 3.0 acceptance criteria
- Connection closure is internally consistent after connect, disconnect, profile switch, node switch, TUN toggle, system proxy toggle, and disconnect protection toggle.
- TUN off plus system proxy is a valid connection path; TUN on remains valid; neither path leaves stale Windows proxy state after failure.
- Speed tests never switch or connect nodes, including one-click, batch, single-node, and disconnect-protection-on scenarios.
- Diagnostics and speed tests do not block sidebar navigation or ordinary page switching.
- Subscription import/update/switch either completes cleanly or rolls back with an actionable, redacted error.
- Smart-mode outbound IP lookup represents the selected current node without changing the user mode or connection.
- UI layout is stable at supported min/max window sizes with no navigation stalls visible to the user.
- Logs and diagnostic exports are useful to users and safe to share by default.
- Security gates pass: CSP, capabilities, controller bind, `allow-lan`, secret, log redaction, PowerShell escaping, firewall cleanup, and path confinement.
- Release artifact is reproducible enough for test handoff: version numbers match, release notes exist, installer exists, and SHA-256 is recorded.

## Module boundary diagram

```text
UI WebView
  -> uiStore/renderUiState: page, pending, optimistic state, rollback
  -> runBackgroundJob/runForegroundAction/runDetachedButtonAction
  -> Tauri invoke bridge

Backend task API
  -> start_job/job_status/cancel_job
  -> operation queue for core-changing actions
  -> CoreManager

CoreManager
  -> connection_closure: single UI truth surface
  -> system proxy transaction and repair
  -> TUN/disconnect protection/firewall wrappers
  -> mihomo process/controller lifecycle

Config pipeline
  -> subscription/manual node source
  -> patch_config_with_settings
  -> preflight_runtime_config
  -> runtime profile/hot_reload_profile
  -> verify or rollback

Diagnostics/logs
  -> user logs/debug logs/core logs
  -> DiagnosticsSnapshot
  -> diagnostic report/export
  -> sanitize_sensitive_text
```

## Attack surface list

- Tauri commands exposed to the WebView.
- Local mihomo controller and secret.
- Windows system proxy registry changes.
- Windows firewall rules for disconnect protection and speed-test windows.
- Remote subscription download and protocol parsing.
- Remote speed-test and outbound-IP endpoints.
- Runtime YAML profile generation and file paths under app data.
- Log and diagnostic export files.
- User-rendered names from subscriptions and manual nodes.
- External programs using the local proxy port.

## Completion matrix

- 2.9.20: Feature freeze record, known risk list, architecture cleanup list, threat model, and 3.0 acceptance criteria.
- 2.9.21: Global review output, module boundary diagram, attack surface list, legacy profile patch path fenced as unreachable.
- 2.9.22: Connection state model audit for core, takeover, system proxy, TUN, protection, current node, and outbound IP.
- 2.9.23: Background task audit for long operations, cancellation, foreground/background separation, and operation queue.
- 2.9.24: Frontend interaction audit for optimistic UI, pending state, rollback, deferred navigation, and dangerous render APIs.
- 2.9.25: Config generation audit for preflight, runtime config, hot reload, digest skip, verification, and rollback.
- 2.9.26: Logs and diagnostics audit for snapshots, categories, exports, and redaction.
- 2.9.27: Audit/test gate added through `audit:architecture` and release audit integration.
- 2.9.28: Stress coverage tied to interaction, performance, UI, and soak smoke tests.
- 2.9.29: 3.0 candidate pre-gate: no new feature pages, no old profile patch path, architecture/security/release gates required.
