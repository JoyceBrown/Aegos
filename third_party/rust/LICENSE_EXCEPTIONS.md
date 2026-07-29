# Rust crate license-text exceptions

The notice generator normally reads license and notice files directly from
each crate archive in Cargo's locked Windows x64 MSVC normal/build graph. Ten
crate archives omit those files even though their normalized Cargo metadata
declares a license. The generator fails closed unless it can supply the
following fixed equivalents and verify their hashes:

| Affected crate(s) | Declared license | Supplied material |
| --- | --- | --- |
| `alloc-stdlib 0.2.4` | BSD-3-Clause | `alloc-no-stdlib 2.0.4/LICENSE` from the same fixed upstream repository and release family |
| `selectors 0.36.1` | MPL-2.0 | `cssparser 0.36.0/LICENSE`, the unmodified MPL-2.0 text already present in the same locked Servo dependency graph |
| `unic-char-property`, `unic-char-range`, `unic-common`, `unic-ucd-ident`, `unic-ucd-version` 0.9.0 | MIT/Apache-2.0 | unmodified `anyhow 1.0.103` standard MIT and Apache-2.0 texts plus the fixed rust-unic copyright notice below |
| `webview2-com 0.38.2`, `webview2-com-sys 0.38.2`, `webview2-com-macros 0.8.1` | MIT | fixed upstream `webview2-rs` MIT license below |

Pinned upstream-only notices retained in this directory:

- `rust-unic-COPYRIGHT.md` comes from
  `open-i18n/rust-unic@5878605364af97a3358368a6eaef02104af2e016`.
- `webview2-rs-LICENSE` comes from
  `wravery/webview2-rs@b74dc5e2b394044bea5191052868ce7a106c202c` and is
  byte-identical at the macros crate commit
  `dffa41a8a46d3f5565eefbff2de57d38d399f158`.

These substitutions do not change any license choice. They only ensure the
installer carries complete texts when a crates.io archive omitted them.
