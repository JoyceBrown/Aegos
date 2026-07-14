# Aegos 3.5.13

Source-only checkpoint.

## Config Pipeline Runtime Parsing

- Moved speed-test firewall port extraction behind `config_pipeline::speed_test_firewall_ports_from_source`.
- Removed the `main.rs` helper that directly inspected runtime YAML `proxies[].port`.
- Kept `CoreManager::speed_test_firewall_ports` responsible only for reading the active profile and merging the safe default ports.

## Guardrails

- Backend/release audits now require the pipeline-owned speed-test port extraction entrypoint.
- Backend/release audits reject future `main.rs` calls to `config_pipeline::patch_speed_test_source` and reject reintroducing `proxy_ports_from_config` in `main.rs`.

## Verification

- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:debt`
- `npm run audit:security`
- `npm run audit:architecture`
- `npm run smoke:interactions`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
