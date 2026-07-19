# Aegos 3.6.35 Installer Baseline Execution Record

Date: 2026-07-19

This is a sanitized behavior-baseline record for the published `v3.6.35` installer. It is not a 3.6.36 release certification and must not be used to claim that a changed source tree has been packaged or released.

## Environment

- Windows 11 Enterprise x64, build 26200.
- Official installer: `Aegos_3.6.35_x64-setup.exe`.
- SHA-256: `F8027159954AF35A45BB475CB544D3468C75328159D11F8D065D826ABA2B68A9`.
- The test began with a user-level Aegos installation, system proxy enabled, no PAC or auto-detect configuration, one related virtual adapter, seven related routes, and no Aegos firewall rules. No subscription URL, credential, controller secret, user path, or public IP is recorded here.

## Executed Evidence

- Forced termination of the running Aegos process was performed after recording the sanitized network baseline.
- The registered uninstaller completed with exit code 0 and removed the Aegos uninstall registration.
- The official installer was re-verified by SHA-256 and completed with exit code 0.
- After reinstall, the Aegos registry entry, executable, Start Menu shortcut, and application data were present; the installed version was `3.6.35`.
- A freshly installed Aegos process exposed a desktop window.
- At the end of the run, Aegos and Mihomo processes were stopped. Proxy enabled/PAC/auto-detect state, related adapter and route counts, and Aegos firewall-rule count matched the pre-test baseline.

## Blocking Observation

After force-terminating Aegos, its Mihomo child process remained alive. Restarting Aegos first normally and then with administrator privileges started additional Mihomo processes rather than cleaning the stale one. This fails the intended crash-recovery expectation for Aegos-owned engine cleanup and blocks the 3.6.36 installer checkpoint until the root cause is fixed and the forced-termination recovery path is re-run in an isolated environment.

## Follow-up Source Validation

- The post-baseline source repair identifies stale processes by exact normalized managed-core executable path, never by a bare `mihomo` process name.
- In the development build, forced Aegos termination left one managed core process; the next Aegos start removed that process before port preparation and did not leave a duplicate managed core.
- Rust coverage and the core-runtime audit protect the path-scoped cleanup contract.
- This is source-level recovery evidence only. A fresh, versioned 3.6.36 installer candidate must repeat the isolated install/uninstall and forced-termination path before the installer checkpoint is cleared.

## Not Proven By This Run

- Missing-WebView2 installation path.
- First-install path without developer tools.
- TUN, disconnect protection, firewall cleanup, and proxy/PAC restoration while those features are actively enabled.
- Windows-version, DPI, account-type, security-product, and competing-VPN matrix coverage.
- A 3.6.36 release candidate installer.
