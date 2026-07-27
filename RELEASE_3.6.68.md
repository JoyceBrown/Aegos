# Aegos 3.6.68

Status: source-bound unsigned release candidate.

This release carries the completed 3.6.67 reliability repairs forward without
rewriting the published v3.6.67 artifact. It clarifies effective network state
against retained measurement history, keeps connection recovery guidance and
sidebar metrics current, and improves protection/action accessibility.

## Highlights

- Connected is displayed only when takeover and verified network usability
  agree. Recent measurement and prior outlet observation remain visibly
  historical when they are not current facts.
- Connections explains unverified or unavailable takeover and retains a route
  to diagnostics.
- Persistent traffic and active-connection metrics update outside Home.
- Disconnect protection exposes an explicit accessible binary state; node
  actions, current-page navigation, and truncated profile details are more
  discoverable and accessible.
- Home startup reserves the common-region control strip, reducing the measured
  800-node stress layout shift without changing its `0.02` budget.

## Verification

- Rust formatting/tests, interaction, fixed-window/DPI UI, 800-node stress,
  soak, backend, responsiveness, stability, security, status vocabulary,
  control-plane, architecture, planning, installer, and release-structure
  gates are recorded before publication.
- No live Windows takeover, proxy, DNS, firewall, TUN, FlClash, or host-network
  action is part of this release validation.

## Artifact

- NSIS name: `Aegos_3.6.68_x64-setup.exe`
- Size: 16,335,672 bytes
- SHA-256: `839804d895d4c5af77568e2e876407a6b29f17bf33fdd9e771165ea387b7ade4`
- Signature: unsigned. Verify the SHA-256 published with the GitHub Release
  before installation. No automatic-update channel is enabled.
