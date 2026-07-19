# Aegos 3.6.45

## Rule-page clarity

- Reworked the rules page into a compact task surface: website, application, and system entries are now a single horizontal choice instead of three explanatory cards.
- Shortened the default copy to the decision users need to make. Placeholders and accessible labels retain the full guidance without crowding the visual layout.
- Kept the safe draft workflow visible in one compact status chip. The optional existing-rule test is now collapsed until requested.
- Website/app creation, validation, conflict feedback, atomic apply, rollback, and the no-current-connection-switch guarantee are unchanged.

## Verification

- `cargo check`, UI smoke, interaction smoke, product smoke, rule-page, website-rule, app-rule, system-rule, UX polish, and release audits passed.
- Stage 3 historical gates retained: 3.5.87 rules-page redefinition, 3.5.88 website wizard, 3.5.89 app wizard, 3.5.96 系统规则解释, and 3.5.99 historical gate / UX polish gates.
- Commands retained: `npm run audit:stage3-rules-page`, `npm run audit:stage3-website-rules`, `npm run audit:stage3-app-rules`, `npm run audit:stage3-system-rules`, and `npm run audit:stage3-ux-polish`.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.45_x64-setup.exe`
- SHA-256: `35D49D883F86CF074FCCE8F38AF84DA632460D663CA87E28714798701E07A6F5`
