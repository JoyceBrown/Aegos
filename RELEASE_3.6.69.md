# Aegos 3.6.69

Status: source-bound unsigned release candidate.

This release corrects the high-frequency Home status vocabulary and replaces
the former one-run relative stability rating with a rolling per-node
measurement model. The published 3.6.67 and 3.6.68 releases remain immutable.

## Highlights

- Sidebar measurements use the conventional labels `延迟`, `稳定性`, and
  `落地 IP` without clipped label text.
- The primary disconnected view uses a direct connection action instead of
  internal standby or traffic-takeover language.
- Disconnect protection keeps its accessible binary switch semantics while
  presenting the complete `断网保护` label without a redundant visible suffix.
- Stability uses each node's successful measurement history. It requires at
  least three samples in both rolling 10-minute and 30-minute windows, then
  rates the larger mean-absolute-deviation ratio: at most 8% high, at most 20%
  medium, otherwise low. Insufficient or stale samples are explicitly not
  rated high.

## Verification

- Rust formatting/tests, interaction, fixed-window/DPI UI, stress, soak,
  responsiveness, stability, security, control-plane, architecture, planning,
  installer, and release gates are recorded before publication.
- Runtime recovery gates executed before publication: `npm run audit:runtime-regression`,
  `npm run audit:installer-regression`, `npm run audit:stability`, and
  `npm run audit:core-runtime`.
- No live Windows takeover, proxy, DNS, firewall, TUN, FlClash, or host-network
  action is part of this release validation.

## Artifact

- NSIS name: `Aegos_3.6.69_x64-setup.exe`
- Size: 16,345,798 bytes
- SHA-256: `a85a8335ce67c6fa30fe8cca9eeeb89aa9198dd9fa76086b5a84d8cf3789a4cd`
- Signature: unsigned. No automatic-update channel is enabled.
