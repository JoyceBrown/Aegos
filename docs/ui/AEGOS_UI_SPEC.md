# Aegos UI Product Specification

## Product position

Aegos is a calm network control application. It tells the user whether traffic is connected, which node and mode are active, whether Windows takeover is complete, what is running in the background, and how to recover from a problem.

## Information architecture

- Home: connection truth, current node, outbound IP, latency, takeover summary, traffic, and immediate actions.
- Nodes: compare, filter, test, select, favorite, edit, and route through nodes.
- Connections: explain active destinations and close connections safely.
- Rules: create and verify ordinary-language website/application routing intent.
- Subscriptions: import, update, rename, switch, and diagnose subscription sources.
- Diagnostics: diagnose, repair, inspect redacted evidence, and export support reports. Logs stay inside this page.
- Settings: configure ordinary network behavior and separated advanced options.

## App Shell

- The sidebar contains brand, primary navigation, and one compact runtime summary.
- Detailed takeover state and background tasks live in the status center.
- The status center is reachable without changing pages and closes with Escape or the backdrop.
- Network-changing work never blocks navigation or the status center.
- Window drag and resize regions remain independent of interactive controls.

## User-language boundary

Ordinary surfaces use Aegos language. Raw controller addresses, secrets, YAML errors, and Mihomo implementation terms remain in redacted technical evidence only when necessary.
