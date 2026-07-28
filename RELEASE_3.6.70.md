# Aegos 3.6.70

Status: unsigned release candidate; publication is verified separately from
this source-bound record. The installer is not installed.

This candidate binds the completed R5 Rules snapshot responsiveness repair,
the later Connections snapshot-ordering regression repair, the post-release
product batches, and the controlled-routing/acceptance-integrity closure to
one exact artifact. It does not replace or mutate the published `v3.6.69` tag
or asset.

## Scope

- Rules-to-Connections navigation stays responsive while stale large routing
  work is cancelled.
- A delayed no-takeover status refresh cannot disable connection actions that
  are supported by a newer visible connection snapshot.
- Connections can show one on-demand explanation from its current normalized
  snapshot without a new backend request.
- Diagnostic repairs retain their true item-scoped recheck result, and a
  destructive local-backup confirmation identifies the selected snapshot.
- Repeated subscription changes preserve the DNS/IPv6/egress live-card layout
  across the existing fixed window and DPI matrix.
- Aegos-owned user rules remain controlled, editable product state; subscription
  and system protection rules remain visibly read-only.
- The candidate matrix directly includes routing, connection-closure, settings
  probe coalescing, and persistence-debt gates.
- Validation is host-safe: it does not change Windows proxy, TUN, DNS,
  firewall, kill-switch, FlClash, or the host network.

## Verification

The final report at `.validation/wr01/acceptance.json` must record the complete
host-safe validation against this release note and the final gate inputs: 232 Rust tests,
13 product journeys, every required page over 14 window/DPI configurations,
800 nodes/420 navigations, 16 soak cycles, both native modes, and all 30
required commands passed. The final candidate provenance record additionally
binds this artifact to those source and gate digests.

The runtime recovery gates completed as part of that matrix:
`npm run audit:runtime-regression`, `npm run audit:installer-regression`,
`npm run audit:stability`, and `npm run audit:core-runtime`.

## Artifact

- NSIS name: `Aegos_3.6.70_x64-setup.exe`
- Local path: `src-tauri/target/release/bundle/nsis/Aegos_3.6.70_x64-setup.exe`
- Size: 16,341,772 bytes
- SHA-256: `9c6ebab99f9c80792e3e2b9d6ab766c55fcac5092aa19575bb27cb87126ef261`
- Signature: unsigned (`Get-AuthenticodeSignature` returned `NotSigned`).
- Distribution: intended exact `v3.6.70` GitHub Release asset; publication
  state is verified separately. The installer is not installed.
