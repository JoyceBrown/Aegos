# Aegos UI Architecture Rules

1. UI renders Aegos runtime state, never raw Mihomo state.
2. Do not fetch the Controller, expose its secret, or parse/write runtime YAML in a page.
3. Do not add a second full UI framework without an approved migration RFC and rollback plan.
4. Use semantic design tokens for new colors, spacing, radius, shadow, z-index, and motion.
5. Avoid nested decorative cards, full-window blur, neon glow, and continuous animation.
6. Network-changing actions use explicit background operations and runtime verification.
7. Do not show connected until takeover and connectivity truth support it.
8. Speed tests must never switch or connect a node.
9. Navigation, diagnostics evidence, and the status center remain usable during background work.
10. Dynamic user/core text uses text nodes or `textContent`; dangerous HTML injection is prohibited.
11. Sensitive values are redacted in UI, logs, fixtures, screenshots, and exported reports.
12. New list work covers loading, empty, error, partial, large-data, and stale-result states.
13. GPL repositories may be studied but not copied.
14. Remove superseded implementations after migration; do not keep dual paths.
15. Never delete working business behavior or weaken a gate to pass UI tests.
16. Each UI batch must pass command freeze, interaction, performance, soak, fixed viewport/DPI, and security checks.
