# Aegos 3.6.51

## Scope

- Restore persisted fixed nodes into the offline and standby node catalog after
  application restart.
- Keep authenticated HTTP and SOCKS5 credentials available to the runtime while
  preventing password disclosure in the editor.

## Fixes

- The standby catalog now overlays typed `manual_nodes` onto a cloned source
  catalog before product shaping. The subscription source file remains
  unchanged.
- Fixed nodes remain visible, selectable, and testable without requiring the
  user to save them again after every restart.
- Username and TUIC-password rows are visually hidden for unrelated protocols.
- Password fields use masked input; UUID fields remain readable where needed.

## Verification

- 183 Rust unit tests, including persisted fixed-node standby restoration
- Full interaction smoke with authenticated SOCKS5 submission and field-state checks
- UI viewport/DPI, configuration-domain, security, installer, and release gates
- Live local proxy check returned HTTP 204 through the authenticated SOCKS5 node
- FlClash remained running and responsive throughout diagnosis and verification

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.51_x64-setup.exe`
- SHA-256: `7fb06c99882eab51c895a02a1fbb0d384740b0f061d37441c9d685151291af18`
