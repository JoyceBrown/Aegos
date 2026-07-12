# Aegos 2.9.30 Architecture Debt Register

This register starts the architecture cleanup lane after 2.9.29. The goal is not to add features. The goal is to remove hidden fragility accumulated during earlier feature work.

## Stop Conditions

- `npm run audit:debt` passes.
- `npm run audit:architecture` passes.
- `npm run audit:release` passes.
- Interaction, performance, UI, and soak smoke tests pass.
- Rust `cargo test` and `npm run check` pass.
- No dynamic frontend `innerHTML` remains in production UI code.
- No unreviewed `#[allow(dead_code)]` remains in backend code.
- Critical config/settings/profile writes use path-confined atomic helpers.
- Old profile/config mutation paths are removed.
- Frontend state-changing operations use the unified action/background-job model.

## Debt Classes

1. Frontend render debt
   - Dynamic `innerHTML` list renderers.
   - Duplicated `renderProfiles` implementation.
   - Old commented renderers kept in `app.js`.

2. Frontend interaction debt
   - Local direct busy state writes.
   - Direct state-changing invokes outside the common action/job helpers.
   - Error and rollback behavior split across several call sites.

3. Backend file/config debt
   - Direct `fs::write` and `fs::copy`.
   - Non-atomic temporary file replacement.
   - File deletion without a path-confined wrapper.

4. Backend legacy path debt
   - `patch_profile_file_legacy`.
   - Old profile download/import/update methods kept as `dead_code`.
   - Compatibility Tauri mutation commands still exported alongside the job model.

5. Audit debt
   - Existing audits protect current behavior, but do not yet enforce complete debt removal.
   - `audit:debt` is the hard cleanup gate for this lane.
