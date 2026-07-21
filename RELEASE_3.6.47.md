# Aegos 3.6.47

## Speed feedback and provider health fix

- Batch speed results now enter the shared node state during foreground
  navigation, while direct DOM writes remain deferred. Ordinary subscriptions
  therefore show their first usable delays without waiting for the foreground
  quiet window; very large streams remain coalesced behind the existing frame
  budget.
- The fast pass is now the user-facing result boundary. It reports an immediate
  `available / total` summary, keeps deep retries in the background, and restores
  the normal runtime notice automatically instead of leaving a large failure
  banner on the home page.
- Provider healthcheck now excludes Mihomo `Compatible` providers, which are
  inline proxy groups rather than remote subscription providers. Inline-node
  profiles direct users to batch speed testing instead of reporting those groups
  as subscription failures.
- Remote Provider summaries use factual availability counts and no longer turn
  an unsupported or non-responsive Provider endpoint into a blanket subscription
  failure claim.

## Verification

- Rust provider filtering test passed.
- Provider healthcheck, speed reform, speed closure, speed target,
  responsiveness, backend, node speed, status vocabulary, interaction, and UI
  gates passed.
- The existing streamed-event frame-pacing limitation remains reproducible on
  this host's software compositor. Thresholds were not weakened; see
  `PERFORMANCE_LIMITATION_3.6.46.md` for the host evidence and reopening criteria.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.47_x64-setup.exe`
- SHA-256: `514739c1b63f549c8eeb0e7cbbb7f6db16a8c1742e6318123660789d636ee00d`
