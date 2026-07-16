# Aegos 3.6.11

Stage 5.3: complete Windows proxy snapshot and restore.

- Snapshot includes ProxyEnable, ProxyServer, ProxyOverride, AutoConfigURL, and AutoDetect.
- Aegos pauses PAC and auto-detection only while its manual proxy takeover is active.
- Restore verifies every captured field before deleting the recovery snapshot.
- Source checkpoint; incorporated into the 3.6.16 acceptance installer.
