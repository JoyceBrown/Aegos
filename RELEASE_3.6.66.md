# Aegos 3.6.66

Status: validated local unsigned WR-02 candidate.

This candidate repairs two coupled responsiveness defects without changing
network takeover or Mihomo probe semantics. Repeated speed tests now provide
prompt progressive feedback, and Nodes/Connections are actionable during the
startup window without paying avoidable first-entry work.

## Scope

- Drain bounded speed-result chunks without pausing the queue merely because
  the initiating click keeps the foreground-hot window active.
- Coalesce visible delay changes onto the next animation frame so a throttled
  update cannot disappear until terminal repaint.
- Prewarm Nodes and the Connections shell before low-priority routing work.
- Render startup node data into Nodes when the user enters before data arrives.
- Queue a replacement Connections load when a stale request and a return visit
  overlap.
- Preserve measurement-only behavior and the existing host-safe boundaries.

## Verification

### Focused Evidence

- Repeated speed run IDs advance `1 -> 2`; testing appears within `50 ms` and
  the first real progressive value within `180 ms`.
- Startup node/connection prewarm completes within `700 ms` in the browser
  pressure fixture.
- Native WebView2 Nodes and Connections first frames remain within `50 ms`
  immediately after the first physically actionable shell frame, with no
  activation task over `50 ms`, in enabled and suppressed automatic-speed
  modes.
- A pending Connections request followed by leave/return must issue a bounded
  replacement load and render content within `400 ms`.

The runtime and recovery contract remains explicitly covered by:

- `npm run audit:runtime-regression`
- `npm run audit:installer-regression`
- `npm run audit:stability`
- `npm run audit:core-runtime`

## Artifact

- NSIS name: `Aegos_3.6.66_x64-setup.exe`
- Size: `16324439` bytes
- SHA-256: `1554fa3db413a937085e76c108b6797264d62845fbf0057fa8f808d7a3c96f58`
- Signature: unsigned local candidate
- Publication: no GitHub Release and no update-channel publication
