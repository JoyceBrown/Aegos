# Aegos 3.5.8

Source-only checkpoint.

## Core Runtime Absorption

- Moved proxy controller reads into `CoreController::proxies_snapshot`.
- Moved explicit proxy selection into `CoreController::select_proxy`.
- Moved proxy delay probing URL construction and controller access into `CoreController::proxy_delay_with_client` while preserving the shared HTTP client and measurement-only speed-test behavior.
- Removed the now-dead `main.rs` URL path encoder so controller URL construction has one owner.

## Guardrails

- Added core-runtime/backend/release audit checks that reject new ad-hoc `/proxies` controller calls in `main.rs`.
- Added guardrails proving speed-test paths do not call node-selection APIs.

## Verification

- Pending in this checkpoint: `npm run check`, `npm run audit:core-runtime`, `npm run audit:backend`, `npm run audit:release`, and full regression gates.

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
