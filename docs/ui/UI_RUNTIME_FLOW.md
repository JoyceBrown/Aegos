# UI Runtime Flow Audit

## Current flow

`src/app.js` receives `app_status`, background job snapshots, speed snapshots, routing snapshots, and diagnostic results through the Tauri `invoke()` wrapper. `renderStatus()` owns the shared status surface; page renderers consume the latest snapshot and bounded feature caches.

## Invariants

- Pages never fetch the local Controller.
- Pages never parse or write Mihomo YAML.
- Visual work does not add, remove, or change literal Tauri commands without updating a reviewed behavior contract.
- Connection truth comes from runtime and takeover verification, not from core process existence alone.
- Subscription switches invalidate stale speed and outbound-IP results.
- Diagnostics, speed tests, and subscription work stay detached from navigation.

## Refactoring queue

1. Extract read-only status, jobs, speed, connections, routing, diagnostics, and environment calls behind typed service functions.
2. Extract mutating job starters behind one operation service.
3. Move feature renderers into modules only after command-trace parity and browser fixtures exist.
4. Remove the transitional direct-call path after every call site has migrated; never keep dual implementations.
