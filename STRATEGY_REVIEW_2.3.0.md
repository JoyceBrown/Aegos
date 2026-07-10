# Aegos 2.3.0 Strategy Review

## FlClash Findings

- Core control is a thin controller layer; heavy work is kept out of the UI path.
- Real profile generation is built from raw profile plus patch settings, then hashed to avoid unnecessary re-apply.
- Proxy groups are transformed into view data in a compute task, including group-to-group selection resolution.
- User selection is stored as a selected map, so UI state can update immediately and survive refreshes.
- Expensive refreshes are debounced, and repeated proxy/config operations are serialized by action managers.
- Delay data is cached separately from proxy/group data and applied during view-model generation.

## Aegos Gaps Before 2.3.0

- Stopped-core profile preview flattened all proxies into a synthetic GLOBAL group, losing the real subscription group structure.
- Proxy selection was applied to mihomo but not persisted as a selected map.
- Group items that referenced other groups were shown as unknown proxy rows and could not inherit the leaf proxy delay.
- Delay tests could target group names instead of the real leaf proxy behind the selected group.

## Evaluation Gates

- Profile preflight must allow proxy groups to reference other proxy groups and built-in mihomo targets.
- `proxy_groups` must return real group structure from either mihomo or the active YAML file.
- Proxy selection must persist in settings and roll back if the controller rejects the change.
- Group rows must expose `realProxyName` when they represent another group.
- Delay cache must apply to the resolved leaf proxy, not only to direct node names.
- Release audit must fail if the selected-map/group-resolution strategy is removed.

## Implemented Plan

- Add `selected_proxy_map` to settings and public settings.
- Rebuild stopped-core profile groups from actual `proxy-groups` instead of flattening all nodes.
- Add recursive group reference resolution modeled after FlClash's selected proxy computation.
- Apply speed-test delay results through `realProxyName`.
- Store selected proxy choices in `change_proxy` with rollback on controller failure.
- Add Rust unit tests and release/backend audit coverage.
