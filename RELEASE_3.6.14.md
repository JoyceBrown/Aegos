# Aegos 3.6.14

Stage 5.6: abnormal-exit recovery coverage.

- Fault-injection tests cover interrupted journals, recovery-required failures, and active takeover leases.
- Managed stale core termination is limited to the exact bundled executable path.
- Normal exit restores system proxy and disconnect-protection state, stops TUN, and clears its active lease.
- Administrator-level forced-exit checks remain an explicit real-machine acceptance item.
- Source checkpoint; incorporated into the 3.6.16 acceptance installer.
