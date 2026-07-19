# Aegos control-plane completion criteria

This roadmap treats Mihomo as a managed data-plane engine. It is not a plan to
fork, embed, or recreate Mihomo.

## 1. Runtime state and commands

- Every runtime-changing operation has a product command classification,
  cancellation policy, conflict policy, and terminal outcome.
- The status center, home page, diagnostics, and logs consume one versioned
  runtime snapshot; a running process alone never means "connected".
- Mutations are serialized by a coordinator. Measurement work remains detached
  and proves it does not change selection, takeover, system proxy, or TUN.

## 2. System takeover recovery

- Proxy, firewall, routing, and TUN changes use durable journals with explicit
  prepare, apply, verify, rollback, and recovery-required outcomes.
- Startup reconciles incomplete journals before a new takeover attempt.
- Fault injection covers journal persistence failure, partial apply, failed
  rollback, and an external Windows proxy change.

## 3. Routing and strategy domain

- Product rules use typed conditions, actions, targets, priority, scope, and
  source. Mihomo rule strings are compiler output only.
- Strategy policy is expressed as manual, latency, failover, or balance; the
  compiler alone maps that model to engine-specific group syntax.
- Static validation detects invalid targets, cycles, unreachable/overridden
  rules, duplicate semantics, and unsupported capability combinations.

## 4. Engine governance

- Each supported Mihomo version has an explicit capability record and approved
  digest. New engine versions are preflighted against representative configs.
- Upgrade failure leaves the previously verified engine/config pair usable.

## 5. Evidence

- Rust type/module tests, controller contract tests, compiler determinism tests,
  deployment/rollback tests, and end-to-end fault tests are required.
- Source scans remain supplemental; they cannot be the only proof of a safety
  property.
- A release requires UI, interaction, performance, soak, security, backend,
  runtime, configuration, recovery, and installer verification without gate
  weakening.
