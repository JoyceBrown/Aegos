# Aegos 3.5.9

Source-only checkpoint.

## Core Runtime Absorption

- Added typed `CoreController::version_probe` for readiness checks.
- Added typed `CoreController::set_mode` for explicit runtime mode changes.
- Reused typed `CoreController::close_connections` for post-switch connection cleanup.
- Removed the generic `CoreManager::controller` escape hatch from `main.rs`.

## Guardrails

- Added core-runtime/backend/release audit checks that fail if generic `self.controller(...)` returns to `main.rs`.
- Added checks that readiness, mode changes, and connection cleanup stay on typed controller APIs.

## Verification

- Pending in this checkpoint: `npm run check`, `npm run audit:core-runtime`, `npm run audit:backend`, `npm run audit:release`, and full regression gates.

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
