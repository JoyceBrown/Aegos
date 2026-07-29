# Aegos Documentation Index

This page routes each current topic to one canonical owner. It does not create
execution authority. Historical files are traceability records only.

## Current Authority And Facts

| Topic | Canonical owner |
| --- | --- |
| Project overview, setup, commands, and current limitations | [`../README.md`](../README.md) |
| Product outcome, Windows scope, and non-goals | [`product.md`](product.md) |
| Module ownership and system boundaries | [`architecture.md`](architecture.md) |
| Long-term Windows real-use reliability direction and conditional outcomes | [`roadmap.md`](roadmap.md) |
| Executable plan, when marked active/exclusive; completed REL-01 contract otherwise | [`../PLANS.md`](../PLANS.md) |
| Current task, dirty-worktree facts, verification, and exact next action | [`work/current.md`](work/current.md) |
| Current local candidate source record | [`../RELEASE_3.6.71.md`](../RELEASE_3.6.71.md) |
| Published v3.6.70 closure and final evidence | [`work/release-3.6.70-rel01.md`](work/release-3.6.70-rel01.md) |
| Aegos license, third-party notices, and managed Mihomo provenance | [`../LICENSE`](../LICENSE), [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md), and [`../third_party/mihomo/provenance.json`](../third_party/mihomo/provenance.json) |
| LIC-01 local packaging and payload evidence | [`work/license-packaging-lic01.md`](work/license-packaging-lic01.md) |
| DG-01 source closure, isolated-Windows probe, and Windows CI evidence | [`work/delivery-governance-dg01.md`](work/delivery-governance-dg01.md) |
| Verified maintenance gaps and priority recommendations | [`maintenance.md`](maintenance.md) |

## Product And Architecture References

| Topic | Canonical owner |
| --- | --- |
| Windows reliability route decision and rationale | [`decisions/windows-reliability-mainline.md`](decisions/windows-reliability-mainline.md) |
| Control-plane baseline and acceptance | [`../CONTROL_PLANE_BASELINE.md`](../CONTROL_PLANE_BASELINE.md) and [`../CONTROL_PLANE_ACCEPTANCE.md`](../CONTROL_PLANE_ACCEPTANCE.md) |
| Aegos/Mihomo boundary | [`../CONTROL_PLANE_BOUNDARY_3.6.49.md`](../CONTROL_PLANE_BOUNDARY_3.6.49.md) |
| Mihomo Controller API boundary | [`../core-api-contract.md`](../core-api-contract.md); future endpoint rows are safety criteria, not tasks |
| UI tokens and interaction rules | [`ui/AEGOS_UI_SPEC.md`](ui/AEGOS_UI_SPEC.md) and [`ui/DESIGN_TOKENS.md`](ui/DESIGN_TOKENS.md) |
| Closed task evidence | Individual registers under [`work/`](work/); the pre-consolidation checkpoint is under [`work/archive/`](work/archive/) |

## Historical Planning Archive

The following documents are historical records. Their execution authority is
none. They remain because historical audit commands still inspect their
versioned evidence. Removing them would silently break those guards. Do not
select work from them, reconcile their task lists, or update them as a current
plan.

Their retained status is intentional: current product direction, roadmap,
plan and checkpoint information has been moved to the owners above.
No historical document may become active again without a new user-approved
roadmap decision and an explicit plan migration.

| Historical record | Classification |
| --- | --- |
| CURRENT_MAINLINE_3.5.71_TO_3.6.40.md | Completed former mainline |
| docs/decisions/windows-maturity-mainline.md | Completed 3.6.58-3.6.62 Windows Maturity decision; superseded by the real-use reliability decision |
| PHASE_1_2_ALIGNMENT_3.5.85.md | Historical alignment review for the former mainline |
| DEVELOPMENT_HANDOFF_3.6.35.md | Former handoff |
| PRODUCT_MATURITY_GAP_REPORT.md, PRODUCT_MATURITY_RECOVERY_PLAN.md, and PRODUCT_MATURITY_3.4.11_TO_3.4.20_DETAILED.md | Completed maturity program and its historical baseline |
| ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md and ROUTING_PAGE_REAL_USER_EXECUTION_RECORD.md | Completed 3.4.20 routing acceptance evidence |
| ROADMAP_2.1.0.md, ROADMAP_2.4_TO_3.0.md, ROADMAP_2.7.14_TO_2.8.0.md, ROADMAP_2.9.12_TO_5.0_SECURITY.txt, and ROADMAP_3.0.0_TO_3.6.4.md | Superseded versioned roadmaps |
| docs/performance/PERFORMANCE_ROOT_CAUSE_AND_PLAN_3.6.32.md | Historical performance evidence |
| research/opensource-absorption-roadmap.md, research/opensource-reference.md, and research/opensource-absorption-standard.md | Reference-only research maps and evaluation standard |

Release notes are versioned delivery evidence, not plans. Performance JSON,
fixtures, screenshots, archived checkpoints, and research are evidence or
reference material, not task sources.
