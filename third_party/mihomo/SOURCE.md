# Mihomo binary provenance

Aegos 3.6.71 carries one unmodified managed data-plane executable at
`resources/core/mihomo.exe`. It is not an Aegos implementation and remains
licensed by its upstream authors under GPL-3.0-only.

## Fixed upstream identity

- Project: [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)
- Release/tag: [`v1.19.28`](https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.28)
- Tag commit: [`cbd11db1e13a75d8e680e0fe7742c95be4cba2be`](https://github.com/MetaCubeX/mihomo/tree/cbd11db1e13a75d8e680e0fe7742c95be4cba2be)
- Official Windows asset: [`mihomo-windows-amd64-v1-v1.19.28.zip`](https://github.com/MetaCubeX/mihomo/releases/download/v1.19.28/mihomo-windows-amd64-v1-v1.19.28.zip)
- Asset size: `17,730,829` bytes
- Asset SHA-256: `e1a47d4eb9b864e242e92ef4d501b052241c7e4eb5a592f2b124959e8efb2312`

## Extracted executable

- Repository path: `resources/core/mihomo.exe`
- Size: `47,942,656` bytes
- SHA-256: `c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517`
- Version output: `Mihomo Meta v1.19.28 windows amd64 with go1.26.5`; build tags: `with_gvisor`
- Modification: none; the repository executable is byte-for-byte identical
  to the executable extracted from the fixed official `v1` archive above.

The compatible, standard, v2, and v3 Windows amd64 variants were not selected:
their extracted executables do not match the managed core already used by
Aegos. The machine-readable owner of these facts is
[`provenance.json`](provenance.json).

## License and corresponding source

The upstream GPL version 3 text is preserved without modification in
[`LICENSE`](LICENSE). Its SHA-256 is
`3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.
The corresponding source for this binary is the fixed upstream tag/commit
linked above. Aegos does not claim ownership of Mihomo and does not replace its
license or source obligations.
