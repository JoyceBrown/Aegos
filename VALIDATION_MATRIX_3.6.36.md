# Aegos 3.6.36 Candidate Validation Matrix

This checklist is for the versioned `3.6.36` candidate only. Record outcomes without subscription URLs, credentials, node addresses, controller secrets, or public IP addresses.

## Protocol and Configuration Matrix

For every row, verify import, preflight, standby single-node delay test, connected runtime, proxy-group selection, and failure message. Use a sanitized fixture or a separately controlled test subscription.

| Family | Automated fixture / unit coverage | Real Windows candidate evidence | Status |
| --- | --- | --- | --- |
| Clash YAML / Shadowsocks | `clash-basic.yaml` and parser/runtime gates | Pending controlled test source | Pending |
| Mixed URI / base64 URI | `mixed-uri.txt` and parser/runtime gates | Pending controlled test source | Pending |
| VLESS / Reality | parser and scheduler tests | Pending controlled test source | Pending |
| Hysteria2 | parser and scheduler tests | Pending controlled test source | Pending |
| TUIC | sanitized URI fixture plus parser and scheduler tests | Pending controlled test source | Pending |
| AnyTLS | parser/runtime capability tests | Pending controlled test source | Pending |
| Unsupported protocol | `unsupported-protocol.txt`; preflight rejection | Confirm error code and preserve previous runtime | Pending |

Required evidence for each real path:

- The previous active runtime remains usable if import or preflight fails.
- A speed test remains measurement-only: no connection, selected-node, mode, proxy, TUN, or firewall mutation.
- A changed profile invalidates old subscription, delay, and outbound-IP work.
- Logs and user-facing diagnostics remain redacted.

## Windows Device and Takeover Matrix

| Scenario | Required observable | Status |
| --- | --- | --- |
| Windows 10 x64 standard user | Install, connect, disconnect, uninstall, and no residual Aegos process | Pending |
| Windows 11 x64 administrator | Install, forced termination, scoped core recovery, restart, uninstall | Local no-takeover pass: install, standby launch, forced restart, and uninstall completed while FlClash/system-proxy baseline remained unchanged; active takeover paths deferred |
| Missing WebView2 | User-visible bootstrapper path completes or reports an actionable failure | Pending |
| System proxy active before Aegos | Disconnect/uninstall restores proxy, PAC, and auto-detect snapshot | Pending isolated run |
| TUN enabled | Adapter, routes, DNS, and runtime stop/rollback restore correctly | Pending |
| Disconnect protection enabled | Firewall rule apply/verify/close leaves no Aegos rules | Pending |
| Competing VPN / virtual adapter | Aegos uses its selected physical interface and does not alter the other product | Pending |
| DPI / narrow display | Window remains operable; navigation and node virtualization remain responsive | Pending |

## Candidate Exit Criteria

- Run the documented automated gates against the 3.6.36 tree and record command outcomes in the release note.
- Execute all pending real paths in an isolated VM or dedicated test account with an explicit recovery owner.
- Before each destructive path, capture only sanitized pre-state. Restore and compare the state before moving to the next path.
- Do not upload, tag, publish, or call this candidate a release until every required row has recorded evidence and the license/distribution checklist is complete.

## Isolated Environment Availability

| Environment | Evidence | Status |
| --- | --- | --- |
| Current Windows Sandbox host | The Sandbox feature and its Hyper-V dependencies report enabled and the `vmcompute`/`hns` services run, but the normal runtime entry point and Start-menu registration are absent. Direct launch of the component-store binary on 2026-07-20 crashed with Windows Error Reporting `BEX64` / exception `0xc0000409`; DISM reports repairable component-store corruption. | Blocked: repair the host with matching Windows installation media or use another isolated Windows host before treating any installer row as complete. |
