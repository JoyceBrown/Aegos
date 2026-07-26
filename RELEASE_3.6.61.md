# Aegos 3.6.61

## Scope

- Productize the existing DNS `auto`, `secure`, `system`, and `custom` modes
  without replacing Mihomo's DNS implementation.
- Separate IPv6 request, local capability, node capability, runtime
  configuration, and verified effective state.
- Preserve fixed-node same-egress remote DNS, TUN takeover, transactional
  settings deployment, rollback, measurement-only speed tests, and all
  verified 3.6.60 behavior.

## Changes

- Consolidated DNS mode parsing, candidate validation, custom resolver
  validation, runtime policy shaping, and actual settings writes in
  `dns_policy.rs`; the superseded paths were removed from `main.rs`.
- Added an explicit DNS product contract with requested mode, effective mode,
  protection state, takeover lock state, and TUN requirement.
- System DNS is now disabled while TUN is enabled and the conflict is explained
  before apply. Secure DNS without TUN is shown as waiting for takeover rather
  than already protected.
- Custom resolver validation reports the failing position without echoing the
  resolver value or host.
- Added `ipv6_policy.rs` and separated the persisted request, local capability,
  current-node capability, compiled/deployed runtime state, and actual outlet
  state. Enabling IPv6 is available only after local and node support are
  verified; an existing request can always be disabled.
- DNS mode and custom resolver changes now trigger the same managed runtime
  reapply, verification, persistence, and failure rollback path used by other
  network settings.
- Added sequence and queued-refresh guards for DNS and IPv6 snapshots. Slow
  checks cannot overwrite newer settings and do not block settings navigation.
- Added Rust, interaction, IPv6/DNS audit, minimum-window, rapid-navigation,
  stale-result, runtime-reapply, and rollback coverage.

## Verification

- 204 Rust unit tests passed.
- `npm run smoke:interactions` passed all 10 user journeys, including DNS/TUN
  pre-apply conflict handling, IPv6 capability gating, stale snapshot
  rejection, and navigation during a slow capability check.
- `npm run smoke:ui` passed all 14 viewport/DPI combinations, including the
  920x640 minimum window.
- `npm run smoke:perf:stress` passed 420 rapid navigation changes and the
  existing 800-node/background-work pressure scenarios.
- `npm run smoke:soak` passed 16 concurrent journey cycles with
  `stuckTesting=false` and stable listener counts.
- Backend, responsiveness, stability, security, configuration-extension,
  IPv6/DNS, control-plane, architecture, installer, and final release audits
  passed.
- The control-plane budget passed with `main=11504/11770 production lines` and
  `core_runtime=2893/2900 production lines`.
- `git diff --check` passed.
- FlClash remained running as PID 5024 and was not stopped, restarted,
  modified, or taken over.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.61_x64-setup.exe`
- Size: `16289744` bytes
- SHA-256:
  `e4ef5f69bd62ea7ef10d0d8546389e5bd93bc8d455ea8c3f8de9ad9c218716ec`
- Signature: unsigned open-source build

## Known Limits

- IPv6 support is verified against the current local network and selected
  node. A later network or node change can make the result stale, so Aegos
  rechecks rather than treating the request as permanent proof.
- System DNS compatibility mode intentionally does not provide DNS takeover
  and cannot be combined with TUN.
- Real airport connectivity is not simulated by deterministic fixtures;
  existing user validation remains the real-network acceptance source.
- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Automatic updates, signed rollback, backup synchronization, Windows ARM64,
  and other platforms remain outside this release.
