use reqwest::blocking::Client;
use serde_json::{json, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use sha2::{Digest, Sha256};
use std::{
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

    pub fn version_probe(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request("GET", "/version", None, timeout_ms)
    }

    pub fn set_mode(&self, mode: &str, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request(
            "PATCH",
            "/configs",
            Some(json!({ "mode": mode })),
            timeout_ms,
        )
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

    pub fn close_connection(&self, id: &str, timeout_ms: u64) -> Result<(), String> {
        self.request("DELETE", &format!("/connections/{id}"), None, timeout_ms)?;
        Ok(())
    }

    pub fn close_connections(&self, timeout_ms: u64) -> Result<(), String> {
        self.request("DELETE", "/connections", None, timeout_ms)?;
        Ok(())
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
        let controller_response = controller.request(
            "PUT",
            "/configs?force=true",
            Some(json!({ "path": self.runtime_profile_path.to_string_lossy().to_string() })),
            8000,
        )?;
        let version_probe = controller.request("GET", "/version", None, 900)?;
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
