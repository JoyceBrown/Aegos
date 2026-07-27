# Aegos 3.6.67

Status: validated unsigned `v3.6.67` GitHub Release asset.

This release replaces the rejected 3.6.66 responsiveness result. Manual
speed tests now provide honest, continuously changing numeric feedback before
the first measured result, and cold-start Connections work can no longer hold
navigation behind a large result render or queued page prewarm.

## Scope

- Paint `等待 0.0s` on the first actionable frame of every accepted manual
  speed test and advance the elapsed value until measured latency or a terminal
  failure replaces it.
- Keep elapsed waiting time visually distinct from measured `xx ms` latency;
  no synthetic latency value is produced.
- Keep the batch action busy through background refinement instead of allowing
  a clickable control to silently ignore another request.
- Cancel pending startup page prewarm on user navigation.
- Build connection rows in bounded 24-row chunks with a main-thread yield and
  stop obsolete chunks when the user leaves Connections.
- Preserve measurement-only behavior and all host-network safety boundaries.

## Verification

### Focused Evidence

- In the delayed-first-result 800-node fixture, the second run advanced run ID
  `1 -> 2`, painted `等待 0.0s` in `4.4 ms`, advanced through `0.1s` and
  `0.2s`, then painted the first real result `24.9 ms` after its event.
- In the 1200-connection negative control, navigation interrupted rendering
  after 24 rows; Home painted in `6.0 ms` and the obsolete row count stopped.
- Native WebView2 enabled/suppressed cold-start probes painted Connections in
  about `33.7/33.0 ms` and the following Home page in `33.2/33.0 ms` with
  synchronous work below `0.6 ms` and no activation-window long task.
- Interaction, UI, responsiveness, speed reform, 800-node stress, and both
  native automatic-speed modes passed before candidate construction.

The runtime and recovery contract remains explicitly covered by:

- `npm run audit:runtime-regression`
- `npm run audit:installer-regression`
- `npm run audit:stability`
- `npm run audit:core-runtime`

## Artifact

- NSIS name: `Aegos_3.6.67_x64-setup.exe`
- Size: `16322443` bytes
- SHA-256: `4cf7895f68cdbee981f3d4c6b1ed032f52da2fd5eb3c8148b755d8345da57437`
- Signature: unsigned. Verify the SHA-256 above before installation.
- Publication: one public GitHub Release asset; no automatic-update channel
