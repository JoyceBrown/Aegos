# Aegos 3.6.32

Performance checkpoint with a Windows x64 installer for user verification.

## Plan item

Stage 8 / 3.6.32: measured performance pressure testing and evidence-driven optimization.

This checkpoint carries the authoritative `3.5.71 - 3.6.40` mainline without changing its product constraints.

## Implemented

- Moved current-node speed testing directly onto the displayed latency value and removed the separate circular lightning action; pending feedback now stays on the value without changing its width or blocking navigation.
- Replaced the unrelated single-frame green taskbar `A` and the separate sidebar glyph with one Aegos brand master: a Fluent `Shield 48 Filled` silhouette plus an original A-shaped routing path.
- Generated the sidebar PNG and the Windows executable, taskbar, and NSIS six-resolution ICO from the same SVG master, and explicitly pinned that icon in Tauri bundle configuration.
- Archived the exact Fluent shield source and extended MIT attribution without adding a runtime dependency.
- Replaced the mixed project-drawn UI glyphs with a pinned 38-icon subset of Microsoft Fluent UI System Icons at commit `9a1129bb2432b163b48044341664c68a3c100908` under the MIT license.
- Used Fluent Regular icons for normal controls and Filled variants only for active navigation and favorites, while keeping the Aegos brand mark project-owned.
- Embedded the selected SVGs into CSS masks so icons render under the packaged `file://` WebView without a runtime package, network request, icon font, or missing-file fallback.
- Archived upstream SVG source and its license outside the frontend source tree to preserve traceability without duplicating source assets in the application bundle.
- Standardized interface, display, and monospace typography on deterministic Windows font stacks headed by Segoe UI Variable and Microsoft YaHei UI, with tabular numerals for changing metrics.
- Evaluated Lucide, Tabler Icons, Phosphor Icons, and Radix Icons; Fluent was selected for Windows-native geometry and semantic coverage without adding a package dependency. Large CJK font binaries were deliberately not bundled.
- Replaced periodic full speed-result polling with per-node Tauri events, animation-frame-coalesced rendering, and a 1500 ms watchdog fallback.
- Added protocol-aware adaptive scheduling with bounded global concurrency and lower TUIC/AnyTLS family limits.
- Prioritized the current and visible nodes without serializing the entire subscription as a priority list.
- Extended the browser pressure fixture to 8000 nodes with 400 event results per stress burst.
- Covered rapid navigation, search, filter, sort, menu interaction, diagnostics, speed polling, DOM windowing, timer retention, heap sampling, and duplicate background polling.
- Replaced partial node indexing plus repeated linear fallback searches with a complete O(1) node-name index.
- Changed streamed speed results to patch visible rows immediately and rebuild/reorder the bounded list at a controlled interval.
- Stopped speed polling from rebuilding hidden node surfaces on every 180 ms status update.
- Prevented the global job-center poll from duplicating a job already being polled by its owning action.
- Expanded the deterministic mixed-operation soak from 8 to 16 cycles and added DOM, heap, and timer plateau samples.
- Re-ran the complete product smoke against 3.6.32 and recorded current-version journey evidence instead of carrying an older result forward.
- Invalidated prefetched routing data and in-flight routing requests on subscription changes so a late result cannot repaint rules from the previous subscription.
- Stopped unchanged status heartbeats from repainting hidden settings, node, subscription, and log surfaces.
- Coalesced visible-page reconciliation to the final animation frame during rapid navigation.
- Moved controller traffic and LAN-IP probes outside the global core mutex; failed LAN-IP probes are cached for 45 seconds.
- Started the routing snapshot as soon as the active profile is known and added a true cold-path rule-page test.
- Prepared cached diagnostics before page activation, removing its delayed content layout shift.
- Removed continuous backdrop blur from large static panels while retaining it for transient overlays.
- Canonicalized and deduplicated legacy mojibake auto-select groups in both the runtime config pipeline and node-page presentation.
- Replaced the conflicting native/pointer strategy drag paths with one pointer-captured, center-based reorder model.
- Kept the strategy sort toolbar and card strip inside one fixed grid region so sort mode cannot displace or cover the node table.
- Stopped settings navigation from automatically starting PowerShell, port, IPv4/IPv6, and DNS probes; checks now run explicitly and cache results without repainting a hidden page.
- Reorganized settings into network takeover, automatic recovery, system check, and collapsed advanced sections with one page-level scroll container.

## Before and after

Measured on the same local Chrome headless pressure fixture:

| Metric | Before | After optimization run |
| --- | ---: | ---: |
| Worst main-thread long task | 592 ms | 82 ms |
| Tasks at or above 180 ms | 18 | 0 |
| 420-change navigation P95 | 0.30 ms | 0.30 ms |
| Speed results delivered | 8000 | 8000 |
| Full status polls during healthy event stream | n/a | 0 |
| Visible node rows during active work | 24 | 24 |
| Duplicate list-level job polls | 0 | 0 |

Additional first-use page evidence with 3000 routing rules:

- The historical routing request delay was `557 ms`; routing data is now prefetched without building hidden DOM.
- Startup status became usable in `147 ms`; the first eight real home nodes appeared in `271 ms` with status and node reads dispatched together.
- Routing content became usable in `114 ms` in the final repeat run.
- Connections content became usable in `215 ms`.
- Collapsed routing details create `0` rule rows; opening took `3.4 ms`, and paging keeps a fixed maximum of `80` rows.
- Cold routing content after an immediate startup click: three-run median `201 ms`, worst `218 ms`.
- Startup status: three-run median `135 ms`, worst `141 ms`; home nodes median `205 ms`, worst `207 ms`.
- Windowed GPU navigation has no page-specific outlier: realistic navigation P95 `33.5 ms`, maximum `33.7 ms`, with layout shift `0.000014`. The test host's windowed Chrome is compositor-limited to about 30 FPS, so this evidence is used to detect regressions and page outliers, not to claim native WebView2 runs at 60 FPS.

The post-version evidence is generated by `npm run smoke:perf`, `npm run smoke:perf:headed`, `npm run smoke:perf:repeat`, and `npm run smoke:soak` in `PERFORMANCE_PRESSURE_3.6.32.json`, `PERFORMANCE_GPU_3.6.32.json`, `PERFORMANCE_REPEAT_3.6.32.json`, and `PERFORMANCE_SOAK_3.6.32.json`.

## Acceptance

```text
npm run smoke:perf
npm run smoke:perf:headed
npm run smoke:perf:repeat
npm run smoke:soak
npm run audit:stage8-performance
npm run audit:current-mainline
npm run smoke:interactions
npm run smoke:product
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

## Limits

- The browser fixtures prove UI scheduling, bounded rendering, task competition, and resource retention under deterministic load.
- Real airport connectivity, protocol handshakes, and kernel/network-driver performance are not simulated. Real airport and multi-protocol verification remains assigned to 3.6.37.
- Browser heap values include the test runtime and are used to detect retention trends, not as a native WebView2 memory guarantee.

## Verification

- UI smoke verifies the generated brand raster loads under the packaged `file://` model at every tested viewport and DPI; the visual audit verifies it and six Windows icon sizes share the same SVG source contract.
- Interaction smoke verifies the latency value is the sole current-node speed-test target, keeps fixed geometry while pending, remains navigation-safe, and never switches or connects a node.
- A same-host three-run comparison against untouched commit `f40a042` found the same intermittent headless software-compositor frame and startup spikes in both trees. Current median startup remained at least as fast (`147 ms` status / `228 ms` nodes versus baseline `155 ms` / `254 ms`), visual navigation stayed `16.8 ms` p95, and layout shift stayed zero; no performance threshold was relaxed.
- The visual audit proves all 38 archived Fluent SVGs are embedded exactly through the local registry, the MIT license and pinned source are preserved, and no unbundled Inter dependency remains.
- Multi-viewport UI smoke passed at 100%, 125%, 150%, 175%, and 200% device scale with zero visible icons missing masks, zero unlabeled icon buttons, and no new text or panel overflow.
- Home, node, settings, diagnostics, window controls, active navigation, quick actions, and row actions were visually inspected from generated screenshots.
- Performance pressure evidence passed with 8000 per-node results, zero full-result polls on the healthy event path, startup-content timing, and 420 rapid navigation changes.
- The 16-cycle mixed-operation soak passed with a stable DOM plateau and stable timer count.
- Interaction, product journey, UI, Rust test, Cargo check, current-mainline, and release gates were executed for this checkpoint.
- `PRODUCT_SMOKE_3.6.32.json` records the complete product smoke for the exact source version under review.

## Artifact

Current canonical build with the Fluent icon and Windows typography polish:

- Canonical bundle: `src-tauri/target/release/bundle/nsis/Aegos_3.6.32_x64-setup.exe`
- Size: `15,891,236` bytes
- SHA-256: `FA8C36EB382A581DF17F7186839EC12F6B5E57AB85F69DBC241A71750918DD19`
- Size change from the previous canonical 3.6.32 package: `+17,842` bytes (`+0.1124%`)
- Font payload change: `0` bytes; typography uses installed Windows fonts

The installer generated at the end of the earlier global performance pass is preserved for comparison only:

- `src-tauri/target/release/bundle/nsis/Aegos_3.6.32_x64-setup-performance.exe`
- Size: `15,862,085` bytes
- SHA-256: `654D42999AFF5888F221621CE96DD3B2592216503378912135E123468921C903`

The installer generated before the performance investigation is preserved for comparison only:

- `src-tauri/target/release/bundle/nsis/Aegos_3.6.32_x64-setup-baseline.exe`
- Size: `15,864,233` bytes
- SHA-256: `348B2B7723A61C2DD433C21DA4C1C9AA01773718D987C152B3A319F09D8B0DD2`
