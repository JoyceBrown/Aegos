use reqwest::blocking::Client;
use serde_json::{json, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const ENGINE: &str = "mihomo";
pub const ROLE: &str = "Aegos Network Engine dataplane";
pub const EXPECTED_VERSION: &str = "v1.19.28";
pub const EXPECTED_SHA256: &str =
    "c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517";
pub const MANAGED_BY: &str = "Aegos";
pub const CONTROL_PLANE: &str = "Aegos";
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
pub const READY_CHECK_ATTEMPTS: usize = 24;
pub const READY_PROBE_TIMEOUT_MS: u64 = 300;
pub const READY_RETRY_INTERVAL_MS: u64 = 250;
pub const READY_REUSE_PROBE_TIMEOUT_MS: u64 = 900;
pub const RUNTIME_RESTART_SETTLE_MS: u64 = 250;
pub const MODE_APPLY_TIMEOUT_MS: u64 = 3000;
pub const PROXY_SELECT_TIMEOUT_MS: u64 = 5000;
pub const AUXILIARY_PROXY_SELECT_TIMEOUT_MS: u64 = 1500;
pub const STALE_CONNECTION_CLEANUP_TIMEOUT_MS: u64 = 1500;
pub const STATUS_TRAFFIC_TIMEOUT_MS: u64 = 120;
pub const PROXY_GROUPS_SNAPSHOT_TIMEOUT_MS: u64 = 1200;
pub const CONNECTIONS_SNAPSHOT_TIMEOUT_MS: u64 = 900;
pub const ROUTING_RECENT_RULES_TIMEOUT_MS: u64 = 550;
pub const ROUTING_RECENT_RULES_LIMIT: usize = 12;
pub const ACTIVE_CONNECTION_COUNT_TIMEOUT_MS: u64 = 350;
pub const CLOSE_CONNECTION_TIMEOUT_MS: u64 = 2000;
pub const CLOSE_ALL_CONNECTIONS_TIMEOUT_MS: u64 = 3000;
pub const CONFIG_FORCE_APPLY_ENDPOINT: &str = "/configs?force=true";
pub const CONFIG_FORCE_APPLY_TIMEOUT_MS: u64 = 8000;
pub const CONFIG_APPLY_VERSION_PROBE_TIMEOUT_MS: u64 = 900;
pub const RESOURCE_SUBDIR: &str = "core";
pub const BINARY_NAME: &str = "mihomo.exe";
pub const MISSING_RESOURCE_HINT: &str =
    "Core file is missing or unavailable. Restore resources/core/mihomo.exe and restart Aegos.";
pub const TERMINATE_FAILED_STARTUP_MESSAGE: &str = "Stopping failed mihomo startup";
pub const TERMINATE_STOP_MESSAGE: &str = "Stopping mihomo";
pub const TERMINATE_EXIT_MESSAGE: &str = "Stopping mihomo for app exit";
pub const CONTROLLER_READY_TIMEOUT_MESSAGE: &str =
    "mihomo controller did not become ready within 6 seconds; check core logs for details.";
pub const STANDBY_SPEED_START_MESSAGE: &str =
    "Speed test starting mihomo in standby without traffic takeover";
pub const RUNTIME_DRIFT_RESTART_MESSAGE: &str =
    "Runtime profile or controller drift detected; restarting mihomo";
pub const SUPPORTED_PROXY_TYPES: &[&str] = &[
    "direct",
    "reject",
    "ss",
    "ssr",
    "vmess",
    "vless",
    "trojan",
    "hysteria",
    "hysteria2",
    "anytls",
    "tuic",
    "http",
    "socks5",
    "snell",
    "wireguard",
    "ssh",
];

#[derive(Clone, Debug)]
pub struct CoreRuntimePaths {
    pub core_path: PathBuf,
    pub home_dir: PathBuf,
    pub runtime_profile_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct CoreRuntimeContract {
    pub engine: &'static str,
    pub role: &'static str,
    pub expected_version: &'static str,
    pub expected_sha256: &'static str,
    pub managed_by: &'static str,
    pub control_plane: &'static str,
    pub data_plane: &'static str,
}

impl Default for CoreRuntimeContract {
    fn default() -> Self {
        Self {
            engine: ENGINE,
            role: ROLE,
            expected_version: EXPECTED_VERSION,
            expected_sha256: EXPECTED_SHA256,
            managed_by: MANAGED_BY,
            control_plane: CONTROL_PLANE,
            data_plane: ENGINE,
        }
    }
}

impl CoreRuntimeContract {
    pub fn identity_json(&self, paths: &CoreRuntimePaths, sha256: &str) -> JsonValue {
        let exists = paths.core_path.exists();
        json!({
            "engine": self.engine,
            "role": self.role,
            "expectedVersion": self.expected_version,
            "expectedSha256": self.expected_sha256,
            "sha256": sha256,
            "path": paths.core_path.to_string_lossy(),
            "homeDir": paths.home_dir.to_string_lossy(),
            "runtimeProfile": paths.runtime_profile_path.to_string_lossy(),
            "exists": exists,
            "verified": exists && sha256.eq_ignore_ascii_case(self.expected_sha256),
            "managedBy": self.managed_by,
            "controlPlane": self.control_plane,
            "dataPlane": self.data_plane,
        })
    }
}

pub fn runtime_status_json(
    runtime_info: JsonValue,
    running: bool,
    traffic_takeover: bool,
) -> JsonValue {
    json!({
        "runtime": ENGINE,
        "runtimeInfo": runtime_info,
        "running": running,
        "coreReady": running,
        "trafficTakeover": traffic_takeover,
        "standby": running && !traffic_takeover,
        "controller": running,
        "version": JsonValue::Null,
    })
}

pub fn connection_phase(
    core_running: bool,
    traffic_takeover: bool,
    system_proxy_wanted: bool,
    tun_enabled: bool,
) -> (&'static str, &'static str, &'static str) {
    if !core_running {
        return ("disconnected", "Disconnected", "Connect");
    }
    if !traffic_takeover {
        return ("standby", "Core standby", "Connect");
    }
    if tun_enabled {
        return ("connected-tun", "Connected by TUN", "Disconnect");
    }
    if system_proxy_wanted {
        return (
            "connected-system-proxy",
            "Connected by system proxy",
            "Disconnect",
        );
    }
    (
        "connected-core",
        "Core running without system takeover",
        "Enable system proxy or TUN",
    )
}

pub fn connection_status_json(
    core_running: bool,
    traffic_takeover: bool,
    system_proxy_wanted: bool,
    tun_enabled: bool,
) -> JsonValue {
    let (phase, label, next_action) = connection_phase(
        core_running,
        traffic_takeover,
        system_proxy_wanted,
        tun_enabled,
    );
    let system_proxy_applied = traffic_takeover && system_proxy_wanted;
    json!({
        "phase": phase,
        "label": label,
        "nextAction": next_action,
        "coreRunning": core_running,
        "trafficTakeover": traffic_takeover,
        "systemProxyWanted": system_proxy_wanted,
        "systemProxyApplied": system_proxy_applied,
        "tunEnabled": tun_enabled,
        "takeoverComplete": traffic_takeover && (tun_enabled || system_proxy_applied || !system_proxy_wanted)
    })
}

pub fn connection_closure_json(
    core_running: bool,
    traffic_takeover: bool,
    system_proxy_wanted: bool,
    tun_enabled: bool,
    mode: &str,
    active_profile_id: &str,
    current_node: &str,
    outbound_ip: &str,
    checked_at: u64,
) -> JsonValue {
    let outbound_ip_known = !outbound_ip.trim().is_empty() && outbound_ip != "-";
    let mut summary = connection_status_json(
        core_running,
        traffic_takeover,
        system_proxy_wanted,
        tun_enabled,
    );
    if let Some(map) = summary.as_object_mut() {
        map.insert("mode".to_string(), json!(mode));
        map.insert("activeProfileId".to_string(), json!(active_profile_id));
        map.insert("currentNode".to_string(), json!(current_node));
        map.insert("outboundIp".to_string(), json!(outbound_ip));
        map.insert("outboundIpKnown".to_string(), json!(outbound_ip_known));
        map.insert("checkedAt".to_string(), json!(checked_at));
    }
    summary
}

pub fn normalize_proxy_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "hy2" => "hysteria2".to_string(),
        "socks" => "socks5".to_string(),
        other => other.to_string(),
    }
}

pub fn supports_proxy_type(value: &str) -> bool {
    let normalized = normalize_proxy_type(value);
    SUPPORTED_PROXY_TYPES.contains(&normalized.as_str())
}

pub fn protocol_capability_summary(uri_protocols: &[&str]) -> String {
    format!(
        "Aegos URI parser: {}; Aegos runtime proxy types: {}",
        uri_protocols.join(", "),
        SUPPORTED_PROXY_TYPES.join(", ")
    )
}

pub fn protocol_capabilities_json(uri_protocols: &[&str]) -> JsonValue {
    json!({
        "uriParser": uri_protocols,
        "runtimeProxyTypes": SUPPORTED_PROXY_TYPES,
        "runtime": {
            "engine": ENGINE,
            "role": ROLE,
            "version": EXPECTED_VERSION,
            "managedBy": MANAGED_BY,
            "controlPlane": CONTROL_PLANE,
        },
        "core": format!("{ENGINE} {EXPECTED_VERSION} bundled")
    })
}

pub fn bundled_core_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join(RESOURCE_SUBDIR).join(BINARY_NAME)
}

pub fn development_core_path(current_dir: &Path) -> PathBuf {
    current_dir
        .join("resources")
        .join(RESOURCE_SUBDIR)
        .join(BINARY_NAME)
}

pub fn resolve_core_path(resource_dir: &Path, current_dir: &Path) -> PathBuf {
    let bundled = bundled_core_path(resource_dir);
    if bundled.exists() {
        bundled
    } else {
        development_core_path(current_dir)
    }
}

pub fn core_missing_message(core_path: &Path) -> String {
    format!("mihomo core not found: {}", core_path.display())
}

pub fn exited_before_ready_message(status: &std::process::ExitStatus) -> String {
    format!("mihomo exited before ready: {status}")
}

pub fn status_check_failed_message(err: &impl std::fmt::Display) -> String {
    format!("mihomo status check failed: {err}")
}

pub fn process_exit_message(
    result: std::io::Result<Option<std::process::ExitStatus>>,
) -> Option<String> {
    match result {
        Ok(Some(status)) => Some(exited_before_ready_message(&status)),
        Ok(None) => None,
        Err(err) => Some(status_check_failed_message(&err)),
    }
}

pub fn hot_reload_success_message(
    profile_name: &str,
    digest: &str,
    controller_version: Option<&str>,
) -> String {
    format!(
        "Profile hot reloaded via mihomo controller: {} digest {}{}",
        profile_name,
        digest_prefix(digest),
        controller_version
            .map(|version| format!(", controller version {version}"))
            .unwrap_or_default()
    )
}

pub struct RuntimeConfigPreflightInput<'a> {
    pub profile_id: &'a str,
    pub profile_type: &'a str,
    pub profile_name: &'a str,
    pub mixed_port: u16,
    pub controller_port: u16,
    pub uri_protocols: &'a [&'a str],
}

pub fn preflight_runtime_config(
    config: &YamlValue,
    input: RuntimeConfigPreflightInput<'_>,
) -> Result<JsonValue, String> {
    let root = config
        .as_mapping()
        .ok_or_else(|| "Config preflight failed: root YAML value must be an object".to_string())?;
    let proxies = yaml_sequence(config, "proxies")
        .cloned()
        .unwrap_or_default();
    let proxy_groups = yaml_sequence(config, "proxy-groups")
        .cloned()
        .unwrap_or_default();
    let rules = yaml_sequence(config, "rules").cloned().unwrap_or_default();
    let builtin_direct = input.profile_id == "direct" || input.profile_type == "builtin";
    let mut names = HashSet::new();
    let mut duplicate_names = Vec::new();
    let mut missing_fields = Vec::new();
    let mut unsupported_proxy_types = Vec::new();

    for (index, proxy) in proxies.iter().enumerate() {
        let Some(map) = proxy.as_mapping() else {
            missing_fields.push(format!("proxies[{index}] is not an object"));
            continue;
        };
        let name = map
            .get(yaml_key("name"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        if name.is_empty() {
            missing_fields.push(format!("proxies[{index}] missing name"));
        } else if !names.insert(name.to_string()) {
            duplicate_names.push(name.to_string());
        }
        if map
            .get(yaml_key("type"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .is_empty()
        {
            missing_fields.push(format!(
                "{} missing type",
                if name.is_empty() { "proxy" } else { name }
            ));
        }
        let proxy_type = map
            .get(yaml_key("type"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        if !proxy_type.is_empty() && !supports_proxy_type(proxy_type) {
            unsupported_proxy_types.push(format!(
                "{} ({})",
                if name.is_empty() { "proxy" } else { name },
                proxy_type
            ));
        }
    }

    if !builtin_direct && proxies.is_empty() {
        return Err("Config preflight failed: subscription has no usable proxies".to_string());
    }
    if !duplicate_names.is_empty() {
        duplicate_names.sort();
        duplicate_names.dedup();
        return Err(format!(
            "Config preflight failed: duplicate proxy name(s): {}",
            duplicate_names.join(", ")
        ));
    }
    if !missing_fields.is_empty() {
        return Err(format!(
            "Config preflight failed: {}",
            missing_fields.join(", ")
        ));
    }
    if !unsupported_proxy_types.is_empty() {
        unsupported_proxy_types.sort();
        unsupported_proxy_types.dedup();
        return Err(format!(
            "Config preflight failed: unsupported proxy type(s): {}. {}",
            unsupported_proxy_types.join(", "),
            protocol_capability_summary(input.uri_protocols)
        ));
    }
    if !proxies.is_empty() && proxy_groups.is_empty() {
        return Err(
            "Config preflight failed: proxy-groups is required when proxies exist".to_string(),
        );
    }
    if rules.is_empty() {
        return Err("Config preflight failed: rules is empty".to_string());
    }

    let proxy_name_set = proxies
        .iter()
        .filter_map(yaml_mapping_name)
        .map(|name| name.to_string())
        .collect::<HashSet<_>>();
    let proxy_group_name_set = proxy_groups
        .iter()
        .filter_map(yaml_mapping_name)
        .map(|name| name.to_string())
        .collect::<HashSet<_>>();
    let mut bad_refs = Vec::new();
    for group in &proxy_groups {
        let Some(map) = group.as_mapping() else {
            continue;
        };
        let group_name = map
            .get(yaml_key("name"))
            .and_then(|value| value.as_str())
            .unwrap_or("proxy-group");
        if let Some(items) = map
            .get(yaml_key("proxies"))
            .and_then(|value| value.as_sequence())
        {
            for item in items {
                let Some(name) = item.as_str() else {
                    continue;
                };
                let upper = name.to_ascii_uppercase();
                if matches!(
                    upper.as_str(),
                    "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE"
                ) || proxy_name_set.contains(name)
                    || proxy_group_name_set.contains(name)
                {
                    continue;
                }
                bad_refs.push(format!("{group_name}->{name}"));
            }
        }
    }
    if !bad_refs.is_empty() {
        bad_refs.sort();
        bad_refs.dedup();
        return Err(format!(
            "Config preflight failed: proxy group references missing target(s): {}",
            bad_refs.join(", ")
        ));
    }

    let mixed_port = root
        .get(yaml_key("mixed-port"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if mixed_port != u64::from(input.mixed_port) {
        return Err(format!(
            "Config preflight failed: mixed-port should be {}, got {}",
            input.mixed_port, mixed_port
        ));
    }
    let controller = root
        .get(yaml_key("external-controller"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if !controller.ends_with(&format!(":{}", input.controller_port)) {
        return Err(format!(
            "Config preflight failed: external-controller should end with :{}",
            input.controller_port
        ));
    }

    Ok(json!({
        "ok": true,
        "profile": input.profile_name,
        "proxies": proxies.len(),
        "proxyGroups": proxy_groups.len(),
        "rules": rules.len(),
        "mixedPort": input.mixed_port,
        "controllerPort": input.controller_port,
        "protocolCapabilities": protocol_capabilities_json(input.uri_protocols)
    }))
}

fn yaml_key(name: &str) -> YamlValue {
    YamlValue::String(name.to_string())
}

fn yaml_sequence<'a>(config: &'a YamlValue, key: &str) -> Option<&'a Vec<YamlValue>> {
    config
        .get(yaml_key(key))
        .and_then(|value| value.as_sequence())
}

fn yaml_mapping_name(item: &YamlValue) -> Option<&str> {
    item.as_mapping()?
        .get(yaml_key("name"))
        .and_then(|value| value.as_str())
}

#[derive(Clone, Debug)]
pub struct CoreController {
    pub controller_port: u16,
    pub secret: String,
}

#[derive(Clone, Debug)]
pub struct CoreControllerHttpFailure {
    pub status: Option<u16>,
    pub body: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoreDelayProbeResult {
    pub delay: i64,
    pub failure_reason: String,
}

impl CoreDelayProbeResult {
    fn ok(delay: i64) -> Self {
        Self {
            delay,
            failure_reason: String::new(),
        }
    }

    fn failed(reason: &str) -> Self {
        Self {
            delay: -1,
            failure_reason: reason.to_string(),
        }
    }
}

impl CoreController {
    pub fn new(controller_port: u16, secret: impl Into<String>) -> Self {
        Self {
            controller_port,
            secret: secret.into(),
        }
    }

    pub fn request(
        &self,
        method: &str,
        endpoint: &str,
        body: Option<JsonValue>,
        timeout_ms: u64,
    ) -> Result<JsonValue, String> {
        controller_request(
            self.controller_port,
            &self.secret,
            method,
            endpoint,
            body,
            timeout_ms,
        )
    }

    pub fn traffic_snapshot(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .map_err(|err| err.to_string())?;
        let url = format!("http://127.0.0.1:{}/traffic", self.controller_port);
        let res = client
            .get(url)
            .bearer_auth(&self.secret)
            .send()
            .map_err(|err| err.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Controller HTTP {}", res.status()));
        }
        let mut reader = BufReader::new(res);
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|err| err.to_string())?;
        serde_json::from_str(line.trim()).map_err(|err| err.to_string())
    }

    pub fn status_traffic_snapshot(&self) -> Result<JsonValue, String> {
        self.traffic_snapshot(STATUS_TRAFFIC_TIMEOUT_MS)
    }

    pub fn proxies_snapshot(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request("GET", "/proxies", None, timeout_ms)
    }

    pub fn proxy_groups_snapshot(
        &self,
        timeout_ms: u64,
        hidden_group_names: &[&str],
    ) -> Result<JsonValue, String> {
        let data = self.proxies_snapshot(timeout_ms)?;
        let proxies = data
            .get("proxies")
            .and_then(|value| value.as_object())
            .ok_or_else(|| "Controller proxies response missing proxies object".to_string())?;
        let groups = proxies
            .values()
            .filter(|item| is_controller_proxy_group(item))
            .filter(|item| {
                let name = item
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                !hidden_group_names.iter().any(|hidden| name == *hidden)
            })
            .filter(|item| {
                item.get("all")
                    .and_then(|value| value.as_array())
                    .map(|items| !items.is_empty())
                    .unwrap_or(false)
            })
            .map(|group| {
                let items = group
                    .get("all")
                    .and_then(|value| value.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|name| {
                        name.as_str().map(|name| {
                            normalize_proxy_item(proxies.get(name).cloned().unwrap_or_else(|| {
                                json!({
                                    "name": name,
                                    "type": "Unknown",
                                    "alive": true,
                                    "delay": -1
                                })
                            }))
                        })
                    })
                    .collect::<Vec<_>>();
                json!({
                    "name": group.get("name").cloned().unwrap_or(json!("")),
                    "type": group.get("type").cloned().unwrap_or(json!("Selector")),
                    "now": group.get("now").cloned().unwrap_or(json!("")),
                    "items": items
                })
            })
            .collect::<Vec<_>>();
        Ok(json!(groups))
    }

    pub fn ui_proxy_groups_snapshot(
        &self,
        hidden_group_names: &[&str],
    ) -> Result<JsonValue, String> {
        self.proxy_groups_snapshot(PROXY_GROUPS_SNAPSHOT_TIMEOUT_MS, hidden_group_names)
    }

    pub fn ui_proxy_groups_snapshot_or_none(
        &self,
        running: bool,
        hidden_group_names: &[&str],
    ) -> Option<JsonValue> {
        if !running {
            return None;
        }
        self.ui_proxy_groups_snapshot(hidden_group_names).ok()
    }

    pub fn version_probe(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request("GET", "/version", None, timeout_ms)
    }

    pub fn wait_until_ready<F>(&self, mut process_exit_message: F) -> Result<(), String>
    where
        F: FnMut() -> Option<String>,
    {
        for _ in 0..READY_CHECK_ATTEMPTS {
            if let Some(reason) = process_exit_message() {
                return Err(reason);
            }
            if self.version_probe(READY_PROBE_TIMEOUT_MS).is_ok() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(READY_RETRY_INTERVAL_MS));
        }
        Err(CONTROLLER_READY_TIMEOUT_MESSAGE.to_string())
    }

    pub fn set_mode(&self, mode: &str, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request(
            "PATCH",
            "/configs",
            Some(json!({ "mode": mode })),
            timeout_ms,
        )
    }

    pub fn apply_mode(&self, mode: &str) -> Result<JsonValue, String> {
        self.set_mode(mode, MODE_APPLY_TIMEOUT_MS)
    }

    pub fn select_proxy(&self, group: &str, proxy: &str, timeout_ms: u64) -> Result<(), String> {
        self.request(
            "PUT",
            &format!("/proxies/{}", url_path_encode(group)),
            Some(json!({ "name": proxy })),
            timeout_ms,
        )?;
        Ok(())
    }

    pub fn apply_proxy_selection(&self, group: &str, proxy: &str) -> Result<(), String> {
        self.select_proxy(group, proxy, PROXY_SELECT_TIMEOUT_MS)
    }

    pub fn apply_auxiliary_proxy_selection(&self, group: &str, proxy: &str) -> Result<(), String> {
        self.select_proxy(group, proxy, AUXILIARY_PROXY_SELECT_TIMEOUT_MS)
    }

    pub fn cleanup_stale_connections_after_selection(&self) {
        let _ = self.close_connections(STALE_CONNECTION_CLEANUP_TIMEOUT_MS);
    }

    pub fn proxy_delay_with_client(
        &self,
        client: &Client,
        name: &str,
        test_url: &str,
        timeout_ms: u64,
    ) -> Result<JsonValue, CoreControllerHttpFailure> {
        let url = format!(
            "http://127.0.0.1:{}/proxies/{}/delay?timeout={}&url={}",
            self.controller_port,
            url_path_encode(name),
            timeout_ms,
            url_path_encode(test_url)
        );
        let response = client
            .get(url)
            .bearer_auth(&self.secret)
            .send()
            .map_err(|err| CoreControllerHttpFailure {
                status: None,
                body: String::new(),
                message: err.to_string(),
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(CoreControllerHttpFailure {
                status: Some(status.as_u16()),
                message: if body.trim().is_empty() {
                    format!("Controller HTTP {status}")
                } else {
                    format!("Controller HTTP {status}: {}", body.trim())
                },
                body,
            });
        }
        response
            .json::<JsonValue>()
            .map_err(|err| CoreControllerHttpFailure {
                status: None,
                body: String::new(),
                message: err.to_string(),
            })
    }

    pub fn proxy_delay_result_with_client(
        &self,
        client: &Client,
        name: &str,
        test_url: &str,
        timeout_ms: u64,
    ) -> CoreDelayProbeResult {
        let data = match self.proxy_delay_with_client(client, name, test_url, timeout_ms) {
            Ok(data) => data,
            Err(err) => {
                let reason = if let Some(status) = err.status {
                    classify_delay_http_failure(status, &err.body)
                } else {
                    classify_delay_failure_message(&err.message)
                };
                return CoreDelayProbeResult::failed(reason);
            }
        };
        normalize_delay_probe_response(&data)
    }

    pub fn connections_snapshot(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request("GET", "/connections", None, timeout_ms)
            .map(|data| {
                data.get("connections")
                    .cloned()
                    .unwrap_or_else(|| json!([]))
            })
    }

    pub fn connections_snapshot_or_empty(&self, running: bool, timeout_ms: u64) -> JsonValue {
        if !running {
            return json!([]);
        }
        self.connections_snapshot(timeout_ms)
            .unwrap_or_else(|_| json!([]))
    }

    pub fn ui_connections_snapshot_or_empty(&self, running: bool) -> JsonValue {
        self.connections_snapshot_or_empty(running, CONNECTIONS_SNAPSHOT_TIMEOUT_MS)
    }

    pub fn recent_rule_hits_snapshot(
        &self,
        timeout_ms: u64,
        limit: usize,
    ) -> Result<JsonValue, String> {
        let connections = self.connections_snapshot(timeout_ms)?;
        Ok(recent_rule_hits_from_connections(&connections, limit))
    }

    pub fn routing_recent_rule_hits_snapshot_or_empty(&self, running: bool) -> JsonValue {
        if !running {
            return json!([]);
        }
        self.recent_rule_hits_snapshot(ROUTING_RECENT_RULES_TIMEOUT_MS, ROUTING_RECENT_RULES_LIMIT)
            .unwrap_or_else(|_| json!([]))
    }

    pub fn active_connection_count(&self, timeout_ms: u64) -> Result<usize, String> {
        self.connections_snapshot(timeout_ms).map(|items| {
            items
                .as_array()
                .map(|connections| connections.len())
                .unwrap_or(0)
        })
    }

    pub fn active_connection_count_snapshot_or_idle(
        &self,
        running: bool,
        timeout_ms: u64,
    ) -> JsonValue {
        let count = if running {
            self.active_connection_count(timeout_ms).unwrap_or(0)
        } else {
            0
        };
        json!({
            "count": count,
            "checkedAt": runtime_now_secs()
        })
    }

    pub fn home_active_connection_count_snapshot_or_idle(&self, running: bool) -> JsonValue {
        self.active_connection_count_snapshot_or_idle(running, ACTIVE_CONNECTION_COUNT_TIMEOUT_MS)
    }

    pub fn close_connection(&self, id: &str, timeout_ms: u64) -> Result<(), String> {
        self.request("DELETE", &format!("/connections/{id}"), None, timeout_ms)?;
        Ok(())
    }

    pub fn close_connection_for_ui(&self, id: &str) -> Result<(), String> {
        self.close_connection(id, CLOSE_CONNECTION_TIMEOUT_MS)
    }

    pub fn close_connections(&self, timeout_ms: u64) -> Result<(), String> {
        self.request("DELETE", "/connections", None, timeout_ms)?;
        Ok(())
    }

    pub fn close_all_connections_for_ui(&self) -> Result<(), String> {
        self.close_connections(CLOSE_ALL_CONNECTIONS_TIMEOUT_MS)
    }

    pub fn apply_runtime_config_path(&self, path: &Path) -> Result<JsonValue, String> {
        self.request(
            "PUT",
            CONFIG_FORCE_APPLY_ENDPOINT,
            Some(json!({ "path": path.to_string_lossy().to_string() })),
            CONFIG_FORCE_APPLY_TIMEOUT_MS,
        )
    }

    pub fn config_apply_version_probe(&self) -> Result<JsonValue, String> {
        self.version_probe(CONFIG_APPLY_VERSION_PROBE_TIMEOUT_MS)
    }
}

pub fn classify_delay_http_failure(status: u16, body: &str) -> &'static str {
    let body_class = classify_delay_failure_message(body);
    if body_class != "unknown" && body_class != "network" {
        return body_class;
    }
    match status {
        401 | 403 => "auth",
        404 => "node-not-found",
        408 | 504 => "timeout",
        500 | 502 | 503 => "controller-delay-error",
        _ => "network",
    }
}

fn classify_delay_failure_message(reason: &str) -> &'static str {
    let text = reason.trim().to_ascii_lowercase();
    if text.is_empty() {
        "unknown"
    } else if text.contains("timeout")
        || text.contains("timed out")
        || text.contains("deadline")
        || text.contains("i/o timeout")
    {
        "timeout"
    } else if text.contains("fake-ip")
        || text.contains("198.18.")
        || text.contains("198.19.")
        || text.contains("metadata")
    {
        "dns-fake-ip"
    } else if text.contains("dns")
        || text.contains("lookup")
        || text.contains("no such host")
        || text.contains("resolve")
    {
        "dns"
    } else if text.contains("tls") || text.contains("certificate") || text.contains("x509") {
        "tls"
    } else if text.contains("unauthorized")
        || text.contains("forbidden")
        || text.contains("authentication")
        || text.contains("permission denied")
        || text.contains("401")
        || text.contains("403")
    {
        "auth"
    } else if text.contains("unsupported proxy type")
        || text.contains("unsupported protocol")
        || text.contains("not supported")
    {
        "unsupported-protocol"
    } else if text.contains("node not found") || text.contains("not found") || text.contains("404")
    {
        "node-not-found"
    } else if text.contains("503") || text.contains("504") {
        "controller-delay-error"
    } else if text.contains("controller")
        || text.contains("/proxies")
        || text.contains("/configs")
        || text.contains("127.0.0.1")
        || text.contains("connection refused")
    {
        "controller-unavailable"
    } else if text.contains("delay test")
        || text.contains("test url")
        || text.contains("generate delay")
        || text.contains("an error occurred")
    {
        "probe-failed"
    } else if text.contains("network") || text.contains("connect") || text.contains("proxy") {
        "network"
    } else {
        "unknown"
    }
}

fn normalize_delay_probe_response(data: &JsonValue) -> CoreDelayProbeResult {
    let delay = data
        .get("delay")
        .and_then(|value| value.as_i64())
        .unwrap_or(-1);
    if delay >= 0 {
        return CoreDelayProbeResult::ok(delay);
    }
    let reason = data
        .get("message")
        .or_else(|| data.get("error"))
        .and_then(|value| value.as_str())
        .map(classify_delay_failure_message)
        .unwrap_or("timeout");
    CoreDelayProbeResult::failed(reason)
}

pub fn recent_rule_hits_from_connections(connections: &JsonValue, limit: usize) -> JsonValue {
    let mut rows: Vec<(String, usize, String)> = Vec::new();
    let Some(items) = connections.as_array() else {
        return json!([]);
    };
    for item in items {
        let rule = sanitize_runtime_display_text(
            item.get("rule")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .unwrap_or("MATCH"),
        );
        let chains = sanitize_runtime_display_text(
            &item
                .get("chains")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str())
                        .collect::<Vec<_>>()
                        .join(" > ")
                })
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "-".to_string()),
        );
        if let Some((_, count, _)) = rows.iter_mut().find(|(existing, _, _)| existing == &rule) {
            *count += 1;
            continue;
        }
        rows.push((rule, 1, chains));
    }
    json!(rows
        .into_iter()
        .take(limit)
        .map(|(rule, count, chains)| {
            json!({
                "rule": rule,
                "chains": chains,
                "count": count,
                "note": "recent connection"
            })
        })
        .collect::<Vec<_>>())
}

fn sanitize_runtime_display_text(value: &str) -> String {
    let mut redacted = value.to_string();
    for key in [
        "token",
        "access_token",
        "password",
        "passwd",
        "pwd",
        "secret",
        "uuid",
        "api_key",
        "apikey",
        "authorization",
    ] {
        redacted = redact_runtime_key_value(redacted, key);
    }
    let lower = redacted.to_ascii_lowercase();
    if let Some(index) = lower.find("bearer ") {
        let start = index + "bearer ".len();
        let mut end = start;
        while end < redacted.len() {
            let ch = redacted.as_bytes()[end] as char;
            if ch.is_ascii_whitespace() || matches!(ch, '&' | ';' | ',' | '|' | '"' | '\'') {
                break;
            }
            end += 1;
        }
        if end > start {
            redacted.replace_range(start..end, "[redacted]");
        }
    }
    redacted
}

fn redact_runtime_key_value(mut value: String, key: &str) -> String {
    let mut search_from = 0;
    loop {
        let lower = value[search_from..].to_ascii_lowercase();
        let Some(offset) = lower.find(key) else {
            break;
        };
        let key_start = search_from + offset;
        let after_key = key_start + key.len();
        let tail = &value[after_key..];
        let delimiter_len = if tail.starts_with('=') || tail.starts_with(':') {
            1
        } else {
            search_from = after_key;
            continue;
        };
        let value_start = after_key + delimiter_len;
        let mut value_end = value_start;
        while value_end < value.len() {
            let ch = value.as_bytes()[value_end] as char;
            if ch.is_ascii_whitespace()
                || matches!(
                    ch,
                    '&' | ';' | ',' | '|' | '"' | '\'' | '<' | '>' | ')' | ']' | '}'
                )
            {
                break;
            }
            value_end += 1;
        }
        if value_end > value_start {
            value.replace_range(value_start..value_end, "[redacted]");
            search_from = value_start + "[redacted]".len();
        } else {
            search_from = value_start;
        }
    }
    value
}

fn is_controller_proxy_group(item: &JsonValue) -> bool {
    matches!(
        item.get("type").and_then(|value| value.as_str()),
        Some("Selector" | "URLTest" | "Fallback" | "LoadBalance" | "Relay")
    )
}

fn proxy_delay(proxy: &JsonValue) -> i64 {
    proxy
        .get("delay")
        .and_then(|value| value.as_i64())
        .or_else(|| {
            proxy
                .get("history")
                .and_then(|value| value.as_array())
                .and_then(|items| items.last())
                .and_then(|item| item.get("delay"))
                .and_then(|value| value.as_i64())
        })
        .unwrap_or(-1)
}

fn normalize_proxy_item(mut proxy: JsonValue) -> JsonValue {
    let delay = proxy_delay(&proxy);
    if let Some(map) = proxy.as_object_mut() {
        map.insert("delay".to_string(), json!(delay));
        if !map.contains_key("alive") {
            map.insert("alive".to_string(), json!(delay >= 0));
        }
    }
    proxy
}

fn runtime_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

fn url_path_encode(input: &str) -> String {
    input
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn controller_request(
    controller_port: u16,
    secret: &str,
    method: &str,
    endpoint: &str,
    body: Option<JsonValue>,
    timeout_ms: u64,
) -> Result<JsonValue, String> {
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|err| err.to_string())?;
    let url = format!("http://127.0.0.1:{controller_port}{endpoint}");
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|err| err.to_string())?;
    let mut req = client.request(method, url).bearer_auth(secret);
    if let Some(body) = body {
        req = req.json(&body);
    }
    let res = req.send().map_err(|err| err.to_string())?;
    let status = res.status();
    let text = res.text().map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(if text.trim().is_empty() {
            format!("Controller HTTP {status}")
        } else {
            format!("Controller HTTP {status}: {}", text.trim())
        });
    }
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).or_else(|_| {
        text.lines()
            .find_map(|line| serde_json::from_str::<JsonValue>(line).ok())
            .ok_or_else(|| "Controller response is not JSON".to_string())
    })
}

#[derive(Clone, Debug)]
pub struct CoreLaunchPlan {
    pub paths: CoreRuntimePaths,
    pub profile_name: String,
    pub standby: bool,
}

#[derive(Clone, Debug)]
pub struct CoreRuntimeProfile {
    pub yaml: String,
    pub digest: String,
    pub outbound_interface: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CoreRuntimeProfileWrite {
    pub path: PathBuf,
    pub digest: String,
    pub outbound_interface: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CoreRuntimeApplyTransaction {
    pub runtime_profile_path: PathBuf,
    pub profile_name: String,
    pub digest: String,
}

#[derive(Clone, Debug)]
pub struct CoreRuntimeApplyResult {
    pub controller_response: JsonValue,
    pub version_probe: JsonValue,
    pub digest: String,
}

impl CoreLaunchPlan {
    pub fn new(paths: CoreRuntimePaths, profile_name: impl Into<String>, standby: bool) -> Self {
        Self {
            paths,
            profile_name: profile_name.into(),
            standby,
        }
    }

    pub fn display_label(&self) -> String {
        format!(
            "Starting {ENGINE}{}: {}",
            if self.standby { " in standby" } else { "" },
            self.profile_name
        )
    }

    pub fn command(&self) -> Command {
        launch_command(
            &self.paths.core_path,
            &self.paths.home_dir,
            &self.paths.runtime_profile_path,
        )
    }
}

impl CoreRuntimeApplyTransaction {
    pub fn new(
        runtime_profile_path: PathBuf,
        profile_name: impl Into<String>,
        digest: impl Into<String>,
    ) -> Self {
        Self {
            runtime_profile_path,
            profile_name: profile_name.into(),
            digest: digest.into(),
        }
    }

    pub fn display_label(&self) -> String {
        format!(
            "Applying runtime profile through {ENGINE}: {} digest {}",
            self.profile_name,
            digest_prefix(&self.digest)
        )
    }

    pub fn apply(&self, controller: &CoreController) -> Result<CoreRuntimeApplyResult, String> {
        let controller_response =
            controller.apply_runtime_config_path(&self.runtime_profile_path)?;
        let version_probe = controller.config_apply_version_probe()?;
        Ok(CoreRuntimeApplyResult {
            controller_response,
            version_probe,
            digest: self.digest.clone(),
        })
    }
}

pub fn launch_command(core_path: &Path, home_dir: &Path, runtime_profile_path: &Path) -> Command {
    let mut command = Command::new(core_path);
    command
        .args([
            "-d",
            &home_dir.to_string_lossy(),
            "-f",
            &runtime_profile_path.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub fn render_runtime_profile_yaml(
    rendered_yaml: &str,
    outbound_interface: Option<String>,
) -> Result<CoreRuntimeProfile, String> {
    let mut config: YamlValue = serde_yaml::from_str(rendered_yaml)
        .map_err(|err| format!("runtime YAML reparse failed: {err}"))?;
    let applied_interface =
        outbound_interface.and_then(|name| apply_interface_binding(&mut config, &name));
    let yaml = serde_yaml::to_string(&config).map_err(|err| err.to_string())?;
    Ok(CoreRuntimeProfile {
        digest: sha256_text(&yaml),
        yaml,
        outbound_interface: applied_interface,
    })
}

pub fn write_runtime_profile(
    paths: &CoreRuntimePaths,
    profile: &CoreRuntimeProfile,
) -> Result<CoreRuntimeProfileWrite, String> {
    fs::create_dir_all(&paths.home_dir).map_err(|err| {
        format!(
            "runtime home directory create failed {}: {err}",
            paths.home_dir.display()
        )
    })?;
    atomic_write_text_confined(&paths.runtime_profile_path, &paths.home_dir, &profile.yaml)?;
    Ok(CoreRuntimeProfileWrite {
        path: paths.runtime_profile_path.clone(),
        digest: profile.digest.clone(),
        outbound_interface: profile.outbound_interface.clone(),
    })
}

fn atomic_write_text_confined(path: &Path, root: &Path, content: &str) -> Result<(), String> {
    ensure_path_within(path, root)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("runtime profile path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("aegos-runtime-profile.yaml");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let temp_path = parent.join(format!(".{file_name}.{}.{}.tmp", std::process::id(), stamp));
    {
        let mut file = fs::File::create(&temp_path).map_err(|err| {
            format!(
                "runtime profile temp create failed {}: {err}",
                temp_path.display()
            )
        })?;
        file.write_all(content.as_bytes()).map_err(|err| {
            format!(
                "runtime profile temp write failed {}: {err}",
                temp_path.display()
            )
        })?;
        let _ = file.sync_all();
    }
    fs::rename(&temp_path, path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "runtime profile atomic replace failed {}: {err}",
            path.display()
        )
    })
}

fn ensure_path_within(path: &Path, root: &Path) -> Result<(), String> {
    let root_abs = root
        .canonicalize()
        .map_err(|err| format!("runtime root canonicalize failed {}: {err}", root.display()))?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("runtime profile path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|err| {
        format!(
            "runtime profile parent create failed {}: {err}",
            parent.display()
        )
    })?;
    let parent_abs = parent.canonicalize().map_err(|err| {
        format!(
            "runtime profile parent canonicalize failed {}: {err}",
            parent.display()
        )
    })?;
    if parent_abs.starts_with(&root_abs) {
        Ok(())
    } else {
        Err(format!(
            "refusing to write runtime profile outside core home: {}",
            path.display()
        ))
    }
}

fn apply_interface_binding(config: &mut YamlValue, interface_name: &str) -> Option<String> {
    let name = interface_name.trim();
    if name.is_empty() {
        return None;
    }
    let map = config.as_mapping_mut()?;
    map.insert(
        YamlValue::String("interface-name".to_string()),
        YamlValue::String(name.to_string()),
    );
    Some(name.to_string())
}

fn sha256_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn digest_prefix(digest: &str) -> &str {
    &digest[..12.min(digest.len())]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controller_proxy_item_normalization_uses_latest_history_delay() {
        let proxy = json!({
            "name": "HK 01",
            "type": "ss",
            "history": [
                { "delay": 120 },
                { "delay": 42 }
            ]
        });
        let normalized = normalize_proxy_item(proxy);
        assert_eq!(
            normalized.get("delay").and_then(JsonValue::as_i64),
            Some(42)
        );
        assert_eq!(
            normalized.get("alive").and_then(JsonValue::as_bool),
            Some(true)
        );
    }

    #[test]
    fn controller_proxy_group_detection_stays_inside_runtime_boundary() {
        assert!(is_controller_proxy_group(&json!({ "type": "Selector" })));
        assert!(is_controller_proxy_group(&json!({ "type": "URLTest" })));
        assert!(!is_controller_proxy_group(&json!({ "type": "ss" })));
    }

    #[test]
    fn runtime_protocol_capabilities_normalize_and_report_current_contract() {
        assert_eq!(normalize_proxy_type("hy2"), "hysteria2");
        assert_eq!(normalize_proxy_type("SOCKS"), "socks5");
        assert!(supports_proxy_type("anytls"));
        assert!(supports_proxy_type("hy2"));
        assert!(!supports_proxy_type("shadowtls"));

        let summary = protocol_capability_summary(&["ss", "hy2", "anytls"]);
        assert!(summary.contains("Aegos URI parser"));
        assert!(summary.contains("Aegos runtime proxy types"));
        assert!(summary.contains("hysteria2"));

        let capabilities = protocol_capabilities_json(&["ss", "hy2"]);
        assert_eq!(
            capabilities
                .get("runtime")
                .and_then(|value| value.get("version"))
                .and_then(JsonValue::as_str),
            Some(EXPECTED_VERSION)
        );
        assert_eq!(
            capabilities
                .get("runtimeProxyTypes")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(SUPPORTED_PROXY_TYPES.len())
        );
    }

    #[test]
    fn runtime_core_resource_paths_are_owned_by_runtime_boundary() {
        let resource_dir = PathBuf::from(r"C:\Program Files\Aegos");
        let current_dir = PathBuf::from(r"E:\workspace\aegos");
        assert_eq!(
            bundled_core_path(&resource_dir),
            resource_dir.join(RESOURCE_SUBDIR).join(BINARY_NAME)
        );
        assert_eq!(
            development_core_path(&current_dir),
            current_dir
                .join("resources")
                .join(RESOURCE_SUBDIR)
                .join(BINARY_NAME)
        );
        assert!(MISSING_RESOURCE_HINT.contains("resources/core/mihomo.exe"));
    }

    #[test]
    fn runtime_lifecycle_messages_are_owned_by_runtime_boundary() {
        let core_path = PathBuf::from(r"C:\Program Files\Aegos\core\mihomo.exe");
        assert_eq!(
            core_missing_message(&core_path),
            format!("mihomo core not found: {}", core_path.display())
        );
        assert_eq!(
            status_check_failed_message(&"probe failed"),
            "mihomo status check failed: probe failed"
        );
        assert_eq!(
            hot_reload_success_message("Profile A", "abcdef1234567890", Some("v1")),
            "Profile hot reloaded via mihomo controller: Profile A digest abcdef123456, controller version v1"
        );
        assert_eq!(
            hot_reload_success_message("Profile A", "abcdef1234567890", None),
            "Profile hot reloaded via mihomo controller: Profile A digest abcdef123456"
        );
        assert!(TERMINATE_FAILED_STARTUP_MESSAGE.contains("failed mihomo startup"));
        assert!(TERMINATE_STOP_MESSAGE.contains("Stopping mihomo"));
        assert!(TERMINATE_EXIT_MESSAGE.contains("app exit"));
        assert!(CONTROLLER_READY_TIMEOUT_MESSAGE.contains("did not become ready"));
        assert!(STANDBY_SPEED_START_MESSAGE.contains("standby without traffic takeover"));
        assert!(RUNTIME_DRIFT_RESTART_MESSAGE.contains("drift detected"));
    }

    #[test]
    fn runtime_lifecycle_process_exit_classification_is_owned_by_runtime_boundary() {
        assert_eq!(process_exit_message(Ok(None)), None);
        let reason = process_exit_message(Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "status probe failed",
        )))
        .unwrap();
        assert_eq!(reason, "mihomo status check failed: status probe failed");
        assert_eq!(READY_CHECK_ATTEMPTS, 24);
        assert_eq!(READY_PROBE_TIMEOUT_MS, 300);
        assert_eq!(READY_RETRY_INTERVAL_MS, 250);
        assert_eq!(READY_REUSE_PROBE_TIMEOUT_MS, 900);
        assert_eq!(RUNTIME_RESTART_SETTLE_MS, 250);
        assert_eq!(MODE_APPLY_TIMEOUT_MS, 3000);
        assert_eq!(PROXY_SELECT_TIMEOUT_MS, 5000);
        assert_eq!(AUXILIARY_PROXY_SELECT_TIMEOUT_MS, 1500);
        assert_eq!(STALE_CONNECTION_CLEANUP_TIMEOUT_MS, 1500);
        assert_eq!(STATUS_TRAFFIC_TIMEOUT_MS, 120);
        assert_eq!(PROXY_GROUPS_SNAPSHOT_TIMEOUT_MS, 1200);
        assert_eq!(CONNECTIONS_SNAPSHOT_TIMEOUT_MS, 900);
        assert_eq!(ROUTING_RECENT_RULES_TIMEOUT_MS, 550);
        assert_eq!(ROUTING_RECENT_RULES_LIMIT, 12);
        assert_eq!(ACTIVE_CONNECTION_COUNT_TIMEOUT_MS, 350);
        assert_eq!(CLOSE_CONNECTION_TIMEOUT_MS, 2000);
        assert_eq!(CLOSE_ALL_CONNECTIONS_TIMEOUT_MS, 3000);
        assert_eq!(CONFIG_FORCE_APPLY_ENDPOINT, "/configs?force=true");
        assert_eq!(CONFIG_FORCE_APPLY_TIMEOUT_MS, 8000);
        assert_eq!(CONFIG_APPLY_VERSION_PROBE_TIMEOUT_MS, 900);
    }

    fn test_preflight_input<'a>() -> RuntimeConfigPreflightInput<'a> {
        RuntimeConfigPreflightInput {
            profile_id: "url-test",
            profile_type: "url",
            profile_name: "test",
            mixed_port: 7891,
            controller_port: 19091,
            uri_protocols: &["ss", "hy2", "anytls"],
        }
    }

    #[test]
    fn runtime_config_preflight_validates_runtime_contract_inside_boundary() {
        let config: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
external-controller: 127.0.0.1:19091
proxies:
  - name: Node A
    type: ss
    server: example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Auto
    type: select
    proxies:
      - Node A
  - name: Final
    type: select
    proxies:
      - Auto
      - DIRECT
      - PASS
rules:
  - MATCH,Final
"#,
        )
        .expect("yaml");

        let report = preflight_runtime_config(&config, test_preflight_input())
            .expect("runtime preflight should accept group-to-group references");
        assert_eq!(report.get("proxies").and_then(JsonValue::as_u64), Some(1));
        assert_eq!(
            report.get("proxyGroups").and_then(JsonValue::as_u64),
            Some(2)
        );
        assert_eq!(
            report.get("mixedPort").and_then(JsonValue::as_u64),
            Some(7891)
        );
        assert_eq!(
            report
                .get("protocolCapabilities")
                .and_then(|value| value.get("runtime"))
                .and_then(|value| value.get("version"))
                .and_then(JsonValue::as_str),
            Some(EXPECTED_VERSION)
        );
    }

    #[test]
    fn routing_recent_rule_hits_are_shaped_inside_runtime_boundary() {
        let connections = json!([
            {
                "rule": "DomainSuffix,example.com,Proxies?token=secret-value",
                "chains": ["Proxies", "HK password=abc123"]
            },
            {
                "rule": "DomainSuffix,example.com,Proxies?token=secret-value",
                "chains": ["Different", "Chain"]
            },
            {
                "chains": []
            }
        ]);
        let rows = recent_rule_hits_from_connections(&connections, 2);
        let items = rows.as_array().expect("recent rows");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].get("count").and_then(JsonValue::as_u64), Some(2));
        assert_eq!(
            items[0].get("rule").and_then(JsonValue::as_str),
            Some("DomainSuffix,example.com,Proxies?token=[redacted]")
        );
        assert_eq!(
            items[0].get("chains").and_then(JsonValue::as_str),
            Some("Proxies > HK password=[redacted]")
        );
        assert_eq!(
            items[1].get("rule").and_then(JsonValue::as_str),
            Some("MATCH")
        );
        assert_eq!(
            items[1].get("chains").and_then(JsonValue::as_str),
            Some("-")
        );
    }

    #[test]
    fn runtime_config_preflight_rejects_unsupported_and_bad_runtime_ports() {
        let unsupported: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
external-controller: 127.0.0.1:19091
proxies:
  - name: Experimental
    type: shadowtls
    server: example.com
    port: 443
proxy-groups:
  - name: Final
    type: select
    proxies:
      - Experimental
rules:
  - MATCH,Final
"#,
        )
        .expect("yaml");
        let err = preflight_runtime_config(&unsupported, test_preflight_input())
            .expect_err("unsupported proxy type should fail");
        assert!(err.contains("unsupported proxy type"));
        assert!(err.contains("shadowtls"));
        assert!(err.contains("Aegos runtime proxy types"));

        let wrong_port: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7890
external-controller: 127.0.0.1:19091
proxies:
  - name: Node A
    type: ss
    server: example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Final
    type: select
    proxies:
      - Node A
rules:
  - MATCH,Final
"#,
        )
        .expect("yaml");
        let err = preflight_runtime_config(&wrong_port, test_preflight_input())
            .expect_err("mixed-port drift should fail");
        assert!(err.contains("mixed-port should be 7891"));
    }

    #[test]
    fn controller_delay_failures_are_classified_inside_runtime_boundary() {
        assert_eq!(
            classify_delay_http_failure(503, ""),
            "controller-delay-error"
        );
        assert_eq!(classify_delay_http_failure(404, ""), "node-not-found");
        assert_eq!(classify_delay_http_failure(503, "lookup failed"), "dns");
        assert_eq!(
            normalize_delay_probe_response(&json!({ "delay": 78 })),
            CoreDelayProbeResult::ok(78)
        );
        assert_eq!(
            normalize_delay_probe_response(&json!({ "message": "tls handshake failed" })),
            CoreDelayProbeResult::failed("tls")
        );
    }

    #[test]
    fn runtime_status_json_keeps_legacy_status_fields_stable() {
        let status = runtime_status_json(json!({ "engine": ENGINE }), true, false);
        assert_eq!(
            status.get("runtime").and_then(JsonValue::as_str),
            Some(ENGINE)
        );
        assert_eq!(
            status.get("running").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            status.get("coreReady").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            status.get("trafficTakeover").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            status.get("standby").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            status.get("controller").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert!(status.get("version").is_some_and(JsonValue::is_null));
        assert_eq!(
            status
                .get("runtimeInfo")
                .and_then(|value| value.get("engine"))
                .and_then(JsonValue::as_str),
            Some(ENGINE)
        );
    }

    #[test]
    fn connection_status_and_closure_are_runtime_shaped() {
        let disconnected = connection_status_json(false, false, true, false);
        assert_eq!(
            disconnected.get("phase").and_then(JsonValue::as_str),
            Some("disconnected")
        );
        assert_eq!(
            disconnected.get("nextAction").and_then(JsonValue::as_str),
            Some("Connect")
        );

        let standby = connection_status_json(true, false, true, false);
        assert_eq!(
            standby.get("phase").and_then(JsonValue::as_str),
            Some("standby")
        );
        assert_eq!(
            standby.get("takeoverComplete").and_then(JsonValue::as_bool),
            Some(false)
        );

        let system_proxy = connection_status_json(true, true, true, false);
        assert_eq!(
            system_proxy.get("phase").and_then(JsonValue::as_str),
            Some("connected-system-proxy")
        );
        assert_eq!(
            system_proxy
                .get("systemProxyApplied")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            system_proxy
                .get("takeoverComplete")
                .and_then(JsonValue::as_bool),
            Some(true)
        );

        let tun = connection_status_json(true, true, false, true);
        assert_eq!(
            tun.get("phase").and_then(JsonValue::as_str),
            Some("connected-tun")
        );

        let core_only = connection_status_json(true, true, false, false);
        assert_eq!(
            core_only.get("phase").and_then(JsonValue::as_str),
            Some("connected-core")
        );
        assert_eq!(
            core_only.get("nextAction").and_then(JsonValue::as_str),
            Some("Enable system proxy or TUN")
        );

        let closure = connection_closure_json(
            true,
            true,
            true,
            false,
            "rule",
            "profile-a",
            "HK 01",
            "203.0.113.1",
            42,
        );
        assert_eq!(
            closure.get("mode").and_then(JsonValue::as_str),
            Some("rule")
        );
        assert_eq!(
            closure.get("activeProfileId").and_then(JsonValue::as_str),
            Some("profile-a")
        );
        assert_eq!(
            closure.get("currentNode").and_then(JsonValue::as_str),
            Some("HK 01")
        );
        assert_eq!(
            closure.get("outboundIpKnown").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            closure.get("checkedAt").and_then(JsonValue::as_u64),
            Some(42)
        );

        let unknown_ip = connection_closure_json(true, true, true, false, "rule", "", "-", "-", 43);
        assert_eq!(
            unknown_ip
                .get("outboundIpKnown")
                .and_then(JsonValue::as_bool),
            Some(false)
        );
    }

    #[test]
    fn controller_connection_idle_snapshots_are_runtime_shaped() {
        let controller = CoreController::new(0, "");
        assert_eq!(
            controller.connections_snapshot_or_empty(false, 1),
            json!([])
        );
        let snapshot = controller.active_connection_count_snapshot_or_idle(false, 1);
        assert_eq!(snapshot.get("count").and_then(JsonValue::as_u64), Some(0));
        assert!(
            snapshot
                .get("checkedAt")
                .and_then(JsonValue::as_u64)
                .unwrap_or_default()
                > 0
        );
    }

    #[test]
    fn runtime_interface_binding_sets_mihomo_interface_name() {
        let mut config: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
proxies: []
proxy-groups: []
rules:
  - MATCH,DIRECT
"#,
        )
        .expect("yaml");
        assert_eq!(
            apply_interface_binding(&mut config, "Ethernet 2"),
            Some("Ethernet 2".to_string())
        );
        assert_eq!(
            config
                .get(YamlValue::String("interface-name".to_string()))
                .and_then(|value| value.as_str()),
            Some("Ethernet 2")
        );
    }
}
