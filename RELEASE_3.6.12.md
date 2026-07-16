# Aegos 3.6.12

Stage 5.4: unified firewall cleanup.

- Disconnect-protection and temporary speed-test rules are enumerated by their two exact Aegos-owned prefixes.
- Disable restores captured firewall profile defaults, removes both rule sets and markers, and verifies no Aegos artifact remains.
- Missing snapshots no longer force Windows default outbound policy to Allow.
- Source checkpoint; incorporated into the 3.6.16 acceptance installer.
