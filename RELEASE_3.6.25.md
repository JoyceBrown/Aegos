# Aegos 3.6.25

## Visual architecture

- Consolidated the authoritative visual and geometry variables into one Stage 7 token layer.
- Defined semantic surface, text, border, status, focus, shadow, and motion tokens.
- Removed historical height-specific root overrides that resolved to the same final values.
- Froze the 3.6.24 literal Tauri command surface to prevent visual work from changing network behavior.

## Gate

`npm run audit:stage7-visual`
