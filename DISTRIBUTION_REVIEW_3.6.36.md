# Aegos 3.6.36 Candidate Distribution Review

Status: **blocked for publication**. This is an engineering evidence record, not legal advice or a license grant.

## Candidate identity

- Candidate installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.36_x64-setup.exe`
- Installer SHA-256: `F1D78483FCA5C1B1C87EFFC5C9A3AF3D43637A58407D1350994082B956AC385E`
- Bundled data-plane file: `resources/core/mihomo.exe`
- Expected data-plane version: `v1.19.28`
- Expected data-plane SHA-256: `c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517`

The version and hash above are the runtime identity contract in `src-tauri/src/core_runtime.rs`. A release operator must independently hash the shipped bundle contents before publication.

## Evidence present in the repository

| Component | Evidence | Recorded status |
| --- | --- | --- |
| Fluent UI System Icons subset | `third_party/fluent-ui-system-icons/LICENSE` and `docs/ui/LICENSE_AUDIT.md` | MIT license text and pinned-subset record are present. |
| Mihomo data plane | `resources/core/mihomo.exe`; upstream [license file](https://github.com/MetaCubeX/mihomo/blob/Alpha/LICENSE) | Binary identity is pinned locally; upstream license text must be reviewed against the exact distributed source revision and asset. |
| Aegos application code | No repository-root project `LICENSE` exists. | Owner decision is required before publication. |

## Publication blockers

1. The owner must choose and add the Aegos project license, including any required copyright/notice text.
2. The release operator must record the exact Mihomo upstream revision or release asset from which this executable was obtained, its source acquisition location, and the matching license/notice materials.
3. The owner or qualified counsel must determine the resulting distribution obligations and approve the installer contents, accompanying notices, and source-offer/source-delivery approach before publication.
4. The final installer must be inspected after packaging to confirm that the approved license and notice materials are actually included or otherwise delivered by the approved mechanism.

Until all four checkpoints are closed with dated, reviewable evidence, this candidate must not be uploaded, tagged as released, or presented as redistributable.
