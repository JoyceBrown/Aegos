# Control-plane baseline — 3.6.45

## Confirmed boundaries

- The bundled Mihomo executable is a managed resource with an approved digest.
- `CoreController` owns authenticated controller transport; pages invoke Aegos
  commands and do not receive controller secrets or runtime YAML.
- `ProxyCatalog`, connection snapshots, delay results, and runtime deployment
  receipts are product-facing normalized data rather than raw controller JSON.
- Disconnected speed testing uses the standby path and is contractually
  measurement-only: no selection, proxy, TUN, or traffic-takeover mutation.
- Profile and routing deployment use staged candidate/backup/journal artifacts
  and runtime/controller identity verification.
- System proxy, firewall, and TUN operations already create durable takeover
  journals and maintain an active-component recovery marker.

## Gaps this program must close

1. The global `Mutex<()>` serializes mutations but does not yet publish a
   typed active-command snapshot, conflict reason, or state transition record.
2. `CoreManager` and `main.rs` still coordinate many product concerns; services
   need further separation without reintroducing duplicate execution paths.
3. `routing_domain` validates and compiles supported user rules, but its public
   domain still uses engine-shaped strings for rule kind and strategy-group type.
4. Engine identity is pinned for the current binary but not yet expressed as a
   versioned capability matrix with upgrade/rollback evidence.
5. Several release guards inspect source structure. Behavioural contracts and
   fault injection must become the primary evidence for safety properties.

## Non-regression constraints

- No speed path may change node selection, system proxy, TUN, routes, firewall,
  or traffic takeover.
- Controller stays local-only and secrets stay redacted.
- All configuration and network mutations remain transactional and recoverable.
- No Mihomo fork or embedded derivative is introduced by this program.
