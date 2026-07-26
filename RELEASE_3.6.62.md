# Aegos 3.6.62

## Scope

- Close the existing fixed-egress route by separating user selection,
  Controller runtime node, fixed-node classification, observed outlet, and
  observation freshness.
- Combine fixed-egress identity with DNS route, TUN takeover, IPv4/IPv6 outlet,
  and leak evidence without adding an external fixed-IP service.
- Preserve the verified 3.6.61 DNS/IPv6 contract, node-switch transaction,
  rollback behavior, and measurement-only speed tests.

## Changes

- Added `egress_identity.rs` as the single owner of outlet observation context,
  freshness, fixed/ordinary classification, and the fixed-egress product
  snapshot.
- Outlet observations now bind the active profile, routing mode, and resolved
  runtime node. Node, profile, mode, or core-state changes immediately expire
  the previous observation and any in-flight older query.
- Temporary provider failures retain the previous outlet only as visibly stale
  evidence; it can no longer report the network or fixed egress as verified.
- Added a fixed-egress consistency report that jointly evaluates the selected
  and runtime node, two IPv4 observations, DNS route, TUN/DNS takeover, IPv6
  runtime state, and IPv6 leak policy.
- Fixed egress is reported as verified only when every required fact agrees.
  Missing evidence is pending, a fixed route without TUN is partial protection,
  and outlet/DNS/IPv6 disagreement is reported as risk.
- Added a compact settings report for request, runtime node, outlet freshness,
  DNS route, TUN/DNS protection, IPv6 policy, and the overall conclusion.
- Slow IPv6/DNS consistency checks validate the route generation before
  returning, so an older node/profile/mode result cannot overwrite new state.
- Connected mode changes trigger a detached outlet refresh. Stale cached outlet
  values are explicitly marked as old in the status surfaces.
- Public outlet IP remains available in the explicit status UI but is no longer
  written into runtime logs or exported log evidence.

## Verification

- 211 Rust unit tests passed.
- `npm run smoke:interactions` passed all 10 user journeys, including stale
  outlet display, route-generation rejection, consistency rendering, and
  navigation during slow checks.
- `npm run smoke:ui` passed all 14 viewport/DPI combinations, including the
  920x640 minimum window.
- `npm run smoke:perf:stress` passed 420 rapid navigation changes, 800-node
  pressure, and streamed results without stuck UI state.
- `npm run smoke:soak` passed 20 concurrent journey cycles with
  `stuckTesting=false` and stable listener counts.
- Backend, responsiveness, stability, security, configuration-extension,
  IPv6/DNS, outbound-IP, control-plane, and architecture audits passed.
- The control-plane budget passed with `main=11508/11770 production lines` and
  `core_runtime=2893/2900 production lines`.
- `git diff --check` passed.
- FlClash remained running as PID 5024 and was not stopped, restarted,
  modified, or taken over.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.62_x64-setup.exe`
- Size: `16295092` bytes
- SHA-256:
  `f756f3bebbb78da3855e2ff6f132436aff2d7a6e7e34e1b6763b6cb75ea5e34c`
- Signature: unsigned open-source build

## Known Limits

- A fixed node provides a stable configured endpoint, not a purchased or
  guaranteed permanent public IP. Aegos reports only the outlet it observes.
- Fixed-node remote DNS without TUN is intentionally reported as partial
  protection because applications can still bypass DNS takeover.
- Real airport connectivity and provider-side IP persistence are not simulated
  by deterministic fixtures; real-network validation remains external evidence.
- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Automatic updates, signed rollback, backup synchronization, Windows ARM64,
  and other platforms remain outside this release.
