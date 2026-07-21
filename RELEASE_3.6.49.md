# Aegos 3.6.49

## Scope

- Close the remaining control-plane ownership gaps without changing the
  bundled Mihomo data plane.
- Move persisted product configuration, shared atomic storage, bounded Windows
  process execution, and speed-test domain types out of legacy orchestration.
- Introduce a narrow typed data-plane capability boundary and admission
  manifest for the currently approved Mihomo artifact.
- Freeze `main.rs` and `core_runtime.rs` under explicit no-growth budgets.

## Architecture

- `app_config.rs` owns profiles, settings, and persisted user intent.
- `dataplane.rs` owns engine identity, capability admission, and the
  product-facing `DataplaneControl` port.
- `storage_runtime.rs` owns path-confined atomic writes and content digests.
- `windows_process.rs` owns the only hidden, timeout-bounded PowerShell launch
  path and child cleanup.
- `speed_runtime.rs` owns measurement state, targets, catalogs, and results.
- Mihomo continues to own protocols, forwarding, DNS/TUN primitives, and rule
  execution. Aegos does not contain a second proxy engine.

## Safety

- No FlClash process, proxy setting, or network state is changed by the release
  verification path.
- Controller secrets and runtime YAML remain behind the Rust boundary.
- Speed tests remain measurement-only and cannot switch nodes or enable traffic
  takeover.
- Existing transactional deployment, rollback, and takeover recovery behavior
  is preserved.

## Verification

- 181 Rust unit tests
- Control-plane, backend, responsiveness, core-runtime, and architecture audits
- Existing security, runtime regression, interaction, UI, installer, and
  release gates
- Managed Mihomo v1.19.28 identity and SHA-256 verification

```powershell
npm run audit:runtime-regression
npm run audit:installer-regression
npm run audit:stability
npm run audit:core-runtime
```

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.49_x64-setup.exe`
- SHA-256: `91ba46f45a0c1050911e317889e42f00ebfb4beed985fcbd79437664f9262254`
