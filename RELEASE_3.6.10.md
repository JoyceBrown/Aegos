# Aegos 3.6.10

Stage 5.2: startup recovery after an unclean exit.

- An independent active-takeover lease records applied system proxy, firewall, and TUN ownership.
- Startup handles both interrupted transactions and a previously verified takeover left by a crash or Task Manager termination.
- Recovery failures remain visible instead of being silently marked complete.
- Source checkpoint; incorporated into the 3.6.16 acceptance installer.
