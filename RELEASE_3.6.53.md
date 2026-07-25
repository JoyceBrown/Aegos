# Aegos 3.6.53

## Scope

- Preserve the startup measurement-only speed test so every launch verifies
  that the current node set is usable without switching the selected node.
- Improve visible subscription, fixed-node, routing, diagnostics, and
  small-window behavior.
- Continue reducing legacy control-plane ownership without duplicating Mihomo
  inside Aegos.

## Changes

- Subscription cards now show node, strategy-group, rule, format, update,
  traffic, and expiry information when the source provides it.
- Subscription activation is now an explicit action. Update and health-check
  actions remain visible, while rename, URL editing, and deletion live in the
  overflow menu.
- Remote subscription addresses can be replaced transactionally. The new
  source is downloaded, parsed, compiled, and runtime-validated before the
  stored address changes; stale downloads and oversized responses are rejected.
- Local YAML and text subscriptions can be imported through the same guarded
  deployment path.
- Non-active subscriptions can be preflighted without switching the active
  subscription or selected node.
- Landing-IP lookup races six HTTPS providers within a 3.2-second budget.
  Temporary failures retain a visibly stale cached value instead of reporting
  it as fresh.
- Fixed-node right-click actions keep a stable menu shell while relay-group
  data hydrates in place. The opening transition no longer scales text, and
  reduced-motion preferences remain respected.
- Fixed-node save/delete operations now use their dedicated runtime semantics,
  and credentials are redacted from public status, settings, and diagnostic
  snapshots.
- The add-fixed-node command is now contextual to the Fixed Nodes view. It
  remains aligned at the right side of that view's header and no longer appears
  while browsing common regions, favorites, or frequently used nodes.
- The routing page exposes draft undo, verification, and apply actions in the
  first viewport, and advanced rules are paginated at 40 rows.
- The home shell is denser: the sidebar runtime card is removed, the sidebar
  is narrower, and the connection overview and quick-action rows use less
  vertical space.
- Duplicate home network-availability and system-proxy metrics are removed.
  System proxy remains available in Settings and its runtime truth remains in
  the status center.
- Quick actions use a fixed thirteen-command catalog. Speed test, subscription
  update, disconnect protection, and subscription switching remain the
  defaults; diagnostics, network recovery, current-node testing, node refresh,
  all-subscription update, and common management pages can be selected instead.
  The home page renders at most four resident commands.
- The application now opens at its supported 920 x 640 minimum size. The home
  TUN control removes redundant disabled-state copy and keeps its switch
  vertically centered without text overflow.
- Common regions are now a persistent user workspace. Right-click a region or
  the empty region row to add, rename, delete, move, or restore entries; the
  region code continues to drive node filtering, and extended lists scroll
  horizontally instead of compressing labels.
- Quick-action labels and command identities are fixed. Their right-click menu
  is a compact three-column picker for the one to four commands that stay on
  Home. At the four-button limit, choosing another command replaces the
  right-clicked button in place; order and defaults remain persistent. Legacy
  custom labels are safely ignored during preference migration.
- The nine current-node readings now live in an unframed information section
  at the bottom of the sidebar. Quick actions move below the current node,
  removing a separate home-page row and returning more height to the node list.
- The interface hierarchy is flatter throughout: page containers no longer
  masquerade as cards, home and node entries use continuous table rows,
  settings use divided groups, and routing and diagnostic work areas retain
  only boundaries that communicate selection, severity, or workflow state.
- Primary commands now use a flat blue fill, restrained 6 px control radii,
  and no decorative gradient, hover lift, or shadow. Page headings and helper
  copy share one compact type hierarchy.
- Node-page commands and filters are split into two stable rows. Strategy
  groups remain above the decision-focused node table, while row actions stay
  visually quiet until hover, focus, or selection.
- The rules page defaults to a compact website/application builder. Summary
  details, low-level generated rules, and existing-rule tests remain collapsed
  until requested; the draft workspace appears only when there is a draft or a
  rollback is available, with no duplicate action bar or repeated empty state.
- Subscription import actions now share one toolbar, and subscriptions render
  as a four-column comparison list with stable content, status, and action
  columns instead of isolated cards. Missing traffic, expiry, or health data
  uses explicit placeholders without shifting the row.
- Network settings follow one reading path with separate takeover, DNS, and
  security/compatibility groups. The 980 px layout removes only redundant
  group-level helper copy while retaining each control's explanation.
- The window shell now uses a flush gray-and-white split with no decorative
  outer gutter. The sidebar has more usable status width, while the home
  connection area, common regions, node tables, settings rows, and diagnostic
  rows use whitespace and quiet alternating surfaces instead of repeated
  divider lines.
- Home node columns now stop growing after the useful name width, keeping
  latency and status close to the node name instead of leaving a large empty
  middle. TUN and quick-action icon/label pairs are grouped as single controls.
- The sidebar node-status section uses larger 12 px readings, 18 px icons, and
  taller rows. At the 980 x 640 minimum, titlebar controls, the mode selector,
  and the fixed-node action retain visible edge clearance.
- The status center is narrowed to 320 px. Home and node tables omit the
  address display column, while editing, diagnostics, and routing retain the
  underlying endpoint data. The low-value recent-node filter is removed.
- Rules-page DOM construction now lives in `src/routing-ui.js`; `app.js`
  retains state, events, and backend coordination through a single UI factory.
- User-visible backend copy for port selection, direct diagnostics, profile
  naming, and built-in profile protection is valid UTF-8 Chinese.
- The application minimum window is 920 x 640, with verified layout across
  supported viewport sizes and DPI scales.
- Only the all-subscriptions update remains cancellable. Other tasks reject
  unsafe cancellation, and cancelled jobs cannot later become successful.

## Verification

- 189 Rust unit tests
- JavaScript syntax checks for the application and routing UI module
- Full interaction smoke, including exactly one startup speed test with no
  connection or node-selection changes, plus persistent region and quick-action
  customization with no backend side effects
- 800-node release performance baseline: all streamed results completed in
  about 527 ms with a speed-test frame P95 of about 16.8 ms
- Optional 8,000-node stress lane retained outside the normal release baseline
- UI smoke across 920 x 640 through 1700 x 900 and 1.0 through 2.0 DPI,
  including pixel-centered TUN controls, grouped quick-action icon/label pairs,
  the four-action limit, contextual fixed-node creation, two-row node tools,
  hidden empty rule drafts, four-column subscriptions, semantic settings
  groups, and extended horizontally scrolling region lists
- Backend, subscription product/runtime, landing-IP, routing, UI architecture,
  copy encoding, and release audits
- FlClash was not stopped or modified during development and validation

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.53_x64-setup.exe`
- Size: `16221854` bytes
- SHA-256: `4aa18cc2911cc51c4972d81dd7109bda37d9bdb02d1cd115fa01d473ef463aac`
