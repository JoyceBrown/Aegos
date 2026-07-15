# Aegos 3.5.83

## Scope

- Added `audit:runtime-regression` as a combined gate for runtime and installer-adjacent regressions.
- The gate verifies stability, backend, core-runtime, diagnostics, security, takeover, installer-regression, and release audit lanes remain wired.
- Release audit now checks that the runtime regression gate itself is present.

## User Impact

- This is a source-only quality gate checkpoint.
- It reduces the chance that future builds pass a narrow script while missing known runtime, firewall, diagnostics, navigation, or installer-regression risks.

## Verification

- Passed: `npm run audit:runtime-regression`
- Passed: `npm run audit:installer-regression`
- Passed: `npm run audit:stability`
- Passed: `npm run audit:core-runtime`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.83.
- SHA-256: Source-only / not applicable.
