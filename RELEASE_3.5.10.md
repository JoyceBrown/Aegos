# Aegos 3.5.10

Source-only checkpoint.

## Core Runtime Absorption

- Removed the remaining top-level `main.rs` `controller_request` proxy function.
- Routed the routing snapshot recent-connection read through `CoreController::connections_snapshot`.
- Kept the short 550 ms timeout for the routing read-only diagnostic path.

## Guardrails

- Added core-runtime/backend/release audit checks that reject a future `main.rs` `controller_request` wrapper.
- Preserved the rule that controller endpoint ownership lives in `core_runtime`.

## Verification

- Pending in this checkpoint: `npm run check`, `npm run audit:core-runtime`, `npm run audit:backend`, `npm run audit:release`, and full regression gates.

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
