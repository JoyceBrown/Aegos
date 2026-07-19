# Mihomo integration governance — Aegos 3.6.46

## Decision

Aegos remains the control plane and ships Mihomo as its managed data plane.
There is no fork, embedded derivative, or frontend access to Mihomo's
controller, configuration files, or credentials.

## Admission contract

An engine artifact is admitted only when all three are approved together:

1. Exact version and SHA-256 identity.
2. Required capabilities: gVisor, process routing, runtime configuration
   reload, local controller secret, and standby delay probing.
3. Passing representative deployment, controller, standby-measurement, and
   recovery tests against the candidate.

An identity mismatch or a missing capability rejects the candidate. Aegos
continues using the last verified bundled engine/configuration pair; it does
not perform an in-place automatic engine upgrade.

## Ownership boundary

| Aegos owns | Mihomo owns |
| --- | --- |
| User intent, policy, profiles, validation, transactions, recovery, local status, and redaction | Packet forwarding, protocol implementations, rule execution, DNS/TUN primitives, and controller runtime |

Rules and strategy groups are Aegos domain objects. Only the compiler emits
Mihomo syntax. Controller responses are normalized before they reach the UI.

## Upstream collaboration threshold

Upstream collaboration is appropriate only for a reusable engine defect,
capability gap, or protocol behavior that cannot be safely expressed through
the existing controller/configuration contract. A report must include a
minimal reproducible configuration, sanitized logs, version/digest, expected
and observed behavior, and no user identifiers, subscription URLs, or secrets.

Product UX, system takeover, persistence, recovery, and policy decisions stay
in Aegos even when an upstream issue is filed.
