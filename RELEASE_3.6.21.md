# Aegos 3.6.21

## Support report

- Renamed the primary export to `Export support report` and included diagnostic summary, Aegos codes, next actions, and recent evidence logs.
- Subscription URLs, tokens, passwords, UUIDs, URI credentials, local paths, and private IP details are redacted.
- Support reports and log-only exports use confined atomic writes under the Aegos diagnostics directory.

## Acceptance

- Unit coverage proves representative credentials, local paths, and private IPs do not survive report generation.
