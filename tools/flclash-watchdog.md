# FlClash Watchdog

`flclash-watchdog.ps1` is a lightweight unattended recovery helper for the current development machine.
It keeps Codex on FlClash `7890`, probes network health through that proxy, tests candidate routes through
the mihomo delay API, and switches the active FlClash proxy group to the lowest-latency reachable candidate
when repeated failures are detected.

## Required FlClash Setting

FlClash must enable the external controller:

- FlClash -> Settings -> General -> External Controller
- Expected local controller: `http://127.0.0.1:9090`

This setting is confirmed in the FlClash source:

- `lib/enum/enum.dart`: `ExternalControllerStatus.open('127.0.0.1:9090')`
- `lib/views/config/general.dart`: the UI switch writes `externalController`
- `lib/common/task.dart`: the generated runtime config writes `external-controller`

The watchdog does not change FlClash `mixed-port`. Keep FlClash on `7890`; Aegos development should keep using
its separate defaults, such as `7891` and `19091`.

## One-Time Probe

Dry run, no route switch:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\AI Project\Codex\测试\AegosRoute\tools\flclash-watchdog.ps1" -Once
```

Simulate a broken proxy and preview the next route:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\AI Project\Codex\测试\AegosRoute\tools\flclash-watchdog.ps1" -Once -ProxyUri "http://127.0.0.1:1" -FailureThreshold 1
```

## Unattended Run

Active route switching:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\AI Project\Codex\测试\AegosRoute\tools\flclash-watchdog.ps1" -Switch
```

The switch path is:

1. Probe `7890` with the configured test URLs.
2. After `FailureThreshold` consecutive failures, read `/proxies` from `127.0.0.1:9090`.
3. Prefer the active selector group, normally `Proxies`.
4. Test candidates with `/proxies/{name}/delay`.
5. Pick the reachable candidate with the lowest delay under `MaxCandidateDelayMs`.
6. Switch only when `-Switch` is present, then retest `7890`.

Useful tuning options:

```powershell
-CandidateDelayTimeoutMs 3500
-MaxCandidateDelayMs 2000
-MaxCandidatesPerGroup 20
-PreferredCandidates HK,JP,SG,TW,US
```

Suggested scheduled task:

```powershell
schtasks /Create /TN "FlClash Codex Watchdog" /SC ONLOGON /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"E:\AI Project\Codex\测试\AegosRoute\tools\flclash-watchdog.ps1\" -Switch"
```

Logs are written to:

```text
E:\AI Project\Codex\测试\AegosRoute\tools\flclash-watchdog.log
```

## Double-Click Mode

For normal use, open this folder:

```text
E:\AI Project\Codex\测试\AegosRoute\tools
```

Then use:

```text
双击启动-FlClash守护.bat
双击关闭-FlClash守护.bat
```

The start file launches the watchdog in a minimized PowerShell window and writes:

```text
flclash-watchdog.pid
```

The stop file reads that PID and stops only the watchdog script. It does not stop FlClash, FlClashCore, Aegos,
or Codex.

## Boundary

The watchdog can safely switch mihomo proxy groups through `/proxies/{group}`.
It does not switch FlClash subscriptions, because subscription/profile selection is FlClash application state,
not a stable capability exposed by the mihomo controller. For unattended development, route switching is the safe
first layer; subscription switching should be implemented only if FlClash exposes a stable API or Aegos owns the
profile manager directly.

For the current machine, FlClash app data includes `database.sqlite`, `shared_preferences.json`, and a `profiles`
directory. Those files prove FlClash keeps subscription/profile state locally, but the public controller currently
used by the watchdog exposes proxy switching, not app-level subscription switching. Editing those files while
FlClash and Codex are using the network can corrupt state or interrupt the current proxy session.
