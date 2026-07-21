# Control-plane Boundary - Aegos 3.6.49

## Decision

Aegos owns the product control plane. Mihomo remains the approved managed data
plane. This release separates product intent and shared platform primitives
from the current Mihomo adapter without copying Mihomo behavior into Aegos.

`dataplane.rs` is a narrow internal port, not a replacement engine or a new
super-module. It contains engine identity, admission capabilities, and typed
product-facing operations only. It must not grow protocol, DNS, TUN, packet
forwarding, rule execution, controller transport, persistence, or UI behavior.

## Ownership Matrix

| Owner | Responsibility |
| --- | --- |
| `main.rs` | Tauri composition, command entrypoints, and orchestration between owned services |
| `app_config.rs` | Persisted Aegos user intent and defaults |
| `dataplane.rs` | Engine identity, candidate admission, and the product-facing data-plane port |
| `core_runtime.rs` | Current Mihomo process/controller adapter, lifecycle, and runtime translation |
| `core_domain.rs` | Normalized product snapshots returned across the data-plane boundary |
| `config_pipeline.rs`, `profile_compiler.rs`, `routing_domain.rs` | Validation and compilation of Aegos intent into deployable runtime configuration |
| `storage_runtime.rs` | The single path-confined atomic storage implementation |
| `windows_process.rs` | The single bounded hidden PowerShell/process launcher |
| `speed_runtime.rs`, `speed_scheduler.rs` | Measurement state, targets, results, and bounded scheduling |
| `system_takeover.rs`, `config_deployment.rs` | Recoverable Windows takeover and configuration transactions |

## Frozen Rules

1. Do not add product configuration structs, persistence primitives, or process
   launch helpers to `main.rs`.
2. Do not add product fallback policy or raw UI payload shaping to the data-plane
   port or controller adapter.
3. Do not expose raw controller envelopes, URLs, secrets, or runtime YAML to the
   frontend.
4. Do not implement proxy protocols, DNS, TUN, packet forwarding, or Mihomo's
   rule engine in Aegos.
5. Do not retain parallel old and new implementations after a migration.
6. Keep `main.rs` at or below 13,550 lines and `core_runtime.rs` at or below
   4,800 lines. New behavior must move to its owning module.

## Adapter Evolution

The current adapter remains in `core_runtime.rs` because only one approved data
plane is shipped. If adapter-specific work grows, split it into focused Mihomo
transport, lifecycle, and translation modules behind `DataplaneControl`; do not
rename or bundle that code as an Aegos engine.

A second engine is not justified until it can pass the same identity,
capability, configuration, measurement-only, transaction, recovery, security,
and product-snapshot contracts. Adding sing-box solely to demonstrate
abstraction is explicitly out of scope.

## Replacement Criteria

Replacing Mihomo requires all of the following:

- a documented user or reliability benefit that cannot be delivered through
  the current contract;
- a complete adapter and configuration compiler with no engine branches in UI
  or product services;
- equivalent protocol coverage, controller isolation, standby measurement,
  runtime reload, Windows takeover, rollback, and diagnostics;
- exact artifact identity and capability admission evidence;
- migration and rollback tests using sanitized fixtures; and
- removal of the superseded adapter path after acceptance.

## 3.6.49 Acceptance

- Product configuration is outside `main.rs`.
- Engine admission and typed data-plane operations are outside
  `core_runtime.rs`.
- Atomic storage and PowerShell execution each have one shared implementation.
- Speed state and target types are outside `main.rs`.
- Rust tests and control-plane, backend, responsiveness, core-runtime,
  architecture, installer, and release gates pass.
