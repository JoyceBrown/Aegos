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

    pub fn connections_snapshot(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request("GET", "/connections", None, timeout_ms)
            .map(|data| {
                data.get("connections")
                    .cloned()
                    .unwrap_or_else(|| json!([]))
            })
    }

    pub fn active_connection_count(&self, timeout_ms: u64) -> Result<usize, String> {
        self.connections_snapshot(timeout_ms).map(|items| {
            items
                .as_array()
                .map(|connections| connections.len())
                .unwrap_or(0)
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
