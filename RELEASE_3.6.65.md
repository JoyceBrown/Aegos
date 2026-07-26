# Aegos 3.6.65

Status: local unsigned WR-01 candidate validated.

This candidate closes the WR-01 evidence-integrity gap. The acceptance runner
executes the complete host-safe matrix and binds every command to current
source and gate inputs with a timestamped, hashed local log. The candidate is
unsigned and is not a GitHub Release.

## Scope

- Preserve the cumulative Windows reliability and UI repairs through 3.6.64.
- Replace declared acceptance results with executable, source-bound evidence.
- Align the active plan, evidence register, checkpoint, README, Git baseline,
  and local installer identity.
- Keep FlClash and Windows network takeover untouched.

## Verification

The executable WR-01 v2 matrix records 25 distinct commands with current
source/gate identity and hashed local logs. It passed:

- 224 Rust tests with 0 failed and 0 ignored;
- 12 product journeys with no residual test root;
- seven pages over 14 window/DPI configurations;
- 800 nodes and 420 navigation switches;
- 16 soak cycles;
- native WebView2 with automatic speed enabled and suppressed; and
- backend, responsiveness, stability, security, IPv6/DNS, outbound-IP,
  runtime, control-plane, architecture, planning, and backup gates.

The runtime/recovery release contract includes:

- `npm run audit:runtime-regression`
- `npm run audit:installer-regression`
- `npm run audit:stability`
- `npm run audit:core-runtime`

## Artifact

- NSIS installer: `Aegos_3.6.65_x64-setup.exe`
- Size: `16325000` bytes
- SHA-256: `93d5691de31c5fe436b596c2075a5e0f62697464d998f5ec8a51b23fef462323`
- Signature: unsigned local candidate
- Publication: no GitHub Release and no update-channel publication
