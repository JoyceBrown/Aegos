# Aegos 3.6.17

## Unified errors

- Introduced stable Aegos issue codes for connection, subscription, node, DNS, TUN, system proxy, and firewall failures.
- Public failures now carry a human title, explanation, next action, and optional repair action.
- Raw network-core errors remain technical evidence and are not the primary user message.

## Acceptance

- Unit coverage verifies raw TLS/engine text is absent from public issue messages.
- Background jobs preserve structured issues instead of flattening every failure into one string.
