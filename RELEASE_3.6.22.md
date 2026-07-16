# Aegos 3.6.22

## Node diagnosis

- Node failures now distinguish timeout, DNS, TLS handshake, authentication, remote refusal, protection blocking, unsupported protocol, and removed-node cases.
- Remote `connection refused` is no longer incorrectly reported as a local controller outage.
- Node diagnosis returns a structured Aegos issue and recovery candidates.

## Acceptance

- Node results cannot collapse a completed failed test back to an unexplained `not tested` state.
