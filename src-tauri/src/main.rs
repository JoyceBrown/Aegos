#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::random;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use serde_yaml::{Mapping, Value as YamlValue};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const APP_NAME: &str = "Aegos";
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize, Deserialize)]
struct Profile {
    id: String,
    name: String,
    #[serde(rename = "type")]
    profile_type: String,
    path: String,
    #[serde(default)]
    source_url: Option<String>,
    updated_at: String,
    digest: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Settings {
    active_profile_id: String,
    mixed_port: u16,
    controller_port: u16,
    secret: String,
    mode: String,
    system_proxy: bool,
    start_with_system_proxy: bool,
    kill_switch_enabled: bool,
    tun_enabled: bool,
    tun_stack: String,
    dns_hijack_enabled: bool,
    ipv6_enabled: bool,
    allow_lan: bool,
    log_level: String,
    profiles: Vec<Profile>,
}

#[derive(Clone, Serialize)]
struct LogEntry {
    at: String,
    level: String,
    line: String,
}

struct CoreManager {
    app_data: PathBuf,
    home_dir: PathBuf,
    profile_dir: PathBuf,
    core_path: PathBuf,
    settings_path: PathBuf,
    settings: Settings,
    process: Option<Child>,
    logs: Arc<Mutex<Vec<LogEntry>>>,
    last_traffic: JsonValue,
    lan_ip_cache: String,
    lan_ip_checked_at: u64,
}

struct AppState {
    core: Mutex<CoreManager>,
}

fn now_iso() -> String {
    format!("{}", now_secs())
}

fn now_secs() -> u64 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    secs
}

fn hex_random(bytes: usize) -> String {
    let raw: [u8; 32] = random();
    raw.iter().take(bytes).map(|b| format!("{b:02x}")).collect()
}

fn sha256_file(path: &Path) -> String {
    let data = fs::read(path).unwrap_or_default();
    format!("{:x}", Sha256::digest(data))
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| err.to_string())
}

fn yaml_key(name: &str) -> YamlValue {
    YamlValue::String(name.to_string())
}

fn set_yaml(config: &mut Mapping, key: &str, value: YamlValue) {
    config.insert(yaml_key(key), value);
}

fn get_mapping_mut(value: &mut YamlValue) -> &mut Mapping {
    if !matches!(value, YamlValue::Mapping(_)) {
        *value = YamlValue::Mapping(Mapping::new());
    }
    value.as_mapping_mut().expect("mapping")
}

fn default_settings() -> Settings {
    Settings {
        active_profile_id: "direct".to_string(),
        mixed_port: 7890,
        controller_port: 19090,
        secret: hex_random(24),
        mode: "rule".to_string(),
        system_proxy: false,
        start_with_system_proxy: true,
        kill_switch_enabled: false,
        tun_enabled: false,
        tun_stack: "mixed".to_string(),
        dns_hijack_enabled: true,
        ipv6_enabled: false,
        allow_lan: false,
        log_level: "info".to_string(),
        profiles: Vec::new(),
    }
}

fn load_settings(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(default_settings)
}

fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let raw = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn is_port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn find_free_port(current: u16, fallback: u16) -> Result<u16, String> {
    if is_port_free(current) {
        return Ok(current);
    }
    for port in fallback..fallback + 80 {
        if is_port_free(port) {
            return Ok(port);
        }
    }
    Err(format!("未找到可用端口: {fallback}-{}", fallback + 79))
}

fn ps_escape(value: impl AsRef<str>) -> String {
    value.as_ref().replace('\'', "''")
}

fn run_powershell(script: &str) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|err| err.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn primary_lan_ip() -> String {
    let script = r#"
$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if ($ip) { $ip } else { '-' }
"#;
    run_powershell(script).unwrap_or_else(|_| "-".to_string())
}

fn build_proxy_script(enable: bool, mixed_port: u16) -> String {
    let server = format!("127.0.0.1:{mixed_port}");
    let flag = if enable { 1 } else { 0 };
    let set_server = if enable {
        format!("Set-ItemProperty -Path $path -Name ProxyServer -Type String -Value '{server}'")
    } else {
        String::new()
    };
    format!(
        r#"
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value {flag}
{set_server}
Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value '<local>;localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2*;172.30.*;172.31.*;192.168.*'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinInet {{
  [DllImport("wininet.dll", SetLastError=true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}}
'@
[WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
"#
    )
}

fn build_kill_switch_script(enable: bool, user_data: &Path, core_path: &Path) -> String {
    let group = format!("{APP_NAME} Kill Switch");
    let snapshot = user_data.join("kill-switch-firewall-profile.json");
    let exe = std::env::current_exe().unwrap_or_default();
    let allow_rules = [exe, core_path.to_path_buf()]
        .into_iter()
        .filter(|p| p.exists())
        .enumerate()
        .map(|(index, program)| {
            format!(
                "New-NetFirewallRule -DisplayName '{} Allow {}' -Group '{}' -Direction Outbound -Action Allow -Program '{}' -Profile Any | Out-Null",
                ps_escape(&group),
                index + 1,
                ps_escape(&group),
                ps_escape(program.to_string_lossy())
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    if enable {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{ throw 'Kill Switch 需要管理员权限' }}
$snapshotPath = '{}'
New-Item -ItemType Directory -Path (Split-Path -Parent $snapshotPath) -Force | Out-Null
if (-not (Test-Path -LiteralPath $snapshotPath)) {{
  Get-NetFirewallProfile | Select-Object Name,DefaultOutboundAction | ConvertTo-Json | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
}}
Get-NetFirewallRule -Group '{}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
{}
Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block
"#,
            ps_escape(snapshot.to_string_lossy()),
            ps_escape(&group),
            allow_rules
        )
    } else {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{ throw '关闭 Kill Switch 需要管理员权限' }}
$snapshotPath = '{}'
if (Test-Path -LiteralPath $snapshotPath) {{
  $profiles = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
  foreach ($profile in @($profiles)) {{
    Set-NetFirewallProfile -Profile $profile.Name -DefaultOutboundAction $profile.DefaultOutboundAction
  }}
  Remove-Item -LiteralPath $snapshotPath -Force
}} else {{
  Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Allow
}}
Get-NetFirewallRule -Group '{}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
"#,
            ps_escape(snapshot.to_string_lossy()),
            ps_escape(&group)
        )
    }
}

impl CoreManager {
    fn new(app: &AppHandle) -> Result<Self, String> {
        let app_data = app.path().app_data_dir().unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_default()
                .join(".aegos-data")
        });
        let resource_dir = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
        let dev_core = std::env::current_dir()
            .unwrap_or_default()
            .join("resources")
            .join("core")
            .join("mihomo.exe");
        let bundled_core = resource_dir.join("core").join("mihomo.exe");
        let core_path = if bundled_core.exists() {
            bundled_core
        } else {
            dev_core
        };
        let home_dir = app_data.join("core-home");
        let profile_dir = app_data.join("profiles");
        let settings_path = app_data.join("settings.json");
        ensure_dir(&home_dir)?;
        ensure_dir(&profile_dir)?;
        let settings = load_settings(&settings_path);
        let mut manager = Self {
            app_data,
            home_dir,
            profile_dir,
            core_path,
            settings_path,
            settings,
            process: None,
            logs: Arc::new(Mutex::new(Vec::new())),
            last_traffic: json!({ "up": 0, "down": 0, "upTotal": 0, "downTotal": 0 }),
            lan_ip_cache: "-".to_string(),
            lan_ip_checked_at: 0,
        };
        manager.ensure_direct_profile()?;
        manager.save_settings()?;
        Ok(manager)
    }

    fn add_log(&self, line: impl AsRef<str>, level: &str) {
        let line = line.as_ref().trim();
        if line.is_empty() {
            return;
        }
        let mut logs = self.logs.lock().unwrap();
        logs.push(LogEntry {
            at: now_iso(),
            level: level.to_string(),
            line: line.to_string(),
        });
        if logs.len() > 700 {
            logs.remove(0);
        }
    }

    fn save_settings(&self) -> Result<(), String> {
        save_json(&self.settings_path, &self.settings)
    }

    fn ensure_direct_profile(&mut self) -> Result<(), String> {
        let path = self.profile_dir.join("direct.yaml");
        let config = self.patched_config(YamlValue::Mapping(Mapping::new()))?;
        fs::write(
            &path,
            serde_yaml::to_string(&config).map_err(|err| err.to_string())?,
        )
        .map_err(|err| err.to_string())?;
        if !self.settings.profiles.iter().any(|p| p.id == "direct") {
            self.settings.profiles.insert(
                0,
                Profile {
                    id: "direct".to_string(),
                    name: "直连诊断配置".to_string(),
                    profile_type: "builtin".to_string(),
                    path: path.to_string_lossy().to_string(),
                    source_url: None,
                    updated_at: now_iso(),
                    digest: sha256_file(&path),
                },
            );
        }
        Ok(())
    }

    fn active_profile(&self) -> Option<Profile> {
        self.settings
            .profiles
            .iter()
            .find(|p| p.id == self.settings.active_profile_id)
            .cloned()
            .or_else(|| self.settings.profiles.first().cloned())
    }

    fn patched_config(&self, source: YamlValue) -> Result<YamlValue, String> {
        let mut config = match source {
            YamlValue::Mapping(map) => map,
            _ => Mapping::new(),
        };
        for key in [
            "port",
            "socks-port",
            "redir-port",
            "tproxy-port",
            "mixed-port",
        ] {
            config.remove(yaml_key(key));
        }
        set_yaml(
            &mut config,
            "mixed-port",
            YamlValue::Number(self.settings.mixed_port.into()),
        );
        set_yaml(
            &mut config,
            "allow-lan",
            YamlValue::Bool(self.settings.allow_lan),
        );
        set_yaml(
            &mut config,
            "bind-address",
            YamlValue::String(
                if self.settings.allow_lan {
                    "*"
                } else {
                    "127.0.0.1"
                }
                .to_string(),
            ),
        );
        set_yaml(
            &mut config,
            "mode",
            YamlValue::String(self.settings.mode.clone()),
        );
        set_yaml(
            &mut config,
            "log-level",
            YamlValue::String(self.settings.log_level.clone()),
        );
        set_yaml(
            &mut config,
            "external-controller",
            YamlValue::String(format!("127.0.0.1:{}", self.settings.controller_port)),
        );
        set_yaml(
            &mut config,
            "secret",
            YamlValue::String(self.settings.secret.clone()),
        );
        set_yaml(
            &mut config,
            "ipv6",
            YamlValue::Bool(self.settings.ipv6_enabled),
        );
        set_yaml(
            &mut config,
            "find-process-mode",
            YamlValue::String("strict".to_string()),
        );

        if self.settings.tun_enabled {
            let tun = config
                .entry(yaml_key("tun"))
                .or_insert_with(|| YamlValue::Mapping(Mapping::new()));
            let tun_map = get_mapping_mut(tun);
            set_yaml(tun_map, "enable", YamlValue::Bool(true));
            set_yaml(
                tun_map,
                "stack",
                YamlValue::String(self.settings.tun_stack.clone()),
            );
            set_yaml(tun_map, "auto-route", YamlValue::Bool(true));
            set_yaml(tun_map, "auto-detect-interface", YamlValue::Bool(true));
            set_yaml(
                tun_map,
                "dns-hijack",
                if self.settings.dns_hijack_enabled {
                    YamlValue::Sequence(vec![YamlValue::String("any:53".to_string())])
                } else {
                    YamlValue::Sequence(Vec::new())
                },
            );
        } else if let Some(tun) = config.get_mut(yaml_key("tun")) {
            set_yaml(get_mapping_mut(tun), "enable", YamlValue::Bool(false));
        }

        if !matches!(config.get(yaml_key("rules")), Some(YamlValue::Sequence(items)) if !items.is_empty())
        {
            set_yaml(
                &mut config,
                "rules",
                YamlValue::Sequence(vec![YamlValue::String("MATCH,DIRECT".to_string())]),
            );
        }
        Ok(YamlValue::Mapping(config))
    }

    fn patch_profile_file(&mut self, profile: &Profile) -> Result<(), String> {
        let path = PathBuf::from(&profile.path);
        let source: YamlValue = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_yaml::from_str(&raw).ok())
            .unwrap_or_else(|| YamlValue::Mapping(Mapping::new()));
        let patched = self.patched_config(source)?;
        fs::write(
            &path,
            serde_yaml::to_string(&patched).map_err(|err| err.to_string())?,
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn ensure_runtime_ports(&mut self) -> Result<(), String> {
        self.settings.mixed_port = find_free_port(self.settings.mixed_port, 7890)?;
        self.settings.controller_port = find_free_port(self.settings.controller_port, 19090)?;
        self.save_settings()
    }

    fn start(&mut self) -> Result<JsonValue, String> {
        if self.process.is_some() {
            return Ok(json!({ "ok": true, "message": "Core already running" }));
        }
        if !self.core_path.exists() {
            return Err(format!(
                "mihomo core not found: {}",
                self.core_path.display()
            ));
        }
        self.ensure_runtime_ports()?;
        let profile = self
            .active_profile()
            .ok_or_else(|| "没有活动配置".to_string())?;
        self.patch_profile_file(&profile)?;
        ensure_dir(&self.home_dir)?;
        self.add_log(format!("Starting mihomo: {}", profile.name), "info");
        let mut command = Command::new(&self.core_path);
        command
            .args(["-d", &self.home_dir.to_string_lossy(), "-f", &profile.path])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = command.spawn().map_err(|err| err.to_string())?;
        if let Some(stdout) = child.stdout.take() {
            let logs = self.logs.clone();
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().flatten() {
                    let mut logs = logs.lock().unwrap();
                    logs.push(LogEntry {
                        at: now_iso(),
                        level: "core".to_string(),
                        line,
                    });
                    if logs.len() > 700 {
                        logs.remove(0);
                    }
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let logs = self.logs.clone();
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().flatten() {
                    let mut logs = logs.lock().unwrap();
                    logs.push(LogEntry {
                        at: now_iso(),
                        level: "warn".to_string(),
                        line,
                    });
                    if logs.len() > 700 {
                        logs.remove(0);
                    }
                }
            });
        }
        self.process = Some(child);
        self.wait_for_controller()?;
        if self.settings.start_with_system_proxy || self.settings.system_proxy {
            self.set_system_proxy(true)?;
        }
        Ok(json!({ "ok": true }))
    }

    fn stop(&mut self) -> Result<JsonValue, String> {
        let _ = self.set_system_proxy(false);
        if let Some(mut child) = self.process.take() {
            self.add_log("Stopping mihomo", "info");
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(json!({ "ok": true }))
    }

    fn wait_for_controller(&self) -> Result<(), String> {
        for _ in 0..32 {
            if self.controller("GET", "/version", None, 1000).is_ok() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err("mihomo 控制接口未在 8 秒内就绪".to_string())
    }

    fn controller(
        &self,
        method: &str,
        endpoint: &str,
        body: Option<JsonValue>,
        timeout_ms: u64,
    ) -> Result<JsonValue, String> {
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .map_err(|err| err.to_string())?;
        let url = format!(
            "http://127.0.0.1:{}{}",
            self.settings.controller_port, endpoint
        );
        let method =
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|err| err.to_string())?;
        let mut req = client
            .request(method, url)
            .bearer_auth(&self.settings.secret);
        if let Some(body) = body {
            req = req.json(&body);
        }
        let res = req.send().map_err(|err| err.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Controller HTTP {}", res.status()));
        }
        let text = res.text().map_err(|err| err.to_string())?;
        if text.trim().is_empty() {
            return Ok(json!({}));
        }
        serde_json::from_str(&text).or_else(|_| {
            text.lines()
                .find_map(|line| serde_json::from_str::<JsonValue>(line).ok())
                .ok_or_else(|| "Controller response is not JSON".to_string())
        })
    }

    fn status(&mut self) -> JsonValue {
        if let Some(child) = self.process.as_mut() {
            if matches!(child.try_wait(), Ok(Some(_))) {
                self.process = None;
            }
        }
        let running = self.process.is_some();
        let version = if running {
            self.controller("GET", "/version", None, 450).ok()
        } else {
            None
        };
        let traffic = if running {
            self.controller("GET", "/traffic", None, 450)
                .unwrap_or_else(|_| self.last_traffic.clone())
        } else {
            json!({ "up": 0, "down": 0, "upTotal": 0, "downTotal": 0 })
        };
        self.last_traffic = traffic.clone();
        let lan_ip = self.cached_lan_ip();
        json!({
            "product": "Aegos",
            "appVersion": env!("CARGO_PKG_VERSION"),
            "runtime": "mihomo",
            "shell": "tauri",
            "running": running,
            "controller": version.is_some(),
            "version": version,
            "traffic": traffic,
            "mode": self.settings.mode,
            "systemProxy": self.settings.system_proxy,
            "activeProfile": self.active_profile(),
            "network": {
                "lanIp": lan_ip,
                "proxyEndpoint": format!("127.0.0.1:{}", self.settings.mixed_port),
                "outboundIp": "-"
            },
            "settings": self.public_settings(),
            "protection": self.protection_status(),
            "logs": self.logs.lock().unwrap().clone()
        })
    }

    fn cached_lan_ip(&mut self) -> String {
        let now = now_secs();
        if now.saturating_sub(self.lan_ip_checked_at) < 45 && self.lan_ip_cache != "-" {
            return self.lan_ip_cache.clone();
        }
        self.lan_ip_cache = primary_lan_ip();
        self.lan_ip_checked_at = now;
        self.lan_ip_cache.clone()
    }

    fn public_settings(&self) -> JsonValue {
        json!({
            "activeProfileId": self.settings.active_profile_id,
            "mixedPort": self.settings.mixed_port,
            "controllerPort": self.settings.controller_port,
            "profiles": self.settings.profiles,
            "startWithSystemProxy": self.settings.start_with_system_proxy,
            "systemProxy": self.settings.system_proxy,
            "killSwitchEnabled": self.settings.kill_switch_enabled,
            "tunEnabled": self.settings.tun_enabled,
            "tunStack": self.settings.tun_stack,
            "dnsHijackEnabled": self.settings.dns_hijack_enabled,
            "ipv6Enabled": self.settings.ipv6_enabled,
            "allowLan": self.settings.allow_lan,
            "logLevel": self.settings.log_level,
            "runtimes": { "mihomo": self.core_path.exists() }
        })
    }

    fn protection_status(&self) -> JsonValue {
        let running = self.process.is_some();
        let level = if !running {
            "idle"
        } else if self.settings.kill_switch_enabled && self.settings.tun_enabled {
            "strict"
        } else if self.settings.kill_switch_enabled {
            "guarded"
        } else if self.settings.tun_enabled {
            "tunnel"
        } else if self.settings.system_proxy {
            "proxy"
        } else {
            "partial"
        };
        let label = match level {
            "strict" => "强保护",
            "guarded" => "防断连保护",
            "tunnel" => "全局接管",
            "proxy" => "系统代理",
            "partial" => "仅内核运行",
            _ => "未接管",
        };
        json!({ "level": level, "label": label })
    }

    fn set_system_proxy(&mut self, enable: bool) -> Result<bool, String> {
        run_powershell(&build_proxy_script(enable, self.settings.mixed_port))?;
        self.settings.system_proxy = enable;
        self.save_settings()?;
        self.add_log(
            if enable {
                "系统代理已开启"
            } else {
                "系统代理已关闭"
            },
            "info",
        );
        Ok(enable)
    }

    fn set_kill_switch(&mut self, enable: bool) -> Result<bool, String> {
        run_powershell(&build_kill_switch_script(
            enable,
            &self.app_data,
            &self.core_path,
        ))?;
        self.settings.kill_switch_enabled = enable;
        self.save_settings()?;
        Ok(enable)
    }

    fn update_setting(&mut self, key: &str, value: JsonValue) -> Result<JsonValue, String> {
        let was_running = self.process.is_some();
        let restart = matches!(
            key,
            "tunEnabled"
                | "tunStack"
                | "dnsHijackEnabled"
                | "ipv6Enabled"
                | "allowLan"
                | "logLevel"
        );
        match key {
            "startWithSystemProxy" => {
                self.settings.start_with_system_proxy = value.as_bool().unwrap_or(false)
            }
            "tunEnabled" => self.settings.tun_enabled = value.as_bool().unwrap_or(false),
            "tunStack" => self.settings.tun_stack = value.as_str().unwrap_or("mixed").to_string(),
            "dnsHijackEnabled" => {
                self.settings.dns_hijack_enabled = value.as_bool().unwrap_or(true)
            }
            "ipv6Enabled" => self.settings.ipv6_enabled = value.as_bool().unwrap_or(false),
            "allowLan" => self.settings.allow_lan = value.as_bool().unwrap_or(false),
            "logLevel" => self.settings.log_level = value.as_str().unwrap_or("info").to_string(),
            "mixedPort" => self.settings.mixed_port = value.as_u64().unwrap_or(7890) as u16,
            "controllerPort" => {
                self.settings.controller_port = value.as_u64().unwrap_or(19090) as u16
            }
            "killSwitchEnabled" => {
                self.set_kill_switch(value.as_bool().unwrap_or(false))?;
                return Ok(self.public_settings());
            }
            _ => return Err(format!("Unsupported setting: {key}")),
        }
        self.save_settings()?;
        self.ensure_direct_profile()?;
        if restart && was_running {
            self.stop()?;
            thread::sleep(Duration::from_millis(350));
            self.start()?;
        }
        Ok(self.public_settings())
    }

    fn set_mode(&mut self, mode: &str) -> Result<String, String> {
        if !["rule", "global", "direct"].contains(&mode) {
            return Err("Unsupported mode".to_string());
        }
        self.settings.mode = mode.to_string();
        self.save_settings()?;
        if self.process.is_some() {
            let _ = self.controller("PATCH", "/configs", Some(json!({ "mode": mode })), 3000);
        }
        Ok(mode.to_string())
    }

    fn proxy_groups(&self) -> JsonValue {
        if self.process.is_some() {
            if let Ok(data) = self.controller("GET", "/proxies", None, 1200) {
                if let Some(proxies) = data.get("proxies").and_then(|v| v.as_object()) {
                    let groups: Vec<JsonValue> = proxies
                        .values()
                        .filter(|item| matches!(item.get("type").and_then(|v| v.as_str()), Some("Selector" | "URLTest" | "Fallback" | "LoadBalance" | "Relay")))
                        .filter(|item| item.get("all").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false))
                        .map(|group| {
                            let items = group.get("all").and_then(|v| v.as_array()).cloned().unwrap_or_default()
                                .into_iter()
                                .filter_map(|name| name.as_str().map(|name| {
                                    proxies.get(name).cloned().unwrap_or_else(|| json!({ "name": name, "type": "Unknown", "alive": true, "delay": -1 }))
                                }))
                                .collect::<Vec<_>>();
                            json!({
                                "name": group.get("name").cloned().unwrap_or(json!("")),
                                "type": group.get("type").cloned().unwrap_or(json!("Selector")),
                                "now": group.get("now").cloned().unwrap_or(json!("")),
                                "items": items
                            })
                        })
                        .collect();
                    return json!(groups);
                }
            }
        }
        json!([])
    }

    fn change_proxy(&mut self, group: &str, proxy: &str) -> Result<bool, String> {
        if self.process.is_some() {
            self.controller(
                "PUT",
                &format!("/proxies/{}", group),
                Some(json!({ "name": proxy })),
                5000,
            )?;
            let _ = self.controller("DELETE", "/connections", None, 1500);
        }
        Ok(true)
    }

    fn connections(&self) -> JsonValue {
        self.controller("GET", "/connections", None, 1500)
            .ok()
            .and_then(|data| data.get("connections").cloned())
            .unwrap_or_else(|| json!([]))
    }

    fn close_connection(&self, id: &str) -> Result<bool, String> {
        self.controller("DELETE", &format!("/connections/{id}"), None, 2000)?;
        Ok(true)
    }

    fn close_connections(&self) -> Result<bool, String> {
        self.controller("DELETE", "/connections", None, 3000)?;
        Ok(true)
    }

    fn add_profile_url(&mut self, url: &str) -> Result<Profile, String> {
        let parsed = reqwest::Url::parse(url).map_err(|err| err.to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("订阅 URL 仅支持 HTTP/HTTPS".to_string());
        }
        let text = Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|err| err.to_string())?
            .get(url)
            .header("User-Agent", format!("Aegos/{}", env!("CARGO_PKG_VERSION")))
            .send()
            .map_err(|err| err.to_string())?
            .text()
            .map_err(|err| err.to_string())?;
        let source: YamlValue = serde_yaml::from_str(&text).map_err(|err| err.to_string())?;
        let patched = self.patched_config(source)?;
        let id = format!("url-{}", now_iso());
        let path = self.profile_dir.join(format!("{id}.yaml"));
        fs::write(
            &path,
            serde_yaml::to_string(&patched).map_err(|err| err.to_string())?,
        )
        .map_err(|err| err.to_string())?;
        let profile = Profile {
            id: id.clone(),
            name: parsed.host_str().unwrap_or("remote").to_string(),
            profile_type: "url".to_string(),
            path: path.to_string_lossy().to_string(),
            source_url: Some(url.to_string()),
            updated_at: now_iso(),
            digest: sha256_file(&path),
        };
        self.settings.profiles.push(profile.clone());
        self.settings.active_profile_id = id;
        self.save_settings()?;
        Ok(profile)
    }

    fn update_profile(&mut self, id: &str) -> Result<Profile, String> {
        let profile = self
            .settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "Profile not found".to_string())?;
        if let Some(url) = profile.source_url.clone() {
            let updated = self.add_profile_url(&url)?;
            return Ok(updated);
        }
        Ok(profile)
    }

    fn set_active_profile(&mut self, id: &str) -> Result<Profile, String> {
        let profile = self
            .settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "Profile not found".to_string())?;
        self.settings.active_profile_id = id.to_string();
        self.save_settings()?;
        Ok(profile)
    }

    fn remove_profile(&mut self, id: &str) -> Result<bool, String> {
        if id == "direct" {
            return Err("内置直连配置不能删除".to_string());
        }
        if let Some(profile) = self.settings.profiles.iter().find(|p| p.id == id) {
            let _ = fs::remove_file(&profile.path);
        }
        self.settings.profiles.retain(|p| p.id != id);
        if self.settings.active_profile_id == id {
            self.settings.active_profile_id = "direct".to_string();
        }
        self.save_settings()?;
        Ok(true)
    }

    fn diagnostics(&mut self) -> JsonValue {
        json!({
            "generatedAt": now_iso(),
            "appVersion": env!("CARGO_PKG_VERSION"),
            "status": self.status(),
            "checks": [
                { "name": "mihomo core", "ok": self.core_path.exists(), "detail": self.core_path.to_string_lossy() },
                { "name": "Tauri shell", "ok": true, "detail": "Aegos" },
                { "name": "System Proxy", "ok": true, "detail": if self.settings.system_proxy { "enabled" } else { "disabled" } },
                { "name": "TUN", "ok": true, "detail": if self.settings.tun_enabled { "enabled" } else { "disabled" } },
                { "name": "Kill Switch", "ok": true, "detail": if self.settings.kill_switch_enabled { "enabled" } else { "disabled" } }
            ]
        })
    }
}

#[tauri::command]
fn app_status(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().status())
}

#[tauri::command]
fn start_core(state: State<AppState>) -> Result<JsonValue, String> {
    state.core.lock().unwrap().start()
}

#[tauri::command]
fn stop_core(state: State<AppState>) -> Result<JsonValue, String> {
    state.core.lock().unwrap().stop()
}

#[tauri::command]
fn restart_core(state: State<AppState>) -> Result<JsonValue, String> {
    let mut core = state.core.lock().unwrap();
    core.stop()?;
    thread::sleep(Duration::from_millis(350));
    core.start()
}

#[tauri::command]
fn set_system_proxy(state: State<AppState>, enable: bool) -> Result<bool, String> {
    state.core.lock().unwrap().set_system_proxy(enable)
}

#[tauri::command]
fn update_setting(
    state: State<AppState>,
    key: String,
    value: JsonValue,
) -> Result<JsonValue, String> {
    state.core.lock().unwrap().update_setting(&key, value)
}

#[tauri::command]
fn set_mode(state: State<AppState>, mode: String) -> Result<String, String> {
    state.core.lock().unwrap().set_mode(&mode)
}

#[tauri::command]
fn proxy_groups(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().proxy_groups())
}

#[tauri::command]
fn change_proxy(state: State<AppState>, group: String, proxy: String) -> Result<bool, String> {
    state.core.lock().unwrap().change_proxy(&group, &proxy)
}

#[tauri::command]
fn connections(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().connections())
}

#[tauri::command]
fn close_connection(state: State<AppState>, id: String) -> Result<bool, String> {
    state.core.lock().unwrap().close_connection(&id)
}

#[tauri::command]
fn close_connections(state: State<AppState>) -> Result<bool, String> {
    state.core.lock().unwrap().close_connections()
}

#[tauri::command]
fn add_profile_url(state: State<AppState>, url: String) -> Result<Profile, String> {
    state.core.lock().unwrap().add_profile_url(&url)
}

#[tauri::command]
fn update_profile(state: State<AppState>, id: String) -> Result<Profile, String> {
    state.core.lock().unwrap().update_profile(&id)
}

#[tauri::command]
fn set_active_profile(state: State<AppState>, id: String) -> Result<Profile, String> {
    state.core.lock().unwrap().set_active_profile(&id)
}

#[tauri::command]
fn remove_profile(state: State<AppState>, id: String) -> Result<bool, String> {
    state.core.lock().unwrap().remove_profile(&id)
}

#[tauri::command]
fn diagnostics(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().diagnostics())
}

#[tauri::command]
fn clear_logs(state: State<AppState>) -> Result<bool, String> {
    let logs = state.core.lock().unwrap().logs.clone();
    logs.lock().unwrap().clear();
    Ok(true)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let core = CoreManager::new(&app.handle())?;
            app.manage(AppState {
                core: Mutex::new(core),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            start_core,
            stop_core,
            restart_core,
            set_system_proxy,
            update_setting,
            set_mode,
            proxy_groups,
            change_proxy,
            connections,
            close_connection,
            close_connections,
            add_profile_url,
            update_profile,
            set_active_profile,
            remove_profile,
            diagnostics,
            clear_logs
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aegos");
}
