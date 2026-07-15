# Aegos Status Snapshot Contract 3.5.75

## Purpose

This contract prevents status drift between the sidebar, home page, settings page,
diagnostics page, and connection button. The UI must not invent runtime truth from
local guesses. It may only translate the latest backend status snapshot into
user-facing wording.

## Backend-Owned Truth

The `app_status` snapshot owns these facts:

- `running`, `coreReady`, `standby`, `controller`: whether the core process and controller are ready.
- `trafficTakeover`: whether Aegos is currently taking over user traffic.
- `connection.phase`: disconnected, standby, connected by system proxy, connected by TUN, or core-only.
- `connection.systemProxyWanted`: whether the user wants Windows system proxy takeover.
- `connection.systemProxyApplied`: whether system proxy takeover is actually applied.
- `connection.takeoverComplete`: whether the chosen takeover path is complete enough for user traffic.
- `network.availability.state`: unverified, checking, available, stale, or unavailable.
- `network.availability.networkUsable`: whether recent evidence says the proxy network is usable.
- `network.outboundIp`, `network.lanIp`, `network.proxyEndpoint`: current network display values.
- `protection.level`, `protection.label`: disconnect-protection status.
- `settings`: user preference snapshot, not proof that the OS or core already applied it.

## Frontend-Owned Presentation

The frontend may:

- Convert backend states to short labels with `STATUS_TEXT`.
- Render sidebar and home metrics from the same `network.availability` object.
- Build user-facing explanations with `statusSurfaceNotice()`.
- Show optimistic button text while a user command is pending, then reconcile with the next snapshot.

The frontend must not:

- Treat `settings.systemProxy` as proof that Windows system proxy is applied.
- Treat `coreReady` as proof that user traffic is connected.
- Treat an old outbound IP as a fresh network verification.
- Start diagnostics, speed tests, connection probes, or outbound IP refreshes from `renderStatus()`.
- Block page navigation while a status, diagnostics, speed, or IP task is running.

## Required User Semantics

- Software state answers: "Is Aegos core ready?"
- Network available answers: "Has current proxy traffic been verified recently?"
- Connection button answers: "What will happen if the user clicks this button?"
- System proxy answers: "Is the OS proxy takeover actually applied?"
- Disconnect protection answers: "Is direct traffic blocked when proxy fails?"

## Audit Hooks

The status vocabulary audit must verify:

- This contract file exists.
- `renderStatus()` consumes `status.connection` and `status.network.availability`.
- The home notice uses `statusSurfaceNotice()`.
- The frontend has no direct dynamic HTML injection for status text.
- Backend status tests cover stopped, standby, available, stale, and unavailable network states.
