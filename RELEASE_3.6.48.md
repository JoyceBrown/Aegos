# Aegos 3.6.48

## Scope

- Prevent the Windows process inventory from blocking standby speed-test startup.
- Bound PowerShell helpers with explicit timeouts and child-process cleanup.
- Keep stale-core cleanup limited to the exact Aegos-managed Mihomo executable path.
- Present speed-test preparation as preparation instead of misleading `0/0` progress.
- Retain the 3.6.47 Provider-health wording and fast-result feedback changes.

## User-visible behavior

- Starting a batch speed test no longer freezes the Aegos window when Windows CIM is slow or unavailable.
- Before the target catalog is ready, the notice reads `正在准备测速节点，界面可继续操作。`.
- First-pass and final speed results remain transient and restore the normal runtime status.
- Inline proxy groups continue to be excluded from remote Provider health checks.

## Safety

- Aegos does not stop or reconfigure FlClash.
- Orphan cleanup matches both the process name and canonical executable path.
- The speed-start cleanup scan has a 3-second hard timeout.
- General PowerShell helpers have a 30-second hard timeout and their child process is reaped on expiry.

## Verification

- Rust unit tests
- Provider health-check audit
- Speed reform, speed closure, target, responsiveness, backend, and core-runtime audits
- Interaction and UI smoke tests
- Release and installer gates
- Installed Windows validation with FlClash kept online

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.48_x64-setup.exe`
- SHA-256: `4978e569721de086600c96b5689e2278503975ec2d7f49d5c241c1e76ceed84d`
