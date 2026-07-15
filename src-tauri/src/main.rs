#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config_pipeline;
mod core_runtime;
mod diagnostics_runtime;
mod profile_compiler;
mod speed_runtime;
mod subscription_runtime;
mod task_runtime;

use base64::{engine::general_purpose, Engine as _};
use diagnostics_runtime::{logs_export_document, LogEntry, LogStore};
use rand::random;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use serde_yaml::{Mapping, Value as YamlValue};
use sha2::{Digest, Sha256};
use speed_runtime::{
    fail_speed_test_if_current, mark_single_speed_test_preparing, mark_speed_test_preparing,
    reset_speed_test_state as reset_speed_test_runtime_state, speed_result_confidence,
    speed_test_run_is_current, speed_test_snapshot as speed_test_runtime_snapshot, NodeHealth,
    SpeedTestState, SpeedTestStore,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Write},
    net::{IpAddr, Ipv4Addr, TcpListener, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{mpsc, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use subscription_runtime::{ProfileSource, ProfileSourceSummary};
use task_runtime::{
    finish_cancelled, finish_job, job_cancel_requested, job_status_snapshot, new_job_record,
    request_job_cancel, set_job_state, JobStore,
};
use tauri::{AppHandle, Manager, State, Window, WindowEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const AEGOS_DEFAULT_MIXED_PORT: u16 = 7891;
const AEGOS_DEFAULT_CONTROLLER_PORT: u16 = 19091;
const AEGOS_OUTBOUND_IP_GROUP: &str = "Aegos Landing IP";
const FLCLASH_STYLE_TEST_URL: &str = "https://www.gstatic.com/generate_204";
const FLCLASH_STYLE_SPEED_BATCH_SIZE: usize = 100;
const OUTBOUND_IP_RULE_DOMAINS: &[&str] = &[
    "api.ipify.org",
    "api64.ipify.org",
    "checkip.amazonaws.com",
    "ident.me",
    "ifconfig.me",
    "icanhazip.com",
];
const AEGOS_URI_PROTOCOLS: &[&str] = &[
    "ss",
    "trojan",
    "vmess",
    "vless",
    "hysteria2",
    "hy2",
    "anytls",
    "tuic",
];

fn default_reliability_auto() -> bool {
    true
}

fn default_reliability_profile_failover() -> bool {
    true
}

fn default_reliability_failure_threshold() -> u64 {
    2
}

fn default_reliability_max_delay_ms() -> u64 {
    800
}

fn default_reliability_candidate_limit() -> u64 {
    24
}

#[derive(Clone, Serialize, Deserialize)]
struct Profile {
    id: String,
    name: String,
    #[serde(rename = "type")]
    profile_type: String,
    path: String,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    node_count: usize,
    #[serde(default)]
    proxy_group_count: usize,
    updated_at: String,
    digest: String,
}

fn subscription_diagnostic(stage: &str, reason: impl AsRef<str>, suggestion: &str) -> String {
    subscription_runtime::diagnostic(stage, reason, suggestion)
}

fn is_ignorable_subscription_line(line: &str) -> bool {
    subscription_runtime::is_ignorable_line(line)
}

fn decoded_subscription_body(text: &str) -> String {
    subscription_runtime::decoded_body(text)
}

fn unsupported_uri_schemes(text: &str) -> Vec<String> {
    subscription_runtime::unsupported_uri_schemes(text, AEGOS_URI_PROTOCOLS)
}

fn looks_like_clash_yaml(text: &str) -> bool {
    subscription_runtime::looks_like_clash_yaml(text)
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
    #[serde(default = "default_reliability_auto")]
    reliability_auto: bool,
    #[serde(default = "default_reliability_profile_failover")]
    reliability_profile_failover: bool,
    #[serde(default = "default_reliability_failure_threshold")]
    reliability_failure_threshold: u64,
    #[serde(default = "default_reliability_max_delay_ms")]
    reliability_max_delay_ms: u64,
    #[serde(default = "default_reliability_candidate_limit")]
    reliability_candidate_limit: u64,
    #[serde(default)]
    selected_proxy_map: HashMap<String, String>,
    #[serde(default)]
    manual_nodes: HashMap<String, HashMap<String, JsonValue>>,
    profiles: Vec<Profile>,
}

#[derive(Clone)]
struct SpeedTestTarget {
    name: String,
    select_name: String,
    group_name: String,
    protocol: String,
    server: String,
}

#[derive(Clone)]
struct DelayTestResult {
    delay: i64,
    failure_reason: String,
}

impl DelayTestResult {
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

fn export_logs_from_state(logs: &LogStore, app_data: &Path) -> Result<JsonValue, String> {
    let items = logs.lock().unwrap().clone();
    let export_dir = app_data.join("diagnostics");
    ensure_dir(&export_dir)?;
    let path = export_dir.join(format!("aegos-logs-{}.txt", now_secs()));
    let document = logs_export_document(&items, &now_iso(), sanitize_sensitive_text);
    atomic_write_text_confined(&path, &export_dir, &document.content)?;
    Ok(json!({
        "path": path.to_string_lossy(),
        "count": items.len(),
        "categories": document.categories,
        "redacted": true
    }))
}

fn diagnostics_report_text(report: &JsonValue) -> String {
    let summary = report.get("summary").unwrap_or(&JsonValue::Null);
    let status = report.get("status").unwrap_or(&JsonValue::Null);
    let checks = report
        .get("checks")
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default();
    let mut lines = vec![
        format!(
            "Aegos Diagnostics {}",
            report
                .get("appVersion")
                .and_then(JsonValue::as_str)
                .unwrap_or(env!("CARGO_PKG_VERSION"))
        ),
        format!(
            "Generated: {}",
            report
                .get("generatedAt")
                .and_then(JsonValue::as_str)
                .unwrap_or("-")
        ),
        "Redaction: sensitive URLs, tokens, UUIDs, passwords, local paths, and IP details are masked where possible.".to_string(),
        format!(
            "Core ready: {}",
            status
                .get("coreReady")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false)
        ),
        format!(
            "Traffic takeover: {}",
            status
                .get("trafficTakeover")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false)
        ),
        format!(
            "Mode: {}",
            status.get("mode").and_then(JsonValue::as_str).unwrap_or("-")
        ),
        format!(
            "Summary: {} errors, {} warnings, {} failed checks",
            summary
                .get("errors")
                .and_then(JsonValue::as_u64)
                .unwrap_or(0),
            summary
                .get("warnings")
                .and_then(JsonValue::as_u64)
                .unwrap_or(0),
            summary
                .get("failed")
                .and_then(JsonValue::as_u64)
                .unwrap_or(0)
        ),
        String::new(),
        "Next actions:".to_string(),
    ];
    let next_actions = summary
        .get("nextActions")
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default();
    if next_actions.is_empty() {
        lines.push("- No immediate action required.".to_string());
    } else {
        for action in next_actions {
            if let Some(action) = action.as_str() {
                lines.push(format!("- {}", sanitize_sensitive_text(action)));
            }
        }
    }
    lines.push(String::new());
    lines.push("Checks:".to_string());
    for item in checks {
        let name = item
            .get("name")
            .and_then(JsonValue::as_str)
            .unwrap_or("Check");
        let severity = item
            .get("severity")
            .and_then(JsonValue::as_str)
            .unwrap_or("info");
        let ok = item.get("ok").and_then(JsonValue::as_bool).unwrap_or(false);
        let detail = item
            .get("detail")
            .and_then(JsonValue::as_str)
            .unwrap_or("-");
        let hint = item.get("hint").and_then(JsonValue::as_str).unwrap_or("");
        lines.push(format!(
            "[{}] {}: {}",
            severity,
            sanitize_sensitive_text(name),
            if ok { "ok" } else { "failed" }
        ));
        lines.push(format!("  detail: {}", sanitize_sensitive_text(detail)));
        if !hint.is_empty() {
            lines.push(format!("  action: {}", sanitize_sensitive_text(hint)));
        }
    }
    lines.join("\n") + "\n"
}

fn export_diagnostics_report_from_state(
    core: Arc<Mutex<CoreManager>>,
    app_data: &Path,
) -> Result<JsonValue, String> {
    let report = diagnostics_detached(core);
    let export_dir = app_data.join("diagnostics");
    ensure_dir(&export_dir)?;
    let path = export_dir.join(format!("aegos-diagnostics-{}.txt", now_secs()));
    let content = diagnostics_report_text(&report);
    atomic_write_text_confined(&path, &export_dir, &content)?;
    Ok(json!({
        "path": path.to_string_lossy(),
        "count": report
            .get("checks")
            .and_then(JsonValue::as_array)
            .map(|items| items.len())
            .unwrap_or(0),
        "redacted": true,
        "summary": report.get("summary").cloned().unwrap_or_else(|| json!({}))
    }))
}

fn profile_proxy_groups_for_profile_snapshot(
    profile: &Profile,
    selected_map: &HashMap<String, String>,
    use_selected_map: bool,
) -> JsonValue {
    let raw = fs::read_to_string(&profile.path).unwrap_or_default();
    let config_value: YamlValue =
        serde_yaml::from_str(&raw).unwrap_or_else(|_| YamlValue::Mapping(Mapping::new()));
    let mut config = match config_value {
        YamlValue::Mapping(map) => map,
        _ => Mapping::new(),
    };
    config_pipeline::normalize_runtime_proxy_groups_for_display(&mut config);
    let proxies = config
        .get(yaml_key("proxies"))
        .and_then(|value| value.as_sequence())
        .cloned()
        .unwrap_or_default();
    let proxy_items = proxies
        .iter()
        .filter_map(yaml_proxy_to_json)
        .map(|item| {
            let name = item
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            (name, item)
        })
        .collect::<HashMap<_, _>>();
    if proxy_items.is_empty() {
        return json!([]);
    }
    let proxy_groups = config
        .get(yaml_key("proxy-groups"))
        .and_then(|value| value.as_sequence())
        .cloned()
        .unwrap_or_default();
    let group_names = proxy_groups
        .iter()
        .filter_map(yaml_mapping_name)
        .map(|name| name.to_string())
        .collect::<HashSet<_>>();
    let groups = proxy_groups
        .iter()
        .filter(|group| yaml_mapping_name(group) != Some(AEGOS_OUTBOUND_IP_GROUP))
        .filter_map(|group| {
            let map = group.as_mapping()?;
            let name = map
                .get(yaml_key("name"))
                .and_then(|value| value.as_str())
                .unwrap_or("GLOBAL");
            let group_type = map
                .get(yaml_key("type"))
                .and_then(|value| value.as_str())
                .unwrap_or("Selector");
            let all = map
                .get(yaml_key("proxies"))
                .and_then(|value| value.as_sequence())
                .cloned()
                .unwrap_or_default();
            let items = all
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item_name| {
                    proxy_items.get(item_name).cloned().unwrap_or_else(|| {
                        if group_names.contains(item_name) {
                            json!({
                                "name": item_name,
                                "server": item_name,
                                "type": "Group",
                                "alive": true,
                                "delay": -1,
                                "group": true
                            })
                        } else {
                            builtin_proxy_item(item_name)
                        }
                    })
                })
                .collect::<Vec<_>>();
            if items.is_empty() {
                return None;
            }
            let now = (if use_selected_map {
                selected_map.get(name).cloned()
            } else {
                None
            })
            .or_else(|| {
                map.get(yaml_key("now"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            })
            .or_else(|| {
                items
                    .first()
                    .and_then(|item| item.get("name"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            })
            .unwrap_or_default();
            Some(json!({
                "name": name,
                "type": group_type,
                "now": now,
                "testUrl": map.get(yaml_key("url")).and_then(|value| value.as_str()).unwrap_or(""),
                "items": items
            }))
        })
        .collect::<Vec<_>>();
    if !groups.is_empty() {
        return json!(groups);
    }
    let items: Vec<JsonValue> = proxy_items.into_values().collect();
    if items.is_empty() {
        return json!([]);
    }
    let now = items
        .first()
        .and_then(|item| item.get("name"))
        .cloned()
        .unwrap_or(json!(""));
    json!([{ "name": "GLOBAL", "type": "Selector", "now": now, "items": items }])
}

fn apply_speed_test_delays_from_state(groups: &mut JsonValue, speed: &SpeedTestState) {
    if speed.delays.is_empty() && speed.health.is_empty() {
        return;
    }
    let now = now_secs();
    let recommended_name = speed
        .recommended
        .as_ref()
        .and_then(|value| value.get("realProxyName"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    if let Some(group_items) = groups.as_array_mut() {
        for group in group_items {
            if let Some(items) = group
                .get_mut("items")
                .and_then(|items| items.as_array_mut())
            {
                for item in items {
                    if let Some(name) = item
                        .get("realProxyName")
                        .or_else(|| item.get("name"))
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                    {
                        if let Some(delay) = speed.delays.get(&name).copied() {
                            if let Some(map) = item.as_object_mut() {
                                map.insert("delay".to_string(), json!(delay));
                                map.insert("alive".to_string(), json!(delay >= 0));
                            }
                        }
                        if let Some(health) = speed.health.get(&name) {
                            if let Some(map) = item.as_object_mut() {
                                let confidence = speed_result_confidence(
                                    health.last_delay,
                                    health.failure_streak,
                                    health.last_success_at,
                                    health.last_tested_at,
                                    health.cooldown_until,
                                    now,
                                );
                                map.insert("healthStatus".to_string(), json!(health.status));
                                map.insert("healthConfidence".to_string(), json!(confidence));
                                map.insert(
                                    "lastTestedAt".to_string(),
                                    json!(health.last_tested_at),
                                );
                                map.insert(
                                    "lastSuccessAt".to_string(),
                                    json!(health.last_success_at),
                                );
                                map.insert(
                                    "resultAgeSecs".to_string(),
                                    json!(if health.last_success_at > 0 {
                                        now.saturating_sub(health.last_success_at)
                                    } else if health.last_tested_at > 0 {
                                        now.saturating_sub(health.last_tested_at)
                                    } else {
                                        0
                                    }),
                                );
                                map.insert("medianDelay".to_string(), json!(health.median_delay));
                                map.insert("jitter".to_string(), json!(health.jitter));
                                map.insert(
                                    "failureStreak".to_string(),
                                    json!(health.failure_streak),
                                );
                                map.insert(
                                    "lastFailureReason".to_string(),
                                    json!(health.last_failure_reason),
                                );
                                map.insert("healthScore".to_string(), json!(health.score));
                                map.insert(
                                    "cooldownUntil".to_string(),
                                    json!(health.cooldown_until),
                                );
                                map.insert(
                                    "recommended".to_string(),
                                    json!(
                                        recommended_name.as_deref() == Some(name.as_str())
                                            && health.last_delay > 0
                                            && health.last_delay < 100
                                    ),
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

fn assemble_proxy_groups_snapshot(
    running: bool,
    controller: core_runtime::CoreController,
    active_profile: Option<Profile>,
    selected_map: HashMap<String, String>,
    manual_names: HashSet<String>,
    speed: SpeedTestState,
) -> JsonValue {
    let mut groups =
        controller.ui_proxy_groups_snapshot_or_else(running, &[AEGOS_OUTBOUND_IP_GROUP], || {
            active_profile
                .as_ref()
                .map(|profile| {
                    profile_proxy_groups_for_profile_snapshot(profile, &selected_map, true)
                })
                .unwrap_or_else(|| json!([]))
        });
    core_runtime::normalize_proxy_groups_snapshot_defaults(&mut groups);
    core_runtime::apply_group_resolution_with_selected_map(&mut groups, &selected_map);
    apply_speed_test_delays_from_state(&mut groups, &speed);
    core_runtime::annotate_manual_groups_with_names(&mut groups, &manual_names);
    groups
}

#[derive(Clone, Copy)]
struct DelayProbe {
    url: &'static str,
    timeout_ms: u64,
}

#[derive(Clone, Copy)]
enum DelayProbeDepth {
    Fast,
    Full,
}

struct CoreManager {
    app_data: PathBuf,
    home_dir: PathBuf,
    profile_dir: PathBuf,
    core_path: PathBuf,
    core_sha256: String,
    settings_path: PathBuf,
    proxy_snapshot_path: PathBuf,
    settings: Settings,
    process: Option<Child>,
    runtime_profile_id: Option<String>,
    runtime_config_digest: Option<String>,
    traffic_takeover: bool,
    logs: LogStore,
    last_traffic: JsonValue,
    speed_test: SpeedTestStore,
    lan_ip_cache: String,
    lan_ip_checked_at: u64,
    outbound_ip_cache: String,
    outbound_ip_checked_at: u64,
    outbound_ip_query_generation: u64,
    reliability_failures: u64,
}

struct AppState {
    core: Arc<Mutex<CoreManager>>,
    speed_test: SpeedTestStore,
    logs: LogStore,
    app_data: PathBuf,
    jobs: JobStore,
    operations: Arc<Mutex<()>>,
}

#[derive(Clone)]
struct DiagnosticsSnapshot {
    settings: Settings,
    active_profile: Option<Profile>,
    core_path: PathBuf,
    runtime_info: JsonValue,
    proxy_snapshot_path: PathBuf,
    running: bool,
    traffic_takeover: bool,
    last_traffic: JsonValue,
    speed_test: SpeedTestState,
    lan_ip_cache: String,
    outbound_ip_cache: String,
    outbound_ip_checked_at: u64,
    reliability_failures: u64,
    recent_logs: Vec<LogEntry>,
    status_logs: Vec<LogEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
struct RoutingDraftInput {
    kind: String,
    condition: String,
    target: String,
    option: Option<String>,
    label: Option<String>,
    source: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct RoutingGroupEditInput {
    action: String,
    name: Option<String>,
    new_name: Option<String>,
    group_type: Option<String>,
    items: Option<Vec<String>>,
}

#[derive(Clone, Deserialize, Serialize)]
struct RoutingRuleEditInput {
    action: String,
    raw: Option<String>,
    kind: Option<String>,
    condition: Option<String>,
    target: Option<String>,
    option: Option<String>,
    label: Option<String>,
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

fn sha256_text(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| err.to_string())
}

fn ensure_path_within(path: &Path, root: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    ensure_dir(root)?;
    ensure_dir(parent)?;
    let root_abs = root.canonicalize().map_err(|err| {
        format!(
            "path confinement root unavailable {}: {err}",
            root.display()
        )
    })?;
    let parent_abs = parent.canonicalize().map_err(|err| {
        format!(
            "path confinement parent unavailable {}: {err}",
            parent.display()
        )
    })?;
    if parent_abs.starts_with(&root_abs) {
        Ok(())
    } else {
        Err(format!(
            "refusing to write outside app data: {}",
            path.display()
        ))
    }
}

fn atomic_write_text_confined(path: &Path, root: &Path, content: &str) -> Result<(), String> {
    ensure_path_within(path, root)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("aegos-file");
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", hex_random(4)));
    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|err| format!("atomic temp create failed {}: {err}", temp_path.display()))?;
        file.write_all(content.as_bytes())
            .map_err(|err| format!("atomic temp write failed {}: {err}", temp_path.display()))?;
        let _ = file.sync_all();
    }
    fs::rename(&temp_path, path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        format!("atomic replace failed {}: {err}", path.display())
    })
}

fn remove_file_confined(path: &Path, root: &Path) -> Result<(), String> {
    ensure_path_within(path, root)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("remove file failed {}: {err}", path.display())),
    }
}

fn yaml_key(name: &str) -> YamlValue {
    YamlValue::String(name.to_string())
}

fn set_yaml(config: &mut Mapping, key: &str, value: YamlValue) {
    config.insert(yaml_key(key), value);
}

fn yaml_str(value: impl Into<String>) -> YamlValue {
    YamlValue::String(value.into())
}

fn yaml_string_values(values: &[String]) -> YamlValue {
    YamlValue::Sequence(values.iter().map(|value| yaml_str(value)).collect())
}

fn yaml_num(value: u64) -> YamlValue {
    YamlValue::Number(value.into())
}

fn proxy_group_names(config: &Mapping) -> Vec<String> {
    config
        .get(yaml_key("proxy-groups"))
        .and_then(|value| value.as_sequence())
        .map(|groups| {
            groups
                .iter()
                .filter_map(|group| {
                    group
                        .get(yaml_key("name"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn proxy_node_names(config: &Mapping) -> Vec<String> {
    config
        .get(yaml_key("proxies"))
        .and_then(|value| value.as_sequence())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get(yaml_key("name"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn outbound_ip_primary_group_name(config: &Mapping, settings: &Settings) -> Option<String> {
    let groups = proxy_group_names(config);
    for preferred in ["GLOBAL", "Final", "Proxy", "Proxies"] {
        if groups.iter().any(|name| name == preferred) {
            return Some(preferred.to_string());
        }
    }
    for selected_group in settings.selected_proxy_map.keys() {
        if groups.iter().any(|name| name == selected_group) {
            return Some(selected_group.clone());
        }
    }
    groups.first().cloned()
}

fn yaml_group_selected_name(group: &YamlValue, settings: &Settings) -> String {
    let Some(map) = group.as_mapping() else {
        return String::new();
    };
    let group_name = map
        .get(yaml_key("name"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    settings
        .selected_proxy_map
        .get(group_name)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .or_else(|| {
            map.get(yaml_key("now"))
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
        })
        .or_else(|| {
            map.get(yaml_key("proxies"))
                .and_then(|value| value.as_sequence())
                .and_then(|items| items.first())
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn resolve_yaml_group_leaf(
    groups: &[YamlValue],
    settings: &Settings,
    name: &str,
    depth: usize,
) -> String {
    if depth > 8 {
        return name.to_string();
    }
    let Some(group) = groups
        .iter()
        .find(|group| yaml_mapping_name(group) == Some(name))
    else {
        return name.to_string();
    };
    let selected = yaml_group_selected_name(group, settings);
    if selected.is_empty() || selected == name {
        return name.to_string();
    }
    resolve_yaml_group_leaf(groups, settings, &selected, depth + 1)
}

fn outbound_ip_selected_proxy(
    config: &Mapping,
    settings: &Settings,
    proxy_names: &[String],
) -> String {
    let groups = config
        .get(yaml_key("proxy-groups"))
        .and_then(|value| value.as_sequence())
        .cloned()
        .unwrap_or_default();
    let selected = outbound_ip_primary_group_name(config, settings)
        .map(|group| resolve_yaml_group_leaf(&groups, settings, &group, 0))
        .unwrap_or_default();
    if selected == "DIRECT" || proxy_names.iter().any(|name| name == &selected) {
        return selected;
    }
    proxy_names
        .first()
        .cloned()
        .unwrap_or_else(|| "DIRECT".to_string())
}

fn upsert_outbound_ip_group(config: &mut Mapping, settings: &Settings) -> String {
    let proxy_names = proxy_node_names(config);
    if proxy_names.is_empty() {
        return "DIRECT".to_string();
    }
    let selected = outbound_ip_selected_proxy(config, settings, &proxy_names);
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    for name in std::iter::once(selected.clone())
        .chain(proxy_names.into_iter())
        .chain(std::iter::once("DIRECT".to_string()))
    {
        if seen.insert(name.clone()) {
            ordered.push(YamlValue::String(name));
        }
    }
    let mut group = Mapping::new();
    set_yaml(&mut group, "name", yaml_str(AEGOS_OUTBOUND_IP_GROUP));
    set_yaml(&mut group, "type", yaml_str("select"));
    set_yaml(&mut group, "proxies", YamlValue::Sequence(ordered));
    let mut groups = config
        .get(yaml_key("proxy-groups"))
        .and_then(|value| value.as_sequence())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|group| yaml_mapping_name(group) != Some(AEGOS_OUTBOUND_IP_GROUP))
        .collect::<Vec<_>>();
    groups.push(YamlValue::Mapping(group));
    set_yaml(config, "proxy-groups", YamlValue::Sequence(groups));
    AEGOS_OUTBOUND_IP_GROUP.to_string()
}

fn insert_outbound_ip_rules(config: &mut Mapping, settings: &Settings) {
    let target = upsert_outbound_ip_group(config, settings);
    let mut rules = config
        .get(yaml_key("rules"))
        .and_then(|value| value.as_sequence())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|rule| {
            let text = rule.as_str().unwrap_or("");
            !OUTBOUND_IP_RULE_DOMAINS
                .iter()
                .any(|domain| text.contains(domain))
        })
        .collect::<Vec<_>>();
    let mut internal_rules = OUTBOUND_IP_RULE_DOMAINS
        .iter()
        .map(|domain| YamlValue::String(format!("DOMAIN,{domain},{target}")))
        .collect::<Vec<_>>();
    internal_rules.append(&mut rules);
    set_yaml(config, "rules", YamlValue::Sequence(internal_rules));
}

fn string_choice_from_value(
    value: &JsonValue,
    fallback: &str,
    allowed: &[&str],
    label: &str,
) -> Result<String, String> {
    let text = value.as_str().unwrap_or(fallback);
    if !allowed.contains(&text) {
        return Err(format!("{label} must be one of: {}", allowed.join(", ")));
    }
    Ok(text.to_string())
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(hex);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn test_proxy_delay_request(
    client: &Client,
    controller: &core_runtime::CoreController,
    name: &str,
    test_url: &str,
    timeout_ms: u64,
) -> DelayTestResult {
    let result = controller.proxy_delay_result_with_client(client, name, test_url, timeout_ms);
    if result.delay >= 0 {
        DelayTestResult::ok(result.delay)
    } else {
        DelayTestResult::failed(&result.failure_reason)
    }
}

fn protocol_family(protocol: &str) -> &'static str {
    let text = protocol.trim().to_ascii_lowercase();
    if text.contains("tuic") {
        "tuic"
    } else if text.contains("anytls") {
        "anytls"
    } else if text.contains("hysteria") || text.contains("hy2") {
        "hysteria"
    } else if text.contains("reality") {
        "reality"
    } else if text.contains("wireguard") {
        "wireguard"
    } else if text.contains("vless") || text.contains("vmess") {
        "vmess"
    } else if text.contains("trojan") {
        "trojan"
    } else if text.contains("ss-obfs") || text.contains("shadowsocks-obfs") {
        "ss-obfs"
    } else if text == "ss" || text == "ssr" || text.contains("shadowsocks") {
        "ss"
    } else {
        "generic"
    }
}

fn protocol_concurrency(protocol: &str) -> usize {
    match protocol_family(protocol) {
        "tuic" => 8,
        "hysteria" | "wireguard" => 10,
        "ss-obfs" => 12,
        "anytls" => 16,
        "reality" | "vmess" | "trojan" | "ss" => 32,
        _ => 24,
    }
}

fn protocol_primary_timeout_ms(protocol: &str) -> u64 {
    match protocol_family(protocol) {
        "tuic" | "hysteria" | "wireguard" | "anytls" => 5000,
        "reality" | "vmess" | "trojan" | "ss" => 5000,
        _ => 5000,
    }
}

fn protocol_fast_timeout_ms(protocol: &str) -> u64 {
    match protocol_family(protocol) {
        "tuic" | "hysteria" | "wireguard" | "anytls" => 5000,
        "reality" | "vmess" | "trojan" | "ss" | "ss-obfs" => 5000,
        _ => 5000,
    }
}

fn delay_probe_plan(protocol: &str, depth: DelayProbeDepth) -> Vec<DelayProbe> {
    if matches!(depth, DelayProbeDepth::Fast) {
        let timeout_ms = protocol_fast_timeout_ms(protocol);
        return vec![DelayProbe {
            url: FLCLASH_STYLE_TEST_URL,
            timeout_ms,
        }];
    }
    let timeout_ms = protocol_primary_timeout_ms(protocol);
    let mut probes = vec![
        DelayProbe {
            url: "http://www.gstatic.com/generate_204",
            timeout_ms,
        },
        DelayProbe {
            url: "https://www.gstatic.com/generate_204",
            timeout_ms,
        },
        DelayProbe {
            url: "http://cp.cloudflare.com/generate_204",
            timeout_ms,
        },
    ];
    if protocol_family(protocol) == "ss-obfs" {
        probes.push(DelayProbe {
            url: "https://cp.cloudflare.com/generate_204",
            timeout_ms,
        });
    } else if matches!(
        protocol_family(protocol),
        "tuic" | "hysteria" | "wireguard" | "anytls"
    ) {
        probes.push(DelayProbe {
            url: "https://cp.cloudflare.com/generate_204",
            timeout_ms,
        });
    }
    probes
}

fn log_category(level: &str, line: &str) -> &'static str {
    let level = level.trim().to_ascii_lowercase();
    let line = line.trim().to_ascii_lowercase();
    if level == "core" || line.contains("mihomo") {
        "core"
    } else if level == "debug" {
        "debug"
    } else if line.contains("diagnostic") || line.contains("preflight") || line.contains("recovery")
    {
        "diagnostic"
    } else if line.contains("profile")
        || line.contains("subscription")
        || line.contains("proxy")
        || line.contains("mode")
        || line.contains("setting")
    {
        "user"
    } else {
        "runtime"
    }
}

fn redact_after_key(mut value: String, key: &str, separators: &[char]) -> String {
    let needles = [
        format!("{key}="),
        format!("{key}:"),
        format!("{key}%3d"),
        format!("{key}%3a"),
    ];
    let mut search_from = 0;
    loop {
        let lower = value.to_ascii_lowercase();
        let Some((index, needle_len)) = needles
            .iter()
            .filter_map(|needle| {
                lower[search_from..]
                    .find(needle)
                    .map(|pos| (search_from + pos, needle.len()))
            })
            .min_by_key(|(index, _)| *index)
        else {
            break;
        };
        let mut start = index + needle_len;
        while start < value.len()
            && matches!(
                value.as_bytes()[start] as char,
                ' ' | '"' | '\'' | ':' | '='
            )
        {
            start += 1;
        }
        let mut end = start;
        while end < value.len() {
            let ch = value.as_bytes()[end] as char;
            if separators.contains(&ch) || ch.is_ascii_whitespace() {
                break;
            }
            end += 1;
        }
        if end > start {
            value.replace_range(start..end, "[redacted]");
            search_from = start + "[redacted]".len();
        } else {
            search_from = start.saturating_add(1);
        }
    }
    value
}

fn redact_uri_userinfo(mut value: String) -> String {
    for scheme in [
        "ss://",
        "ssr://",
        "trojan://",
        "vmess://",
        "vless://",
        "hysteria2://",
        "hy2://",
        "anytls://",
        "tuic://",
    ] {
        let mut search_from = 0;
        loop {
            let lower = value.to_ascii_lowercase();
            let Some(index) = lower[search_from..]
                .find(scheme)
                .map(|pos| search_from + pos)
            else {
                break;
            };
            let credential_start = index + scheme.len();
            let tail = &value[credential_start..];
            let Some(at_offset) = tail.find('@') else {
                break;
            };
            let delimiter_offset = tail
                .find(|ch: char| matches!(ch, '/' | '?' | '#' | ' ' | '\r' | '\n' | '\t'))
                .unwrap_or(usize::MAX);
            if at_offset < delimiter_offset && at_offset > 0 {
                let credential_end = credential_start + at_offset;
                value.replace_range(credential_start..credential_end, "[redacted]");
                search_from = credential_start + "[redacted]".len();
            } else {
                search_from = credential_start;
            }
        }
    }
    value
}

fn redact_windows_local_paths(mut value: String) -> String {
    let mut index = 0;
    while index + 2 < value.len() {
        let bytes = value.as_bytes();
        let drive = bytes[index] as char;
        if drive.is_ascii_alphabetic()
            && bytes[index + 1] == b':'
            && matches!(bytes[index + 2], b'\\' | b'/')
            && (index == 0
                || (bytes[index - 1] as char).is_ascii_whitespace()
                || matches!(bytes[index - 1] as char, '"' | '\'' | '(' | '[' | '{'))
        {
            let mut end = index + 3;
            while end < value.len() {
                let ch = value.as_bytes()[end] as char;
                if ch.is_ascii_whitespace() || matches!(ch, '"' | '\'' | '<' | '>' | '|' | ')') {
                    break;
                }
                end += 1;
            }
            value.replace_range(index..end, "[local-path]");
            index += "[local-path]".len();
        } else {
            index += 1;
        }
    }
    value
}

fn is_sensitive_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
}

fn redact_sensitive_ip_literals(mut value: String) -> String {
    let mut ranges = Vec::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && (bytes[index].is_ascii_digit() || bytes[index] == b'.') {
            index += 1;
        }
        let candidate = &value[start..index];
        if candidate.matches('.').count() == 3 {
            if let Ok(ip) = candidate.parse::<Ipv4Addr>() {
                if is_sensitive_ipv4(ip) {
                    ranges.push((start, index));
                }
            }
        }
    }
    for (start, end) in ranges.into_iter().rev() {
        value.replace_range(start..end, "[private-ip]");
    }
    value
}

fn sanitize_sensitive_text(value: &str) -> String {
    let mut redacted = value.to_string();
    let separators = ['&', ';', ',', '|', '"', '\'', '<', '>', ')', ']', '}'];
    for key in [
        "token",
        "access_token",
        "password",
        "passwd",
        "pwd",
        "secret",
        "uuid",
        "key",
        "api_key",
        "apikey",
        "auth",
        "authorization",
        "private-key",
        "private_key",
        "client-secret",
        "client_secret",
        "obfs-password",
        "obfs_password",
    ] {
        redacted = redact_after_key(redacted, key, &separators);
    }
    let lower = redacted.to_ascii_lowercase();
    if let Some(index) = lower.find("bearer ") {
        let start = index + "bearer ".len();
        let mut end = start;
        while end < redacted.len() {
            let ch = redacted.as_bytes()[end] as char;
            if separators.contains(&ch) || ch.is_ascii_whitespace() {
                break;
            }
            end += 1;
        }
        if end > start {
            redacted.replace_range(start..end, "[redacted]");
        }
    }
    redacted = redact_uri_userinfo(redacted);
    redacted = redact_windows_local_paths(redacted);
    redact_sensitive_ip_literals(redacted)
}

fn log_matches_node(entry: &LogEntry, node: &str) -> bool {
    let node = node.trim().to_ascii_lowercase();
    if node.is_empty() {
        return false;
    }
    entry.line.to_ascii_lowercase().contains(&node)
}

fn health_status(delay: i64, failure_streak: u64, cooldown_until: u64, now: u64) -> String {
    if cooldown_until > now {
        "cooldown".to_string()
    } else if delay == 0 {
        "testing".to_string()
    } else if delay > 0 && delay < 100 && failure_streak == 0 {
        "low".to_string()
    } else if delay > 0 {
        "available".to_string()
    } else if failure_streak > 0 {
        "unstable".to_string()
    } else {
        "unknown".to_string()
    }
}

fn health_score(delay: i64, jitter: i64, failure_streak: u64, protocol: &str) -> i64 {
    if delay <= 0 {
        return i64::MAX / 4;
    }
    let protocol_penalty = match protocol_family(protocol) {
        "tuic" | "hysteria" => 18,
        "wireguard" => 12,
        _ => 0,
    };
    delay
        .saturating_add(jitter.saturating_mul(2))
        .saturating_add((failure_streak as i64).saturating_mul(120))
        .saturating_add(protocol_penalty)
}

fn update_node_health(
    previous: Option<&NodeHealth>,
    name: &str,
    protocol: &str,
    delay: i64,
    failure_reason: &str,
    now: u64,
) -> NodeHealth {
    let mut health = previous.cloned().unwrap_or_else(|| NodeHealth {
        name: name.to_string(),
        protocol: protocol.to_string(),
        last_delay: -1,
        median_delay: -1,
        jitter: 0,
        success_count: 0,
        failure_count: 0,
        failure_streak: 0,
        last_success_at: 0,
        last_tested_at: 0,
        cooldown_until: 0,
        status: "unknown".to_string(),
        confidence: "unknown".to_string(),
        last_failure_reason: String::new(),
        score: i64::MAX / 4,
    });
    let previous_delay = health.last_delay;
    health.name = name.to_string();
    health.protocol = protocol.to_string();
    health.last_tested_at = now;
    health.last_delay = delay;
    if delay > 0 {
        health.success_count = health.success_count.saturating_add(1);
        health.failure_streak = 0;
        health.last_success_at = now;
        health.cooldown_until = 0;
        health.median_delay = if health.median_delay > 0 {
            (health.median_delay + delay) / 2
        } else {
            delay
        };
        health.jitter = if previous_delay > 0 {
            (delay - previous_delay).abs()
        } else {
            0
        };
        health.last_failure_reason.clear();
    } else {
        health.failure_count = health.failure_count.saturating_add(1);
        health.failure_streak = health.failure_streak.saturating_add(1);
        health.last_failure_reason = if failure_reason.trim().is_empty() {
            "timeout".to_string()
        } else {
            failure_reason.to_string()
        };
        health.cooldown_until = if health.failure_streak >= 2 {
            now.saturating_add(180)
        } else {
            0
        };
    }
    health.status = health_status(delay, health.failure_streak, health.cooldown_until, now);
    health.confidence = speed_result_confidence(
        delay,
        health.failure_streak,
        health.last_success_at,
        health.last_tested_at,
        health.cooldown_until,
        now,
    );
    health.score = health_score(
        if health.median_delay > 0 {
            health.median_delay
        } else {
            delay
        },
        health.jitter,
        health.failure_streak,
        protocol,
    );
    health
}

fn speed_test_phases(
    targets: Vec<SpeedTestTarget>,
    health: &HashMap<String, NodeHealth>,
    now: u64,
) -> Vec<(Vec<SpeedTestTarget>, usize)> {
    let mut ordered = targets;
    ordered.sort_by_key(|target| {
        let current = health.get(&target.name);
        let cooldown = current
            .map(|item| item.cooldown_until > now)
            .unwrap_or(false);
        let family_rank = match protocol_family(&target.protocol) {
            "ss" | "trojan" | "vmess" | "reality" | "generic" => 0,
            "ss-obfs" | "hysteria" | "wireguard" => 1,
            "tuic" => 2,
            _ => 1,
        };
        let score = current.map(|item| item.score).unwrap_or(800);
        (cooldown, family_rank, score)
    });
    let first_count = ordered.len().min(24);
    let first = ordered
        .iter()
        .take(first_count)
        .cloned()
        .collect::<Vec<_>>();
    let rest = ordered.into_iter().skip(first_count).collect::<Vec<_>>();
    let mut phases = Vec::new();
    if !first.is_empty() {
        phases.push((first, 24usize));
    }
    if !rest.is_empty() {
        let chunk_size = rest
            .iter()
            .map(|target| protocol_concurrency(&target.protocol))
            .max()
            .unwrap_or(FLCLASH_STYLE_SPEED_BATCH_SIZE)
            .max(FLCLASH_STYLE_SPEED_BATCH_SIZE);
        phases.push((rest, chunk_size));
    }
    phases
}

fn speed_recommendation(
    targets: &[SpeedTestTarget],
    health: &HashMap<String, NodeHealth>,
    now: u64,
) -> Option<JsonValue> {
    targets
        .iter()
        .filter_map(|target| {
            let item = health.get(&target.name)?;
            if item.last_delay <= 0 || item.last_delay >= 100 || item.cooldown_until > now {
                return None;
            }
            Some((target, item))
        })
        .min_by_key(|(_, item)| (item.score, item.last_delay))
        .map(|(target, item)| {
            let confidence = speed_result_confidence(
                item.last_delay,
                item.failure_streak,
                item.last_success_at,
                item.last_tested_at,
                item.cooldown_until,
                now,
            );
            json!({
                "group": target.group_name,
                "proxy": target.select_name,
                "realProxyName": target.name,
                "delay": item.last_delay,
                "medianDelay": item.median_delay,
                "jitter": item.jitter,
                "score": item.score,
                "protocol": item.protocol,
                "confidence": confidence,
                "lastSuccessAt": item.last_success_at,
                "resultAgeSecs": now.saturating_sub(item.last_success_at),
                "reason": "latency<100ms, available, lowest health score"
            })
        })
}

fn low_latency_names(health: &HashMap<String, NodeHealth>, now: u64) -> Vec<String> {
    let mut items = health
        .values()
        .filter(|item| item.last_delay > 0 && item.last_delay < 100 && item.cooldown_until <= now)
        .cloned()
        .collect::<Vec<_>>();
    items.sort_by_key(|item| (item.score, item.last_delay));
    items.into_iter().map(|item| item.name).collect()
}

fn infer_node_region(name: &str) -> &'static str {
    let text = name.to_ascii_lowercase();
    if text.contains("hk") || name.contains("\u{9999}\u{6e2f}") || text.contains("hong kong") {
        "HK"
    } else if text.contains("jp") || name.contains("\u{65e5}\u{672c}") || text.contains("japan") {
        "JP"
    } else if text.contains("sg")
        || name.contains("\u{65b0}\u{52a0}\u{5761}")
        || text.contains("singapore")
    {
        "SG"
    } else if text.contains("tw")
        || name.contains("\u{53f0}\u{6e7e}")
        || name.contains("\u{81fa}\u{7063}")
        || text.contains("taiwan")
    {
        "TW"
    } else if text.contains("us")
        || name.contains("\u{7f8e}\u{56fd}")
        || name.contains("\u{7f8e}\u{570b}")
        || text.contains("united states")
    {
        "US"
    } else if text.contains("uk")
        || text.contains("gb")
        || name.contains("\u{82f1}\u{56fd}")
        || name.contains("\u{82f1}\u{570b}")
    {
        "GB"
    } else {
        "GL"
    }
}

fn recovery_confidence_rank(confidence: &str) -> usize {
    match confidence {
        "high" => 0,
        "medium" => 1,
        "low" => 2,
        "stale" => 3,
        "cooldown" => 4,
        "failed" => 5,
        _ => 6,
    }
}

fn delay_failure_reason_rank(reason: &str) -> usize {
    match reason {
        "auth" | "config" | "unsupported-protocol" => 0,
        "controller-unavailable" => 1,
        "dns" | "tls" | "blocked" => 2,
        "network" | "unreachable" | "node-connect" => 3,
        "timeout" => 4,
        _ => 5,
    }
}

fn merge_delay_failure_reason(current: &mut String, candidate: &str) {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return;
    }
    if current.is_empty()
        || delay_failure_reason_rank(candidate) < delay_failure_reason_rank(current)
    {
        *current = candidate.to_string();
    }
}

fn speed_test_preflight(targets: &[SpeedTestTarget]) -> Result<(), String> {
    if targets.is_empty() {
        return Err(
            "Speed test preflight failed [node-not-found]: no measurable proxy nodes".to_string(),
        );
    }
    let metadata = targets
        .iter()
        .find(|target| is_subscription_metadata_node_name(&target.name));
    if let Some(target) = metadata {
        return Err(format!(
            "Speed test preflight failed [config]: subscription metadata row entered speed targets: {}",
            target.name
        ));
    }
    let fake_ip = targets
        .iter()
        .find(|target| is_fake_ip_address(&target.server));
    if let Some(target) = fake_ip {
        return Err(format!(
            "Speed test preflight failed [dns-fake-ip]: {} resolved to fake-ip {} before probing",
            target.name, target.server
        ));
    }
    Ok(())
}

fn test_proxy_delay_plan(
    client: &Client,
    controller: &core_runtime::CoreController,
    name: &str,
    protocol: &str,
    depth: DelayProbeDepth,
) -> DelayTestResult {
    let mut failure_reason = String::new();
    for probe in delay_probe_plan(protocol, depth) {
        let result =
            test_proxy_delay_request(client, controller, name, probe.url, probe.timeout_ms);
        if result.delay >= 0 {
            return result;
        }
        merge_delay_failure_reason(&mut failure_reason, &result.failure_reason);
    }
    if failure_reason.is_empty() {
        DelayTestResult::failed("timeout")
    } else {
        DelayTestResult::failed(&failure_reason)
    }
}

fn test_proxy_delay_with_retry(
    client: &Client,
    controller: &core_runtime::CoreController,
    name: &str,
    protocol: &str,
) -> DelayTestResult {
    let fast_result =
        test_proxy_delay_plan(client, controller, name, protocol, DelayProbeDepth::Fast);
    if fast_result.delay >= 0 {
        return fast_result;
    }
    let full_result =
        test_proxy_delay_plan(client, controller, name, protocol, DelayProbeDepth::Full);
    if full_result.delay >= 0 {
        full_result
    } else if delay_failure_reason_rank(&full_result.failure_reason)
        < delay_failure_reason_rank(&fast_result.failure_reason)
    {
        full_result
    } else {
        fast_result
    }
}

fn test_proxy_delay_fast(
    client: &Client,
    controller: &core_runtime::CoreController,
    name: &str,
    protocol: &str,
) -> DelayTestResult {
    test_proxy_delay_plan(client, controller, name, protocol, DelayProbeDepth::Fast)
}

fn b64_decode_text(input: &str) -> Option<String> {
    let compact = input.trim().replace(['\r', '\n', ' '], "");
    if compact.is_empty() {
        return None;
    }
    let padded = match compact.len() % 4 {
        2 => format!("{compact}=="),
        3 => format!("{compact}="),
        _ => compact,
    };
    general_purpose::STANDARD
        .decode(&padded)
        .or_else(|_| general_purpose::URL_SAFE.decode(&padded))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == key {
            Some(percent_decode(v))
        } else {
            None
        }
    })
}

fn query_value_any(query: &str, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| query_value(query, key))
}

fn uri_name(name_part: &str, fallback: impl Into<String>) -> String {
    if name_part.is_empty() {
        fallback.into()
    } else {
        percent_decode(name_part)
    }
}

fn set_bool_query(map: &mut Mapping, key: &str, query: &str, params: &[&str]) {
    if let Some(value) = query_value_any(query, params) {
        set_yaml(map, key, YamlValue::Bool(truthy(&value)));
    }
}

fn set_string_query(map: &mut Mapping, key: &str, query: &str, params: &[&str]) {
    if let Some(value) = query_value_any(query, params).filter(|value| !value.is_empty()) {
        set_yaml(map, key, yaml_str(value));
    }
}

fn set_alpn_query(map: &mut Mapping, query: &str) {
    if let Some(alpn) = query_value(query, "alpn").filter(|value| !value.is_empty()) {
        set_yaml(
            map,
            "alpn",
            YamlValue::Sequence(
                alpn.split(',')
                    .filter(|item| !item.is_empty())
                    .map(|item| yaml_str(item.to_string()))
                    .collect(),
            ),
        );
    }
}

fn parse_plugin_option_pairs(value: &str) -> HashMap<String, String> {
    value
        .split(';')
        .skip(1)
        .filter_map(|part| {
            let (key, value) = part.split_once('=')?;
            let key = key.trim().to_ascii_lowercase();
            if key.is_empty() {
                return None;
            }
            Some((key, percent_decode(value.trim())))
        })
        .collect()
}

fn set_ss_plugin_query(map: &mut Mapping, query: &str) {
    let Some(plugin_value) = query_value(query, "plugin").filter(|value| !value.trim().is_empty())
    else {
        return;
    };
    let plugin_name = plugin_value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let normalized_plugin = if plugin_name.contains("obfs") {
        "obfs"
    } else if plugin_name.contains("v2ray") {
        "v2ray-plugin"
    } else {
        plugin_name.as_str()
    };
    if normalized_plugin.is_empty() {
        return;
    }
    set_yaml(map, "plugin", yaml_str(normalized_plugin));

    let mut option_pairs = parse_plugin_option_pairs(&plugin_value);
    for key in ["obfs", "obfs-host", "host", "path", "mode", "tls"] {
        if let Some(value) = query_value(query, key) {
            option_pairs.insert(key.to_string(), value);
        }
    }

    let mut opts = Mapping::new();
    if normalized_plugin == "obfs" {
        let mode = option_pairs
            .get("obfs")
            .or_else(|| option_pairs.get("mode"))
            .map(String::as_str)
            .unwrap_or("http");
        set_yaml(&mut opts, "mode", yaml_str(mode));
        if let Some(host) = option_pairs
            .get("obfs-host")
            .or_else(|| option_pairs.get("host"))
            .filter(|value| !value.trim().is_empty())
        {
            set_yaml(&mut opts, "host", yaml_str(host));
        }
    } else {
        for (key, value) in option_pairs {
            if value.trim().is_empty() {
                continue;
            }
            if key == "tls" {
                set_yaml(&mut opts, "tls", YamlValue::Bool(truthy(&value)));
            } else {
                set_yaml(&mut opts, &key, yaml_str(value));
            }
        }
    }
    if !opts.is_empty() {
        set_yaml(map, "plugin-opts", YamlValue::Mapping(opts));
    }
}

fn parse_ss_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("ss://")?;
    let (body, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let name = if name_part.is_empty() {
        format!("SS {index}")
    } else {
        percent_decode(name_part)
    };
    let (body, query) = body.split_once('?').unwrap_or((body, ""));
    let decoded = if body.contains('@') {
        percent_decode(body)
    } else {
        b64_decode_text(body)?
    };
    let (auth, host_port) = decoded.rsplit_once('@')?;
    let (method, password) = auth.split_once(':')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(&mut map, "name", yaml_str(name));
    set_yaml(&mut map, "type", yaml_str("ss"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "cipher", yaml_str(method));
    set_yaml(&mut map, "password", yaml_str(password));
    set_ss_plugin_query(&mut map, query);
    Some(YamlValue::Mapping(map))
}

fn parse_trojan_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("trojan://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (password, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(if name_part.is_empty() {
            format!("Trojan {index}")
        } else {
            percent_decode(name_part)
        }),
    );
    set_yaml(&mut map, "type", yaml_str("trojan"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    if let Some(sni) = query_value(query, "sni").or_else(|| query_value(query, "peer")) {
        set_yaml(&mut map, "sni", yaml_str(sni));
    }
    Some(YamlValue::Mapping(map))
}

fn parse_vmess_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("vmess://")?;
    let decoded = b64_decode_text(raw)?;
    let data: JsonValue = serde_json::from_str(&decoded).ok()?;
    let server = data.get("add")?.as_str()?;
    let port = data.get("port")?.as_str()?.parse().ok()?;
    let uuid = data.get("id")?.as_str()?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(
            data.get("ps")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(percent_decode)
                .unwrap_or_else(|| format!("VMess {index}")),
        ),
    );
    set_yaml(&mut map, "type", yaml_str("vmess"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port));
    set_yaml(&mut map, "uuid", yaml_str(uuid));
    set_yaml(
        &mut map,
        "alterId",
        yaml_num(
            data.get("aid")
                .and_then(|v| v.as_str())
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        ),
    );
    set_yaml(
        &mut map,
        "cipher",
        yaml_str(data.get("scy").and_then(|v| v.as_str()).unwrap_or("auto")),
    );
    if matches!(data.get("tls").and_then(|v| v.as_str()), Some("tls")) {
        set_yaml(&mut map, "tls", YamlValue::Bool(true));
    }
    if let Some(network) = data
        .get("net")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        set_yaml(&mut map, "network", yaml_str(network));
    }
    Some(YamlValue::Mapping(map))
}

fn parse_vless_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("vless://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (uuid, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let security = query_value(query, "security")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let network = query_value_any(query, &["type", "network"]).unwrap_or_else(|| "tcp".to_string());
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("VLESS {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("vless"));
    set_yaml(&mut map, "server", yaml_str(percent_decode(server)));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "uuid", yaml_str(percent_decode(uuid)));
    set_yaml(&mut map, "network", yaml_str(network.clone()));
    set_yaml(&mut map, "udp", YamlValue::Bool(true));
    set_string_query(&mut map, "flow", query, &["flow"]);
    set_string_query(
        &mut map,
        "servername",
        query,
        &["sni", "servername", "peer"],
    );
    set_string_query(
        &mut map,
        "client-fingerprint",
        query,
        &["fp", "fingerprint"],
    );
    set_bool_query(
        &mut map,
        "skip-cert-verify",
        query,
        &["allowInsecure", "insecure", "skip-cert-verify"],
    );
    if matches!(security.as_str(), "tls" | "reality") {
        set_yaml(&mut map, "tls", YamlValue::Bool(true));
    }
    if security == "reality" {
        let mut reality = Mapping::new();
        if let Some(public_key) = query_value_any(query, &["pbk", "public-key", "publicKey"]) {
            set_yaml(&mut reality, "public-key", yaml_str(public_key));
        }
        if let Some(short_id) = query_value_any(query, &["sid", "short-id", "shortId"]) {
            set_yaml(&mut reality, "short-id", yaml_str(short_id));
        }
        if !reality.is_empty() {
            set_yaml(&mut map, "reality-opts", YamlValue::Mapping(reality));
        }
    }
    if network == "ws" {
        let mut ws_opts = Mapping::new();
        if let Some(path) = query_value(query, "path") {
            set_yaml(&mut ws_opts, "path", yaml_str(path));
        }
        if let Some(host) = query_value_any(query, &["host", "headers"]) {
            let mut headers = Mapping::new();
            set_yaml(&mut headers, "Host", yaml_str(host));
            set_yaml(&mut ws_opts, "headers", YamlValue::Mapping(headers));
        }
        if !ws_opts.is_empty() {
            set_yaml(&mut map, "ws-opts", YamlValue::Mapping(ws_opts));
        }
    }
    if network == "grpc" {
        let mut grpc_opts = Mapping::new();
        if let Some(service_name) = query_value_any(query, &["serviceName", "service-name"]) {
            set_yaml(&mut grpc_opts, "grpc-service-name", yaml_str(service_name));
        }
        if !grpc_opts.is_empty() {
            set_yaml(&mut map, "grpc-opts", YamlValue::Mapping(grpc_opts));
        }
    }
    Some(YamlValue::Mapping(map))
}

fn truthy(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn parse_hysteria2_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri
        .strip_prefix("hysteria2://")
        .or_else(|| uri.strip_prefix("hy2://"))?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (password, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("Hysteria2 {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("hysteria2"));
    set_yaml(&mut map, "server", yaml_str(percent_decode(server)));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    set_string_query(&mut map, "sni", query, &["sni", "peer"]);
    set_bool_query(
        &mut map,
        "skip-cert-verify",
        query,
        &["insecure", "allowInsecure", "skip-cert-verify"],
    );
    set_string_query(&mut map, "obfs", query, &["obfs"]);
    set_string_query(
        &mut map,
        "obfs-password",
        query,
        &["obfs-password", "obfs_password", "obfsPassword"],
    );
    set_alpn_query(&mut map, query);
    Some(YamlValue::Mapping(map))
}

fn parse_anytls_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("anytls://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (password, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("AnyTLS {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("anytls"));
    set_yaml(&mut map, "server", yaml_str(percent_decode(server)));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    set_string_query(&mut map, "sni", query, &["sni", "servername", "peer"]);
    set_string_query(
        &mut map,
        "client-fingerprint",
        query,
        &["fp", "fingerprint"],
    );
    set_bool_query(
        &mut map,
        "skip-cert-verify",
        query,
        &["insecure", "allowInsecure", "skip-cert-verify"],
    );
    set_alpn_query(&mut map, query);
    Some(YamlValue::Mapping(map))
}

fn parse_tuic_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("tuic://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (auth, host_port) = main.split_once('@')?;
    let (uuid, password) = auth.split_once(':')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(if name_part.is_empty() {
            format!("TUIC {index}")
        } else {
            percent_decode(name_part)
        }),
    );
    set_yaml(&mut map, "type", yaml_str("tuic"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "uuid", yaml_str(percent_decode(uuid)));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    if let Some(sni) = query_value(query, "sni") {
        set_yaml(&mut map, "sni", yaml_str(sni));
    }
    set_alpn_query(&mut map, query);
    if let Some(fp) = query_value(query, "fp") {
        set_yaml(&mut map, "client-fingerprint", yaml_str(fp));
    }
    if let Some(cc) = query_value(query, "congestion_control") {
        set_yaml(&mut map, "congestion-controller", yaml_str(cc));
    }
    if let Some(mode) = query_value(query, "udp_relay_mode") {
        set_yaml(&mut map, "udp-relay-mode", yaml_str(mode));
    }
    if let Some(reduce_rtt) = query_value(query, "reduce_rtt") {
        set_yaml(&mut map, "reduce-rtt", YamlValue::Bool(truthy(&reduce_rtt)));
    }
    if let Some(udp) = query_value(query, "udp") {
        set_yaml(&mut map, "udp", YamlValue::Bool(truthy(&udp)));
    }
    if let Some(tfo) = query_value(query, "tfo") {
        set_yaml(&mut map, "fast-open", YamlValue::Bool(truthy(&tfo)));
    }
    Some(YamlValue::Mapping(map))
}

fn summarize_profile_source(
    config: &YamlValue,
    format: &str,
    unsupported_lines: usize,
) -> Result<ProfileSourceSummary, String> {
    subscription_runtime::summarize_source(config, format, unsupported_lines)
}

fn profile_file_summary(profile: &Profile) -> Result<ProfileSourceSummary, String> {
    let path = Path::new(&profile.path);
    if !path.exists() {
        return Err(format!("profile file missing: {}", profile.path));
    }
    let raw = fs::read_to_string(path).map_err(|err| format!("profile file read failed: {err}"))?;
    let config: YamlValue =
        serde_yaml::from_str(&raw).map_err(|err| format!("profile YAML parse failed: {err}"))?;
    summarize_profile_source(&config, "profile-file", 0)
}

fn should_repair_profile_metadata(profile: &Profile) -> bool {
    profile.profile_type == "url"
        && !profile.path.trim().is_empty()
        && (profile.node_count == 0 || profile.proxy_group_count == 0)
}

fn derived_profile_metadata(profile: &Profile) -> (usize, usize, &'static str, Option<String>) {
    if !should_repair_profile_metadata(profile) {
        return (
            profile.node_count,
            profile.proxy_group_count,
            "stored",
            None,
        );
    }
    match profile_file_summary(profile) {
        Ok(summary) => {
            let status = if summary.proxies != profile.node_count
                || summary.proxy_groups != profile.proxy_group_count
            {
                "repaired"
            } else {
                "stored"
            };
            (summary.proxies, summary.proxy_groups, status, None)
        }
        Err(err) => (
            profile.node_count,
            profile.proxy_group_count,
            "stale",
            Some(err),
        ),
    }
}

fn public_profile(profile: &Profile) -> JsonValue {
    let (node_count, proxy_group_count, metadata_status, metadata_error) =
        derived_profile_metadata(profile);
    let source_url = profile
        .source_url
        .as_ref()
        .map(|value| sanitize_sensitive_text(value));
    json!({
        "id": &profile.id,
        "name": &profile.name,
        "type": &profile.profile_type,
        "profile_type": &profile.profile_type,
        "path": &profile.path,
        "source_url": source_url,
        "node_count": node_count,
        "nodeCount": node_count,
        "proxy_group_count": proxy_group_count,
        "proxyGroupCount": proxy_group_count,
        "updated_at": &profile.updated_at,
        "digest": &profile.digest,
        "metadataStatus": metadata_status,
        "metadataError": metadata_error
    })
}

fn parse_uri_subscription(text: &str) -> Option<YamlValue> {
    let body = decoded_subscription_body(text);
    let mut proxies = Vec::new();
    for (index, line) in body
        .lines()
        .map(str::trim)
        .filter(|line| !is_ignorable_subscription_line(line))
        .enumerate()
    {
        let item = if line.starts_with("ss://") {
            parse_ss_uri(line, index + 1)
        } else if line.starts_with("trojan://") {
            parse_trojan_uri(line, index + 1)
        } else if line.starts_with("vmess://") {
            parse_vmess_uri(line, index + 1)
        } else if line.starts_with("vless://") {
            parse_vless_uri(line, index + 1)
        } else if line.starts_with("hysteria2://") || line.starts_with("hy2://") {
            parse_hysteria2_uri(line, index + 1)
        } else if line.starts_with("anytls://") {
            parse_anytls_uri(line, index + 1)
        } else if line.starts_with("tuic://") {
            parse_tuic_uri(line, index + 1)
        } else {
            None
        };
        if let Some(proxy) = item {
            proxies.push(proxy);
        }
    }
    if proxies.is_empty() {
        return None;
    }
    let mut root = Mapping::new();
    set_yaml(&mut root, "proxies", YamlValue::Sequence(proxies));
    Some(YamlValue::Mapping(root))
}

fn parse_uri_subscription_source_diagnostic(text: &str) -> Result<ProfileSource, String> {
    let config = parse_uri_subscription(text).ok_or_else(|| {
        let unsupported = unsupported_uri_schemes(text);
        if unsupported.is_empty() {
            subscription_diagnostic(
                "unsupported-format",
                "content is not Clash YAML and no supported proxy URI lines were found",
                "use a Clash/Mihomo subscription, or URI lines for ss/vmess/vless/trojan/hysteria2/anytls/tuic",
            )
        } else {
            subscription_diagnostic(
                "unsupported-protocol",
                format!("unsupported URI protocol(s): {}", unsupported.join(", ")),
                "switch the subscription protocol to Clash/Mihomo, or import a protocol supported by the current bundled core",
            )
        }
    })?;
    let body = decoded_subscription_body(text);
    let unsupported_lines = body
        .lines()
        .map(str::trim)
        .filter(|line| !is_ignorable_subscription_line(line))
        .filter(|line| {
            !line.starts_with("ss://")
                && !line.starts_with("trojan://")
                && !line.starts_with("vmess://")
                && !line.starts_with("vless://")
                && !line.starts_with("hysteria2://")
                && !line.starts_with("hy2://")
                && !line.starts_with("anytls://")
                && !line.starts_with("tuic://")
        })
        .count();
    let summary = summarize_profile_source(&config, "uri", unsupported_lines).map_err(|err| {
        subscription_diagnostic(
            "empty-proxies",
            err,
            "check the subscription content and retry",
        )
    })?;
    Ok(ProfileSource { config, summary })
}

fn parse_profile_source_text_diagnostic(text: &str) -> Result<ProfileSource, String> {
    let source_text = decoded_subscription_body(text);
    match serde_yaml::from_str::<YamlValue>(&source_text) {
        Ok(YamlValue::Mapping(map)) => {
            let config = YamlValue::Mapping(map);
            let summary = summarize_profile_source(&config, "clash-yaml", 0).map_err(|err| {
                subscription_diagnostic(
                    "empty-proxies",
                    err,
                    "check whether the subscription contains usable proxy nodes",
                )
            })?;
            Ok(ProfileSource { config, summary })
        }
        Ok(_) => parse_uri_subscription_source_diagnostic(&source_text),
        Err(err) => {
            if looks_like_clash_yaml(&source_text) {
                return Err(subscription_diagnostic(
                    "yaml-parse",
                    format!("Clash YAML parse failed: {err}"),
                    "open the subscription in the airport panel and choose a Clash/Mihomo format, then retry",
                ));
            }
            parse_uri_subscription_source_diagnostic(&source_text)
        }
    }
}

fn download_profile_source_url_diagnostic(url: &str) -> Result<ProfileSource, String> {
    let parsed = reqwest::Url::parse(url).map_err(|err| {
        subscription_diagnostic(
            "invalid-url",
            format!("invalid subscription URL: {err}"),
            "copy the full airport subscription URL again and make sure it starts with http:// or https://",
        )
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(subscription_diagnostic(
            "invalid-url",
            format!("unsupported URL scheme: {}", parsed.scheme()),
            "Aegos imports remote subscriptions through HTTP/HTTPS URLs; paste the airport subscription link instead of a local or custom scheme",
        ));
    }
    let text = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| {
            subscription_diagnostic(
                "download-client",
                format!("download client init failed: {err}"),
                "restart Aegos and retry; if it repeats, export logs for diagnosis",
            )
        })?
        .get(url)
        .header("User-Agent", format!("Aegos/{}", env!("CARGO_PKG_VERSION")))
        .send()
        .map_err(|err| {
            subscription_diagnostic(
                "download-failed",
                format!("subscription download failed: {err}"),
                "check system proxy/network reachability, then retry updating the subscription",
            )
        })?
        .error_for_status()
        .map_err(|err| {
            subscription_diagnostic(
                "http-status",
                format!("subscription download failed: bad HTTP status: {err}"),
                "check whether the subscription is expired, token is wrong, or the airport blocks this request",
            )
        })?
        .text()
        .map_err(|err| {
            subscription_diagnostic(
                "read-failed",
                format!("subscription read failed: {err}"),
                "retry once; if it repeats, the server may be returning malformed content",
            )
        })?;
    if text.trim().is_empty() {
        return Err(subscription_diagnostic(
            "empty-content",
            "subscription download returned empty content",
            "check whether the subscription token is expired or the airport returned an empty plan",
        ));
    }
    parse_profile_source_text_diagnostic(&text)
}

fn is_fake_ip_address(value: &str) -> bool {
    let text = value.trim();
    text.starts_with("198.18.") || text.starts_with("198.19.")
}

fn is_subscription_metadata_node_name(name: &str) -> bool {
    let text = name.trim();
    if text.is_empty() {
        return true;
    }
    let lower = text.to_ascii_lowercase();
    lower.starts_with("traffic:")
        || lower.starts_with("expire:")
        || lower.starts_with("expiry:")
        || lower.starts_with("remaining:")
        || lower.contains(" gb |")
        || lower.contains("traffic:")
        || lower.contains("expire:")
        || text.contains("娴侀噺")
        || text.contains("鍓╀綑")
        || text.contains("鍒版湡")
        || text.contains("杩囨湡")
        || text.contains("濂楅")
}

fn sanitize_subscription_metadata_nodes(config: &mut Mapping) -> usize {
    let mut removed = HashSet::new();
    if let Some(YamlValue::Sequence(proxies)) = config.get_mut(yaml_key("proxies")) {
        proxies.retain(|proxy| {
            let keep = proxy
                .as_mapping()
                .and_then(|map| map.get(yaml_key("name")))
                .and_then(|value| value.as_str())
                .map(|name| !is_subscription_metadata_node_name(name))
                .unwrap_or(true);
            if !keep {
                if let Some(name) = proxy
                    .as_mapping()
                    .and_then(|map| map.get(yaml_key("name")))
                    .and_then(|value| value.as_str())
                {
                    removed.insert(name.to_string());
                }
            }
            keep
        });
    }
    if removed.is_empty() {
        return 0;
    }
    if let Some(YamlValue::Sequence(groups)) = config.get_mut(yaml_key("proxy-groups")) {
        for group in groups {
            let Some(map) = group.as_mapping_mut() else {
                continue;
            };
            if let Some(YamlValue::Sequence(items)) = map.get_mut(yaml_key("proxies")) {
                items.retain(|item| {
                    item.as_str()
                        .map(|name| !removed.contains(name))
                        .unwrap_or(true)
                });
            }
        }
    }
    removed.len()
}

fn patch_config_with_settings(
    source: YamlValue,
    settings: &Settings,
    profile_id: Option<&str>,
) -> Result<YamlValue, String> {
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
        YamlValue::Number(settings.mixed_port.into()),
    );
    set_yaml(
        &mut config,
        "allow-lan",
        YamlValue::Bool(settings.allow_lan),
    );
    set_yaml(
        &mut config,
        "bind-address",
        YamlValue::String(if settings.allow_lan { "*" } else { "127.0.0.1" }.to_string()),
    );
    set_yaml(
        &mut config,
        "mode",
        YamlValue::String(settings.mode.clone()),
    );
    set_yaml(
        &mut config,
        "log-level",
        YamlValue::String(settings.log_level.clone()),
    );
    set_yaml(
        &mut config,
        "external-controller",
        YamlValue::String(format!("127.0.0.1:{}", settings.controller_port)),
    );
    set_yaml(
        &mut config,
        "secret",
        YamlValue::String(settings.secret.clone()),
    );
    set_yaml(&mut config, "ipv6", YamlValue::Bool(settings.ipv6_enabled));
    set_yaml(
        &mut config,
        "find-process-mode",
        YamlValue::String("strict".to_string()),
    );
    set_yaml(&mut config, "unified-delay", YamlValue::Bool(true));
    set_yaml(&mut config, "tcp-concurrent", YamlValue::Bool(true));
    config_pipeline::harden_runtime_dns(&mut config);
    sanitize_subscription_metadata_nodes(&mut config);

    if settings.tun_enabled {
        let tun = config
            .entry(yaml_key("tun"))
            .or_insert_with(|| YamlValue::Mapping(Mapping::new()));
        let tun_map = get_mapping_mut(tun);
        set_yaml(tun_map, "enable", YamlValue::Bool(true));
        set_yaml(
            tun_map,
            "stack",
            YamlValue::String(settings.tun_stack.clone()),
        );
        set_yaml(tun_map, "auto-route", YamlValue::Bool(true));
        set_yaml(tun_map, "auto-detect-interface", YamlValue::Bool(true));
        set_yaml(
            tun_map,
            "dns-hijack",
            if settings.dns_hijack_enabled {
                YamlValue::Sequence(vec![YamlValue::String("any:53".to_string())])
            } else {
                YamlValue::Sequence(Vec::new())
            },
        );
    } else if let Some(tun) = config.get_mut(yaml_key("tun")) {
        set_yaml(get_mapping_mut(tun), "enable", YamlValue::Bool(false));
    }

    if let Some(profile_id) = profile_id {
        apply_manual_nodes(&mut config, settings, profile_id)?;
    }

    let proxy_name_strings = proxy_node_names(&config);
    let proxy_names: Vec<YamlValue> = proxy_name_strings
        .iter()
        .map(|name| yaml_str(name))
        .collect();
    config_pipeline::normalize_runtime_proxy_groups_for_display(&mut config);

    if !matches!(config.get(yaml_key("rules")), Some(YamlValue::Sequence(items)) if !items.is_empty())
    {
        let target = if proxy_names.is_empty() {
            "DIRECT"
        } else {
            "GLOBAL"
        };
        set_yaml(
            &mut config,
            "rules",
            YamlValue::Sequence(vec![YamlValue::String(format!("MATCH,{target}"))]),
        );
    }
    insert_outbound_ip_rules(&mut config, settings);
    Ok(YamlValue::Mapping(config))
}

fn normalize_manual_node(input: &JsonValue) -> Result<JsonValue, String> {
    let Some(map) = input.as_object() else {
        return Err("Manual node must be an object.".to_string());
    };
    let name = map
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    let server = map
        .get("server")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    let node_type = core_runtime::normalize_proxy_type(
        map.get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("ss")
            .trim(),
    );
    let port = map
        .get("port")
        .and_then(|value| value.as_u64())
        .or_else(|| {
            map.get("port")
                .and_then(|value| value.as_str())
                .and_then(|value| value.trim().parse::<u64>().ok())
        });
    let Some(port) = port else {
        return Err("Manual node port is required.".to_string());
    };
    if name.is_empty() {
        return Err("Manual node name is required.".to_string());
    }
    if server.is_empty() {
        return Err("璇疯緭鍏ュ浐瀹氳妭鐐瑰湴鍧€".to_string());
    }
    if port == 0 || port > 65535 {
        return Err("鍥哄畾鑺傜偣绔彛蹇呴』鍦?1-65535 涔嬮棿".to_string());
    }
    if !core_runtime::supports_proxy_type(&node_type) {
        return Err(format!(
            "Unsupported manual node protocol: {node_type}; {}",
            core_runtime::protocol_capability_summary(AEGOS_URI_PROTOCOLS)
        ));
    }
    if !matches!(
        node_type.as_str(),
        "ss" | "ssr"
            | "vmess"
            | "vless"
            | "trojan"
            | "socks5"
            | "http"
            | "hysteria"
            | "hysteria2"
            | "hy2"
            | "anytls"
            | "tuic"
            | "snell"
            | "wireguard"
            | "ssh"
            | "direct"
            | "reject"
    ) {
        return Err(format!("鏆備笉鏀寔鐨勫浐瀹氳妭鐐瑰崗璁細{node_type}"));
    }

    let mut node = serde_json::Map::new();
    node.insert("name".to_string(), json!(name));
    node.insert("type".to_string(), json!(node_type));
    node.insert("server".to_string(), json!(server));
    node.insert("port".to_string(), json!(port));

    for key in [
        "password",
        "cipher",
        "uuid",
        "alterId",
        "username",
        "servername",
        "sni",
        "network",
        "flow",
        "skip-cert-verify",
        "client-fingerprint",
        "obfs",
        "obfs-password",
    ] {
        if let Some(value) = map.get(key) {
            if !value
                .as_str()
                .map(|text| text.trim().is_empty())
                .unwrap_or(false)
            {
                node.insert(key.to_string(), value.clone());
            }
        }
    }
    if let Some(value) = map.get("tls").and_then(|value| value.as_bool()) {
        node.insert("tls".to_string(), json!(value));
    }
    node.insert(
        "udp".to_string(),
        json!(map
            .get("udp")
            .and_then(|value| value.as_bool())
            .unwrap_or(true)),
    );
    node.insert("manual".to_string(), json!(true));
    node.insert("fixed".to_string(), json!(true));
    node.insert("static".to_string(), json!(true));
    node.insert("source".to_string(), json!("manual"));
    Ok(JsonValue::Object(node))
}

fn manual_node_yaml(node: &JsonValue) -> Result<YamlValue, String> {
    let mut clean = serde_json::Map::new();
    let Some(map) = node.as_object() else {
        return Err("鎵嬪姩鑺傜偣鏁版嵁鏃犳晥".to_string());
    };
    for (key, value) in map {
        if matches!(
            key.as_str(),
            "manual"
                | "fixed"
                | "static"
                | "residential"
                | "source"
                | "profileType"
                | "originalName"
        ) {
            continue;
        }
        clean.insert(key.clone(), value.clone());
    }
    serde_yaml::to_value(JsonValue::Object(clean)).map_err(|err| err.to_string())
}

fn proxy_name(value: &YamlValue) -> Option<&str> {
    value
        .as_mapping()
        .and_then(|map| map.get(yaml_key("name")))
        .and_then(|value| value.as_str())
}

fn ensure_yaml_sequence<'a>(config: &'a mut Mapping, key: &str) -> &'a mut Vec<YamlValue> {
    let value = config
        .entry(yaml_key(key))
        .or_insert_with(|| YamlValue::Sequence(Vec::new()));
    if !matches!(value, YamlValue::Sequence(_)) {
        *value = YamlValue::Sequence(Vec::new());
    }
    value.as_sequence_mut().expect("sequence")
}

fn insert_manual_node_into_config(
    config: &mut Mapping,
    node: &JsonValue,
    original_name: Option<&str>,
) -> Result<(), String> {
    let name = node
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "鎵嬪姩鑺傜偣缂哄皯鍚嶇О".to_string())?;
    let original = original_name.unwrap_or(name);
    let proxy = manual_node_yaml(node)?;
    {
        let proxies = ensure_yaml_sequence(config, "proxies");
        let existing_index = proxies
            .iter()
            .position(|item| proxy_name(item) == Some(original));
        if proxies
            .iter()
            .enumerate()
            .any(|(index, item)| proxy_name(item) == Some(name) && Some(index) != existing_index)
        {
            return Err(format!("鍥哄畾鑺傜偣鍚嶇О宸插瓨鍦細{name}"));
        }
        if let Some(index) = existing_index {
            proxies[index] = proxy;
        } else {
            proxies.push(proxy);
        }
    }

    let groups = ensure_yaml_sequence(config, "proxy-groups");
    if groups.is_empty() {
        let mut group = Mapping::new();
        set_yaml(&mut group, "name", yaml_str("GLOBAL"));
        set_yaml(&mut group, "type", yaml_str("select"));
        set_yaml(
            &mut group,
            "proxies",
            YamlValue::Sequence(vec![yaml_str(name), yaml_str("DIRECT")]),
        );
        groups.push(YamlValue::Mapping(group));
        return Ok(());
    }

    let mut target_index = 0usize;
    for (index, group) in groups.iter().enumerate() {
        let Some(map) = group.as_mapping() else {
            continue;
        };
        let group_name = map
            .get(yaml_key("name"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let group_type = map
            .get(yaml_key("type"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_lowercase();
        if matches!(group_name, "GLOBAL" | "Proxies" | "Proxy")
            || matches!(
                group_type.as_str(),
                "select" | "url-test" | "fallback" | "load-balance"
            )
        {
            target_index = index;
            break;
        }
    }

    for group in groups.iter_mut() {
        let Some(map) = group.as_mapping_mut() else {
            continue;
        };
        let list = map
            .entry(yaml_key("proxies"))
            .or_insert_with(|| YamlValue::Sequence(Vec::new()));
        if !matches!(list, YamlValue::Sequence(_)) {
            *list = YamlValue::Sequence(Vec::new());
        }
        if let Some(list) = list.as_sequence_mut() {
            for item in list.iter_mut() {
                if item.as_str() == Some(original) {
                    *item = yaml_str(name);
                }
            }
        }
    }

    if let Some(map) = groups
        .get_mut(target_index)
        .and_then(|group| group.as_mapping_mut())
    {
        let list = map
            .entry(yaml_key("proxies"))
            .or_insert_with(|| YamlValue::Sequence(Vec::new()));
        if let Some(list) = list.as_sequence_mut() {
            if !list.iter().any(|item| item.as_str() == Some(name)) {
                list.push(yaml_str(name));
            }
        }
    }
    Ok(())
}

fn apply_manual_nodes(
    config: &mut Mapping,
    settings: &Settings,
    profile_id: &str,
) -> Result<(), String> {
    let Some(nodes) = settings.manual_nodes.get(profile_id) else {
        return Ok(());
    };
    for node in nodes.values() {
        insert_manual_node_into_config(config, node, None)?;
    }
    Ok(())
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

fn preflight_runtime_config(
    config: &YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<JsonValue, String> {
    core_runtime::preflight_runtime_config(
        config,
        core_runtime::RuntimeConfigPreflightInput {
            profile_id: &profile.id,
            profile_type: &profile.profile_type,
            profile_name: &profile.name,
            mixed_port: settings.mixed_port,
            controller_port: settings.controller_port,
            uri_protocols: AEGOS_URI_PROTOCOLS,
        },
    )
}
fn normalize_outbound_ip_response(text: &str) -> Option<String> {
    let candidate = text
        .trim()
        .trim_matches('"')
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches(',')
        .to_string();
    if candidate.parse::<IpAddr>().is_ok() {
        Some(candidate)
    } else {
        None
    }
}

fn query_outbound_ip(mixed_port: u16) -> Result<String, String> {
    let proxy_url = format!("http://127.0.0.1:{mixed_port}");
    let proxy = reqwest::Proxy::all(&proxy_url).map_err(|err| err.to_string())?;
    let client = Client::builder()
        .proxy(proxy)
        .user_agent("Aegos/2 outbound-ip-check")
        .timeout(Duration::from_millis(2800))
        .build()
        .map_err(|err| err.to_string())?;
    let services = [
        "https://api.ipify.org",
        "https://api64.ipify.org",
        "https://checkip.amazonaws.com",
        "https://ident.me",
        "https://ifconfig.me/ip",
        "https://icanhazip.com",
        "http://api.ipify.org",
        "http://ifconfig.me/ip",
    ];
    let mut last_error = String::new();
    for url in services {
        match client
            .get(url)
            .send()
            .and_then(|res| res.error_for_status())
        {
            Ok(res) => match res.text() {
                Ok(text) => {
                    if let Some(ip) = normalize_outbound_ip_response(&text) {
                        return Ok(ip);
                    }
                    last_error = format!("{url} returned an invalid IP response");
                }
                Err(err) => last_error = err.to_string(),
            },
            Err(err) => last_error = err.to_string(),
        }
    }
    if last_error.is_empty() {
        Err("Unable to query outbound IP".to_string())
    } else {
        Err(format!("Unable to query outbound IP: {last_error}"))
    }
}
fn query_outbound_ip_family(mixed_port: u16, family: &str) -> Result<String, String> {
    let proxy_url = format!("http://127.0.0.1:{mixed_port}");
    let proxy = reqwest::Proxy::all(&proxy_url).map_err(|err| err.to_string())?;
    let client = Client::builder()
        .proxy(proxy)
        .user_agent("Aegos/3 ipv6-dns-safety-check")
        .timeout(Duration::from_millis(2600))
        .build()
        .map_err(|err| err.to_string())?;
    let services: &[&str] = match family {
        "ipv6" => &[
            "https://api6.ipify.org",
            "https://v6.ident.me",
            "https://icanhazip.com",
        ],
        _ => &[
            "https://api.ipify.org",
            "https://api.ipify.org?format=text",
            "http://api.ipify.org",
        ],
    };
    let mut last_error = String::new();
    for url in services {
        match client
            .get(*url)
            .send()
            .and_then(|res| res.error_for_status())
        {
            Ok(res) => match res.text() {
                Ok(text) => {
                    if let Some(ip) = normalize_outbound_ip_response(&text) {
                        let parsed = ip.parse::<IpAddr>().map_err(|err| err.to_string())?;
                        if (family == "ipv6" && parsed.is_ipv6())
                            || (family != "ipv6" && parsed.is_ipv4())
                        {
                            return Ok(ip);
                        }
                        last_error = format!("{url} returned {ip}, not {family}");
                    } else {
                        last_error = format!("{url} returned an invalid IP response");
                    }
                }
                Err(err) => last_error = err.to_string(),
            },
            Err(err) => last_error = err.to_string(),
        }
    }
    Err(if last_error.is_empty() {
        format!("{family} outlet unavailable")
    } else {
        format!("{family} outlet unavailable: {last_error}")
    })
}

fn local_ipv6_capability() -> JsonValue {
    match UdpSocket::bind("[::]:0") {
        Ok(socket) => {
            let routed = socket.connect("[2606:4700:4700::1111]:53").is_ok();
            let local = socket
                .local_addr()
                .ok()
                .map(|addr| addr.ip().to_string())
                .unwrap_or_else(|| "::".to_string());
            let usable = routed
                && local
                    .parse::<IpAddr>()
                    .map(|ip| ip.is_ipv6() && ip.to_string() != "::")
                    .unwrap_or(false);
            json!({
                "available": usable,
                "routed": routed,
                "localAddress": if usable { local } else { "-".to_string() },
                "method": "udp-route-probe",
                "changesConnection": false
            })
        }
        Err(err) => json!({
            "available": false,
            "routed": false,
            "localAddress": "-",
            "method": "udp-route-probe",
            "error": err.to_string(),
            "changesConnection": false
        }),
    }
}

fn ipv6_dns_safety_from_parts(
    local: JsonValue,
    ipv4_outlet: Result<String, String>,
    ipv6_outlet: Result<String, String>,
    dns_safety: Result<String, String>,
    settings: &Settings,
    running: bool,
) -> JsonValue {
    let local_available = local
        .get("available")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let ipv4_ok = ipv4_outlet.is_ok();
    let ipv6_ok = ipv6_outlet.is_ok();
    let node_ipv6_support = if !running {
        "unknown"
    } else if ipv6_ok {
        "supported"
    } else {
        "unsupported"
    };
    let leak_level = if !local_available || ipv6_ok {
        "none"
    } else if settings.ipv6_enabled {
        "risk"
    } else {
        "blocked"
    };
    let action = if !local_available {
        "local-ipv6-unavailable"
    } else if ipv6_ok {
        "use-ipv6"
    } else if settings.ipv6_enabled {
        "block-ipv6-leak"
    } else {
        "fallback-ipv4"
    };
    let plain_prompt = match action {
        "use-ipv6" => "Current node supports IPv6.",
        "block-ipv6-leak" => "Current node does not support IPv6; IPv6 leak should be blocked.",
        "fallback-ipv4" => "Current node does not support IPv6; Aegos is using IPv4.",
        _ => "Local IPv6 is unavailable; Aegos is using IPv4.",
    };
    json!({
        "mode": "auto",
        "changesConnection": false,
        "localIpv6": local,
        "currentNodeIpv4": {
            "ok": ipv4_ok,
            "ip": ipv4_outlet.as_ref().ok(),
            "error": ipv4_outlet.as_ref().err()
        },
        "currentNodeIpv6": {
            "ok": ipv6_ok,
            "ip": ipv6_outlet.as_ref().ok(),
            "error": ipv6_outlet.as_ref().err()
        },
        "nodeIpv6Support": node_ipv6_support,
        "ipv6Leak": {
            "level": leak_level,
            "blockedOrFallback": leak_level != "risk",
            "action": action
        },
        "dnsLeak": {
            "ok": dns_safety.is_ok(),
            "detail": dns_safety.unwrap_or_else(|err| err),
            "hijackEnabled": settings.dns_hijack_enabled,
            "runtimeDnsListen": config_pipeline::AEGOS_DNS_LISTEN
        },
        "plainPrompt": plain_prompt,
        "checkedAt": now_secs()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_ip_filter_accepts_private_addresses_only() {
        assert_eq!(
            parse_usable_lan_ip("192.168.1.25").as_deref(),
            Some("192.168.1.25")
        );
        assert_eq!(parse_usable_lan_ip("10.7.0.4").as_deref(), Some("10.7.0.4"));
        assert_eq!(
            parse_usable_lan_ip("172.20.4.8").as_deref(),
            Some("172.20.4.8")
        );

        assert!(parse_usable_lan_ip("127.0.0.1").is_none());
        assert!(parse_usable_lan_ip("0.0.0.0").is_none());
        assert!(parse_usable_lan_ip("8.8.8.8").is_none());
        assert!(parse_usable_lan_ip("172.32.0.1").is_none());
    }

    #[test]
    fn ipv6_dns_safety_auto_falls_back_without_connection_changes() {
        let mut settings = default_settings();
        settings.ipv6_enabled = false;
        settings.dns_hijack_enabled = true;
        let report = ipv6_dns_safety_from_parts(
            json!({ "available": true, "routed": true, "localAddress": "2001:db8::10" }),
            Ok("198.51.100.10".to_string()),
            Err("ipv6 outlet unavailable".to_string()),
            Ok("listen=127.0.0.1:1054".to_string()),
            &settings,
            true,
        );
        assert_eq!(report.get("mode").and_then(JsonValue::as_str), Some("auto"));
        assert_eq!(
            report.get("changesConnection").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            report.get("nodeIpv6Support").and_then(JsonValue::as_str),
            Some("unsupported")
        );
        assert_eq!(
            report
                .get("ipv6Leak")
                .and_then(|value| value.get("action"))
                .and_then(JsonValue::as_str),
            Some("fallback-ipv4")
        );
        assert!(report
            .get("plainPrompt")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .contains("IPv4"));
    }

    #[test]
    fn routing_rule_parser_structures_common_rules() {
        let domain = parse_routing_rule_text(1, "DOMAIN-SUFFIX,example.com,Proxy");
        assert_eq!(
            domain.get("kind").and_then(JsonValue::as_str),
            Some("DOMAIN-SUFFIX")
        );
        assert_eq!(
            domain.get("category").and_then(JsonValue::as_str),
            Some("domain")
        );
        assert_eq!(
            domain.get("condition").and_then(JsonValue::as_str),
            Some("example.com")
        );
        assert_eq!(
            domain.get("target").and_then(JsonValue::as_str),
            Some("Proxy")
        );

        let geo = parse_routing_rule_text(2, "GEOIP,CN,DIRECT,no-resolve");
        assert_eq!(geo.get("kind").and_then(JsonValue::as_str), Some("GEOIP"));
        assert_eq!(
            geo.get("target").and_then(JsonValue::as_str),
            Some("DIRECT")
        );
        assert_eq!(
            geo.get("options")
                .and_then(JsonValue::as_array)
                .and_then(|items| items.first())
                .and_then(JsonValue::as_str),
            Some("no-resolve")
        );

        let logical =
            parse_routing_rule_text(3, "AND,((DOMAIN-SUFFIX,example.com),(NETWORK,TCP)),Proxy");
        assert_eq!(
            logical.get("condition").and_then(JsonValue::as_str),
            Some("((DOMAIN-SUFFIX,example.com),(NETWORK,TCP))")
        );
        assert_eq!(
            logical.get("target").and_then(JsonValue::as_str),
            Some("Proxy")
        );
    }

    #[test]
    fn routing_rule_target_validation_reports_missing_targets() {
        let config: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: Node A
    type: ss
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - Node A
rules:
  - DOMAIN-SUFFIX,example.com,Proxy
  - DOMAIN-SUFFIX,missing.example,MissingGroup
  - MATCH,DIRECT
"#,
        )
        .expect("config should parse");
        let mut rules = yaml_sequence(&config, "rules")
            .expect("rules")
            .iter()
            .enumerate()
            .map(|(index, value)| parse_routing_rule_value(index + 1, value))
            .collect::<Vec<_>>();
        let targets = routing_rule_target_catalog(&config);
        let missing = validate_routing_rule_targets(&mut rules, &targets);

        assert_eq!(missing, vec!["MissingGroup".to_string()]);
        assert_eq!(
            rules[0].get("targetExists").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            rules[1].get("status").and_then(JsonValue::as_str),
            Some("missing-target")
        );
        assert_eq!(
            rules[2].get("targetExists").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            rules[2].get("targetKind").and_then(JsonValue::as_str),
            Some("builtin")
        );
    }

    #[test]
    fn routing_rule_order_detection_reports_duplicates_conflicts_and_unreachable() {
        let mut rules = [
            "DOMAIN-SUFFIX,example.com,Proxy",
            "DOMAIN-SUFFIX,example.com,Proxy",
            "DOMAIN-SUFFIX,example.com,DIRECT",
            "MATCH,DIRECT",
            "DOMAIN-SUFFIX,later.example,Proxy",
        ]
        .iter()
        .enumerate()
        .map(|(index, rule)| parse_routing_rule_text(index + 1, rule))
        .collect::<Vec<_>>();

        let issues = detect_routing_rule_order_issues(&mut rules);
        let kinds = issues
            .iter()
            .filter_map(|issue| issue.get("kind").and_then(JsonValue::as_str))
            .collect::<Vec<_>>();

        assert!(kinds.contains(&"duplicate-rule"));
        assert!(kinds.contains(&"conflicting-target"));
        assert!(kinds.contains(&"unreachable-after-match"));
        assert_eq!(
            rules[1].get("status").and_then(JsonValue::as_str),
            Some("duplicate-rule")
        );
        assert_eq!(
            rules[2].get("status").and_then(JsonValue::as_str),
            Some("conflicting-target")
        );
        assert_eq!(
            rules[4].get("status").and_then(JsonValue::as_str),
            Some("unreachable-after-match")
        );
    }

    #[test]
    fn profile_rule_validation_summary_counts_switch_warnings() {
        let dir = std::env::temp_dir().join(format!("aegos-profile-validation-{}", hex_random(6)));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("profile.yaml");
        atomic_write_text_confined(
            &path,
            &dir,
            r#"
proxies:
  - name: Node A
    type: ss
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - Node A
rules:
  - DOMAIN-SUFFIX,example.com,Proxy
  - DOMAIN-SUFFIX,missing.example,MissingGroup
  - MATCH,DIRECT
  - DOMAIN-SUFFIX,later.example,Proxy
"#,
        )
        .expect("profile write");
        let profile = Profile {
            id: "test".to_string(),
            name: "Test".to_string(),
            profile_type: "file".to_string(),
            path: path.to_string_lossy().to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "now".to_string(),
            digest: "digest".to_string(),
        };
        let summary = routing_rule_validation_summary_for_profile(&profile);
        assert_eq!(
            summary.get("ruleCount").and_then(JsonValue::as_u64),
            Some(4)
        );
        assert_eq!(
            summary.get("warningCount").and_then(JsonValue::as_u64),
            Some(2)
        );
        assert_eq!(summary.get("ok").and_then(JsonValue::as_bool), Some(false));
        let _ = remove_file_confined(&path, &dir);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn routing_reload_preflight_contract_is_readonly_and_rollback_aware() {
        let profile = Profile {
            id: "test".to_string(),
            name: "Test".to_string(),
            profile_type: "file".to_string(),
            path: "profile.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "now".to_string(),
            digest: "digest".to_string(),
        };
        let rule_validation = json!({
            "ok": true,
            "warningCount": 0,
            "missingRuleTargets": [],
            "ruleOrderIssues": []
        });
        let contract = routing_reload_contract_from_parts(
            &profile,
            rule_validation,
            Ok(json!({ "proxies": 1, "proxyGroups": 1, "rules": 2 })),
        );

        assert_eq!(
            contract.get("readOnly").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            contract.get("writesConfig").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            contract
                .get("requiresRollbackPlan")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            contract
                .get("hotReloadAllowed")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert!(contract
            .get("steps")
            .and_then(JsonValue::as_array)
            .map(|steps| steps.len() >= 6)
            .unwrap_or(false));
    }

    #[test]
    fn routing_rollback_plan_tracks_restore_contract_without_writes() {
        let profile = Profile {
            id: "test".to_string(),
            name: "Test".to_string(),
            profile_type: "file".to_string(),
            path: "profiles/test.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "now".to_string(),
            digest: "profile-digest".to_string(),
        };
        let plan = routing_rollback_plan_from_parts(
            &profile,
            Some("profile-digest".to_string()),
            Some("test".to_string()),
            Some("runtime-config-digest".to_string()),
            Some("runtime-file-digest".to_string()),
            true,
            true,
            3,
        );

        assert_eq!(
            plan.get("readOnly").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            plan.get("writesConfig").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            plan.get("rollbackReady").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            plan.get("selectedProxyMapSize").and_then(JsonValue::as_u64),
            Some(3)
        );
        assert!(plan
            .get("restoreSequence")
            .and_then(JsonValue::as_array)
            .map(|steps| steps.len() >= 5)
            .unwrap_or(false));
    }

    #[test]
    fn routing_diagnostics_report_escalates_rule_and_runtime_findings() {
        let profile = Profile {
            id: "test".to_string(),
            name: "Test".to_string(),
            profile_type: "file".to_string(),
            path: "profiles/test.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "now".to_string(),
            digest: "profile-digest".to_string(),
        };
        let rule_validation = json!({
            "ok": false,
            "warningCount": 2,
            "ruleCount": 4,
            "missingRuleTargets": [{ "target": "Missing" }],
            "ruleOrderIssues": [{ "kind": "unreachable" }],
            "error": null
        });
        let reload_preflight = routing_reload_contract_from_parts(
            &profile,
            rule_validation.clone(),
            Err("runtime preflight failed".to_string()),
        );
        let rollback_plan = routing_rollback_plan_from_parts(
            &profile,
            Some("profile-digest".to_string()),
            Some("test".to_string()),
            Some("runtime-config-digest".to_string()),
            Some("runtime-file-digest".to_string()),
            true,
            true,
            1,
        );
        let report = routing_diagnostics_report_from_parts(
            &profile,
            rule_validation,
            reload_preflight,
            rollback_plan,
        );

        assert_eq!(
            report.get("severity").and_then(JsonValue::as_str),
            Some("error")
        );
        assert_eq!(
            report.get("readOnly").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            report.get("writesConfig").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert!(report
            .get("sections")
            .and_then(JsonValue::as_array)
            .map(|sections| sections.len() >= 4)
            .unwrap_or(false));
    }

    #[test]
    fn routing_foundation_acceptance_keeps_editing_disabled_until_gates_pass() {
        let acceptance = routing_foundation_acceptance_contract(Some("test".to_string()));

        assert_eq!(
            acceptance.get("readOnly").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            acceptance
                .get("editableRoutingEnabled")
                .and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            acceptance
                .get("requiresAllAuditsPassing")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert!(acceptance
            .get("requiredAudits")
            .and_then(JsonValue::as_array)
            .map(|audits| audits.len() >= 7)
            .unwrap_or(false));
    }

    #[test]
    fn routing_assistant_gate_defers_writes_until_wizard_steps_are_built() {
        let gate = routing_assistant_gate_contract();

        assert_eq!(
            gate.get("readOnly").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            gate.get("writesConfig").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            gate.get("startsAt").and_then(JsonValue::as_str),
            Some("3.3.1")
        );
        assert!(gate
            .get("wizardSteps")
            .and_then(JsonValue::as_array)
            .map(|steps| steps.len() >= 8)
            .unwrap_or(false));
    }

    #[test]
    fn parses_base64_tuic_subscription() {
        let uri = "tuic://00000000-0000-4000-8000-000000000000:secret@example.com:443?sni=example.com&alpn=h3&congestion_control=bbr&udp_relay_mode=native&reduce_rtt=true#HK%20TUIC";
        let encoded = general_purpose::STANDARD.encode(uri);
        let parsed = parse_uri_subscription(&encoded).expect("tuic subscription should parse");
        let proxies = parsed
            .as_mapping()
            .and_then(|root| root.get(yaml_key("proxies")))
            .and_then(YamlValue::as_sequence)
            .expect("proxies sequence");
        let proxy = proxies[0].as_mapping().expect("proxy mapping");

        assert_eq!(
            proxy.get(yaml_key("type")).and_then(YamlValue::as_str),
            Some("tuic")
        );
        assert_eq!(
            proxy.get(yaml_key("name")).and_then(YamlValue::as_str),
            Some("HK TUIC")
        );
        assert_eq!(
            proxy
                .get(yaml_key("congestion-controller"))
                .and_then(YamlValue::as_str),
            Some("bbr")
        );
        assert_eq!(
            proxy
                .get(yaml_key("reduce-rtt"))
                .and_then(YamlValue::as_bool),
            Some(true)
        );
    }

    #[test]
    fn parses_modern_uri_subscription_protocols() {
        let text = [
            "vless://00000000-0000-4000-8000-000000000000@example.com:443?security=reality&type=grpc&sni=www.microsoft.com&fp=chrome&pbk=publicKey&sid=abcd&flow=xtls-rprx-vision&serviceName=edge#US%20VLESS",
            "hysteria2://secret@example.net:8443?sni=example.net&insecure=1&obfs=salamander&obfs-password=obfsSecret&alpn=h3#SG%20HY2",
            "anytls://password@example.org:443?sni=example.org&insecure=0&alpn=h2,h3#JP%20AnyTLS",
        ].join("\n");
        let parsed = parse_uri_subscription(&text).expect("modern URI subscription should parse");
        let proxies = parsed
            .as_mapping()
            .and_then(|root| root.get(yaml_key("proxies")))
            .and_then(YamlValue::as_sequence)
            .expect("proxies sequence");

        assert_eq!(proxies.len(), 3);
        let vless = proxies[0].as_mapping().expect("vless mapping");
        assert_eq!(
            vless.get(yaml_key("type")).and_then(YamlValue::as_str),
            Some("vless")
        );
        assert_eq!(
            vless.get(yaml_key("flow")).and_then(YamlValue::as_str),
            Some("xtls-rprx-vision")
        );
        assert_eq!(
            vless
                .get(yaml_key("reality-opts"))
                .and_then(YamlValue::as_mapping)
                .and_then(|opts| opts.get(yaml_key("short-id")))
                .and_then(YamlValue::as_str),
            Some("abcd")
        );

        let hy2 = proxies[1].as_mapping().expect("hysteria2 mapping");
        assert_eq!(
            hy2.get(yaml_key("type")).and_then(YamlValue::as_str),
            Some("hysteria2")
        );
        assert_eq!(
            hy2.get(yaml_key("skip-cert-verify"))
                .and_then(YamlValue::as_bool),
            Some(true)
        );
        assert_eq!(
            hy2.get(yaml_key("obfs-password"))
                .and_then(YamlValue::as_str),
            Some("obfsSecret")
        );

        let anytls = proxies[2].as_mapping().expect("anytls mapping");
        assert_eq!(
            anytls.get(yaml_key("type")).and_then(YamlValue::as_str),
            Some("anytls")
        );
        assert_eq!(
            anytls.get(yaml_key("name")).and_then(YamlValue::as_str),
            Some("JP AnyTLS")
        );
    }

    #[test]
    fn subscription_diagnostics_classify_unsupported_protocols() {
        let err =
            parse_uri_subscription_source_diagnostic("ssr://example-one\nwireguard://example-two")
                .expect_err("unsupported protocols should be classified");

        assert!(err.contains("Subscription diagnostics [unsupported-protocol]"));
        assert!(err.contains("ssr"));
        assert!(err.contains("wireguard"));
        assert!(err.contains("Logs or Diagnostics"));
    }

    #[test]
    fn subscription_diagnostics_classify_unsupported_format() {
        let err = parse_uri_subscription_source_diagnostic("plain text without proxy uris")
            .expect_err("plain text should be classified");

        assert!(err.contains("Subscription diagnostics [unsupported-format]"));
        assert!(err.contains("Clash YAML"));
    }

    #[test]
    fn subscription_diagnostics_classify_invalid_url_scheme() {
        let err = download_profile_source_url_diagnostic("ftp://example.com/sub")
            .expect_err("non-http urls should be rejected before network access");

        assert!(err.contains("Subscription diagnostics [invalid-url]"));
        assert!(err.contains("unsupported URL scheme"));
    }

    #[test]
    fn subscription_parser_ignores_metadata_comments_and_blank_lines() {
        let raw = r#"
# airport title
subscription-userinfo: upload=1; download=2; total=3; expire=4102444800
profile-title: Example Airport
// generated comment
trojan://password@example.com:443?sni=example.com#HK%20Trojan
; trailing comment
"#;
        let source =
            parse_uri_subscription_source_diagnostic(raw).expect("metadata-wrapped URI source");

        assert_eq!(source.summary.proxies, 1);
        assert_eq!(source.summary.unsupported_lines, 0);
    }

    #[test]
    fn subscription_parser_accepts_base64_mixed_uri_sources() {
        let raw = r#"
profile-update-interval: 24
vless://00000000-0000-4000-8000-000000000000@example.com:443?security=reality&sni=www.microsoft.com&pbk=publicKey&sid=abcd#US%20VLESS
hysteria2://secret@example.net:8443?sni=example.net&insecure=1#SG%20HY2
"#;
        let encoded = general_purpose::STANDARD.encode(raw);
        let source = parse_profile_source_text_diagnostic(&encoded)
            .expect("base64 URI subscription should parse");

        assert_eq!(source.summary.format, "uri");
        assert_eq!(source.summary.proxies, 2);
        assert_eq!(source.summary.unsupported_lines, 0);
    }

    #[test]
    fn subscription_parser_accepts_bom_prefixed_clash_yaml() {
        let raw = "\u{feff}proxies:\n  - name: Node A\n    type: ss\n    server: example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: secret\nproxy-groups:\n  - name: Proxy\n    type: select\n    proxies:\n      - Node A\nrules:\n  - MATCH,Proxy\n";
        let source = parse_profile_source_text_diagnostic(raw)
            .expect("BOM-prefixed Clash YAML should parse");

        assert_eq!(source.summary.format, "clash-yaml");
        assert_eq!(source.summary.proxies, 1);
        assert_eq!(source.summary.proxy_groups, 1);
    }

    #[test]
    fn preflight_allows_proxy_groups_to_reference_groups() {
        let config: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
external-controller: 127.0.0.1:19091
secret: test
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
        let mut settings = default_settings();
        settings.secret = "test".to_string();
        let profile = Profile {
            id: "url-test".to_string(),
            name: "test".to_string(),
            profile_type: "url".to_string(),
            path: "test.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 2,
            updated_at: "test".to_string(),
            digest: "test".to_string(),
        };

        let report = preflight_runtime_config(&config, &profile, &settings)
            .expect("group-to-group references should pass preflight");
        assert_eq!(
            report.get("proxyGroups").and_then(JsonValue::as_u64),
            Some(2)
        );
    }

    #[test]
    fn preflight_rejects_proxy_group_missing_node_reference() {
        let config: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
external-controller: 127.0.0.1:19091
secret: test
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
      - Missing Node
rules:
  - MATCH,Final
"#,
        )
        .expect("yaml");
        let mut settings = default_settings();
        settings.secret = "test".to_string();
        let profile = Profile {
            id: "url-bad".to_string(),
            name: "bad".to_string(),
            profile_type: "url".to_string(),
            path: "bad.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "test".to_string(),
            digest: "test".to_string(),
        };

        let err = preflight_runtime_config(&config, &profile, &settings)
            .expect_err("missing node reference should fail preflight");
        assert!(
            err.contains("Missing Node"),
            "preflight error should name the missing target: {err}"
        );
    }

    #[test]
    fn preflight_rejects_core_unsupported_proxy_type() {
        let config: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
external-controller: 127.0.0.1:19091
secret: test
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
        let mut settings = default_settings();
        settings.secret = "test".to_string();
        let profile = Profile {
            id: "url-unsupported".to_string(),
            name: "unsupported".to_string(),
            profile_type: "url".to_string(),
            path: "unsupported.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "test".to_string(),
            digest: "test".to_string(),
        };

        let err = preflight_runtime_config(&config, &profile, &settings)
            .expect_err("unsupported core protocol should fail preflight");
        assert!(err.contains("unsupported proxy type"));
        assert!(err.contains("shadowtls"));
        assert!(err.contains("Aegos runtime proxy types"));
    }

    #[test]
    fn manual_hy2_node_is_normalized_to_hysteria2() {
        let node = normalize_manual_node(&json!({
            "name": "Static HY2",
            "type": "hy2",
            "server": "example.com",
            "port": 443,
            "password": "secret"
        }))
        .expect("hy2 manual node should be accepted");

        assert_eq!(
            node.get("type").and_then(JsonValue::as_str),
            Some("hysteria2")
        );
        assert!(core_runtime::supports_proxy_type("anytls"));
        assert!(
            core_runtime::protocol_capability_summary(AEGOS_URI_PROTOCOLS)
                .contains("Aegos URI parser")
        );
    }

    #[test]
    fn sanitized_subscription_fixtures_parse_without_real_tokens() {
        let clash = include_str!("../fixtures/subscriptions/clash-basic.yaml");
        let mixed = include_str!("../fixtures/subscriptions/mixed-uri.txt");
        let mixed_b64 = general_purpose::STANDARD.encode(mixed);

        let clash_source =
            parse_profile_source_text_diagnostic(clash).expect("sanitized Clash fixture");
        let mixed_source =
            parse_profile_source_text_diagnostic(mixed).expect("sanitized mixed URI fixture");
        let mixed_b64_source = parse_profile_source_text_diagnostic(&mixed_b64)
            .expect("sanitized base64 mixed URI fixture");

        assert_eq!(clash_source.summary.format, "clash-yaml");
        assert_eq!(clash_source.summary.proxies, 2);
        assert_eq!(mixed_source.summary.format, "uri");
        assert_eq!(mixed_source.summary.proxies, 4);
        assert_eq!(mixed_source.summary.unsupported_lines, 0);
        assert_eq!(
            mixed_b64_source.summary.proxies,
            mixed_source.summary.proxies
        );
    }

    #[test]
    fn sanitized_subscription_fixture_reports_unsupported_protocols() {
        let unsupported = include_str!("../fixtures/subscriptions/unsupported-protocol.txt");
        let err = parse_profile_source_text_diagnostic(unsupported)
            .expect_err("unsupported sanitized fixture should fail clearly");

        assert!(err.contains("Subscription diagnostics [unsupported-protocol]"));
        assert!(err.contains("ssr"));
        assert!(err.contains("shadowtls"));
    }

    #[test]
    fn runtime_dns_is_isolated_from_local_fake_ip_resolvers() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7890
dns:
  enable: true
  listen: 127.0.0.1:1053
  enhanced-mode: fake-ip
  nameserver:
    - 198.18.0.2
  proxy-server-nameserver:
    - udp://127.0.0.1:1053
proxies:
  - name: Node A
    type: ss
    server: node-a.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: GLOBAL
    type: select
    proxies:
      - Node A
rules:
  - MATCH,GLOBAL
"#,
        )
        .expect("source");
        let settings = default_settings();
        let patched = patch_config_with_settings(source, &settings, Some("test")).expect("patch");
        let dns = patched
            .get(yaml_key("dns"))
            .and_then(YamlValue::as_mapping)
            .expect("dns");
        assert_eq!(
            dns.get(yaml_key("listen")).and_then(YamlValue::as_str),
            Some(config_pipeline::AEGOS_DNS_LISTEN)
        );
        let proxy_nameservers = dns
            .get(yaml_key("proxy-server-nameserver"))
            .and_then(YamlValue::as_sequence)
            .expect("proxy nameserver");
        assert!(proxy_nameservers.iter().all(|item| item
            .as_str()
            .map(|value| !config_pipeline::is_local_or_fake_nameserver(value))
            .unwrap_or(false)));
    }

    #[test]
    fn subscription_metadata_nodes_are_removed_before_runtime_and_speed() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: "Traffic: 35.75 GB | 150 GB"
    type: ss
    server: fake.example.com
    port: 10015
    cipher: aes-128-gcm
    password: secret
  - name: "Expire: 2026-07-17"
    type: ss
    server: fake.example.com
    port: 10015
    cipher: aes-128-gcm
    password: secret
  - name: Real HK
    type: ss
    server: real.example.com
    port: 10015
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: GLOBAL
    type: select
    proxies:
      - "Traffic: 35.75 GB | 150 GB"
      - "Expire: 2026-07-17"
      - Real HK
rules:
  - MATCH,GLOBAL
"#,
        )
        .expect("source");
        let settings = default_settings();
        let patched = patch_config_with_settings(source, &settings, Some("test")).expect("patch");
        let proxy_names = yaml_sequence(&patched, "proxies")
            .expect("proxies")
            .iter()
            .filter_map(|item| item.get(yaml_key("name")).and_then(YamlValue::as_str))
            .collect::<Vec<_>>();
        assert_eq!(proxy_names, vec!["Real HK"]);

        let group_names = yaml_sequence(&patched, "proxy-groups")
            .expect("groups")
            .first()
            .and_then(|group| group.get(yaml_key("proxies")))
            .and_then(YamlValue::as_sequence)
            .expect("group proxies")
            .iter()
            .filter_map(YamlValue::as_str)
            .collect::<Vec<_>>();
        assert_eq!(group_names, vec!["Real HK", "DIRECT"]);
    }

    #[test]
    fn resolves_proxy_group_references_to_leaf_proxy() {
        let groups = vec![
            json!({
                "name": "Auto",
                "type": "URLTest",
                "now": "Node A",
                "items": [{ "name": "Node A", "type": "ss" }]
            }),
            json!({
                "name": "Final",
                "type": "Selector",
                "now": "Auto",
                "items": [{ "name": "Auto", "type": "Group", "group": true }]
            }),
        ];
        let mut selected = HashMap::new();
        selected.insert("Final".to_string(), "Auto".to_string());
        selected.insert("Auto".to_string(), "Node A".to_string());

        assert_eq!(
            core_runtime::resolve_group_leaf(&groups, &selected, "Final", 0),
            "Node A"
        );
        assert_eq!(
            core_runtime::resolve_group_leaf(&groups, &selected, "Auto", 0),
            "Node A"
        );
    }

    #[test]
    fn patch_config_adds_main_and_auto_groups_when_subscription_has_only_custom_groups() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: HK 01
    type: ss
    server: hk.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
  - name: SG 01
    type: ss
    server: sg.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Spotify
    type: select
    proxies:
      - HK 01
  - name: SG
    type: select
    proxies:
      - SG 01
rules:
  - MATCH,Spotify
"#,
        )
        .expect("source");
        let patched =
            patch_config_with_settings(source, &default_settings(), Some("test")).expect("patch");
        let group_names = yaml_sequence(&patched, "proxy-groups")
            .expect("groups")
            .iter()
            .filter_map(yaml_mapping_name)
            .collect::<Vec<_>>();
        assert!(group_names.iter().any(|name| *name == "Proxies"));
        assert!(group_names.iter().any(|name| *name == "鑷姩閫夋嫨"));
        let proxies_group = yaml_sequence(&patched, "proxy-groups")
            .expect("groups")
            .iter()
            .find(|group| yaml_mapping_name(group) == Some("Proxies"))
            .cloned()
            .expect("Proxies group");
        let proxies = proxies_group
            .get(yaml_key("proxies"))
            .and_then(YamlValue::as_sequence)
            .expect("Proxies items")
            .iter()
            .filter_map(YamlValue::as_str)
            .collect::<Vec<_>>();
        assert!(proxies.contains(&"HK 01"));
        assert!(proxies.contains(&"SG 01"));
    }

    #[test]
    fn runtime_snapshot_adds_main_and_auto_groups_for_custom_only_groups() {
        let mut groups = json!([
            {
                "name": "Spotify",
                "type": "Selector",
                "now": "HK 01",
                "items": [{ "name": "HK 01", "type": "ss", "server": "hk.example.com" }]
            },
            {
                "name": "SG",
                "type": "Selector",
                "now": "SG 01",
                "items": [{ "name": "SG 01", "type": "ss", "server": "sg.example.com" }]
            }
        ]);
        core_runtime::normalize_proxy_groups_snapshot_defaults(&mut groups);
        let names = groups
            .as_array()
            .expect("groups")
            .iter()
            .filter_map(|group| group.get("name").and_then(JsonValue::as_str))
            .collect::<Vec<_>>();
        assert_eq!(names[0], "Proxies");
        assert_eq!(names[1], core_runtime::AEGOS_AUTO_SELECT_GROUP_NAME);
        let proxies_len = groups
            .as_array()
            .expect("groups")
            .first()
            .and_then(|group| group.get("items"))
            .and_then(JsonValue::as_array)
            .map(Vec::len)
            .unwrap_or_default();
        assert_eq!(proxies_len, 2);
    }

    #[test]
    fn speed_targets_skip_proxy_group_references() {
        let groups = json!([
            {
                "name": "GLOBAL",
                "type": "Selector",
                "items": [
                    { "name": "HK", "type": "Group", "group": true, "realProxyName": "HK 01" },
                    { "name": "JP", "type": "Group", "group": true, "realProxyName": "JP 01" },
                    { "name": "HK 01", "type": "ss", "server": "hk.example.com" },
                    { "name": "JP 01", "type": "ss", "server": "jp.example.com" }
                ]
            },
            {
                "name": "HK",
                "type": "Selector",
                "items": [{ "name": "HK 01", "type": "ss", "server": "hk.example.com" }]
            }
        ]);

        let targets = CoreManager::collect_proxy_targets(&groups);
        let names = targets
            .iter()
            .map(|target| target.name.as_str())
            .collect::<Vec<_>>();
        assert!(!names.contains(&"HK"));
        assert!(!names.contains(&"JP"));
        assert!(names.contains(&"HK 01"));
        assert!(names.contains(&"JP 01"));
    }

    #[test]
    fn node_switch_preflight_validates_group_and_proxy() {
        let groups = json!([
            {
                "name": "GLOBAL",
                "type": "Selector",
                "items": [
                    { "name": "Node A", "type": "ss" },
                    { "name": "Auto", "type": "Group", "realProxyName": "Node B" }
                ]
            }
        ]);

        let ok = validate_proxy_selection_from_groups(&groups, "GLOBAL", "Node A")
            .expect("existing node should pass");
        assert_eq!(
            ok.get("realProxyName").and_then(JsonValue::as_str),
            Some("Node A")
        );

        let by_real = validate_proxy_selection_from_groups(&groups, "GLOBAL", "Node B")
            .expect("real proxy alias should pass");
        assert_eq!(
            by_real.get("realProxyName").and_then(JsonValue::as_str),
            Some("Node B")
        );

        let missing_group = validate_proxy_selection_from_groups(&groups, "Missing", "Node A")
            .expect_err("missing group should fail");
        assert!(missing_group.contains("group 'Missing' was not found"));

        let missing_proxy = validate_proxy_selection_from_groups(&groups, "GLOBAL", "Missing")
            .expect_err("missing proxy should fail");
        assert!(missing_proxy.contains("proxy 'Missing' is not in group 'GLOBAL'"));
    }

    #[test]
    fn speed_test_preflight_blocks_fake_ip_targets() {
        let targets = vec![SpeedTestTarget {
            name: "HK 01".to_string(),
            select_name: "HK 01".to_string(),
            group_name: "GLOBAL".to_string(),
            protocol: "ss".to_string(),
            server: "198.18.0.12".to_string(),
        }];
        let err = speed_test_preflight(&targets).expect_err("fake-ip target should fail");
        assert!(err.contains("dns-fake-ip"));
    }

    #[test]
    fn runtime_dns_safety_rejects_local_proxy_nameserver() {
        let config: YamlValue = serde_yaml::from_str(
            r#"
dns:
  enable: true
  listen: 127.0.0.1:1054
  enhanced-mode: fake-ip
  nameserver:
    - https://223.5.5.5/dns-query
    - https://1.1.1.1/dns-query
    - tls://8.8.8.8:853
  proxy-server-nameserver:
    - udp://127.0.0.1:1053
"#,
        )
        .unwrap();
        let err = config_pipeline::runtime_dns_safety_report(&config)
            .expect_err("local resolver should fail");
        assert!(err.contains("unsafe"));
    }

    #[test]
    fn runtime_config_digest_is_stable_until_settings_change() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: Node A
    type: ss
    server: example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - Node A
rules:
  - MATCH,Proxy
"#,
        )
        .expect("yaml");
        let mut settings = default_settings();
        settings.secret = "test".to_string();
        let first =
            patch_config_with_settings(source.clone(), &settings, None).expect("first patch");
        let second = patch_config_with_settings(source, &settings, None).expect("second patch");
        assert_eq!(
            first
                .get(yaml_key("unified-delay"))
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            first
                .get(yaml_key("tcp-concurrent"))
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        let first_yaml = serde_yaml::to_string(&first).expect("first yaml");
        let second_yaml = serde_yaml::to_string(&second).expect("second yaml");
        assert_eq!(sha256_text(&first_yaml), sha256_text(&second_yaml));

        settings.mode = "global".to_string();
        let changed = patch_config_with_settings(first, &settings, None).expect("changed patch");
        let changed_yaml = serde_yaml::to_string(&changed).expect("changed yaml");
        assert_ne!(sha256_text(&second_yaml), sha256_text(&changed_yaml));
    }

    #[test]
    fn outbound_ip_lookup_rules_use_internal_current_node_group() {
        let mut settings = default_settings();
        settings
            .selected_proxy_map
            .insert("Final".to_string(), "Node A".to_string());
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: Node A
    type: ss
    server: a.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Final
    type: select
    proxies:
      - Node A
      - DIRECT
rules:
  - DOMAIN,example.com,DIRECT
  - MATCH,Final
"#,
        )
        .expect("source yaml");
        let patched = patch_config_with_settings(source, &settings, Some("test")).expect("patch");
        let rules = yaml_sequence(&patched, "rules").expect("rules");
        assert_eq!(
            rules[0].as_str(),
            Some("DOMAIN,api.ipify.org,Aegos Landing IP")
        );
        assert!(
            rules
                .iter()
                .position(|rule| rule.as_str() == Some("MATCH,Final"))
                .unwrap()
                > OUTBOUND_IP_RULE_DOMAINS.len()
        );
        let groups = yaml_sequence(&patched, "proxy-groups").expect("groups");
        let lookup_group = groups
            .iter()
            .find(|group| yaml_mapping_name(group) == Some(AEGOS_OUTBOUND_IP_GROUP))
            .expect("lookup group");
        let lookup_proxies = lookup_group
            .get(yaml_key("proxies"))
            .and_then(|value| value.as_sequence())
            .expect("lookup proxies");
        assert_eq!(lookup_proxies[0].as_str(), Some("Node A"));
    }

    #[test]
    fn operation_queue_is_exclusive() {
        let operations = Arc::new(Mutex::new(()));
        let guard = lock_operation_queue(&operations, "test").expect("queue lock");
        assert!(operations.try_lock().is_err());
        drop(guard);
        assert!(operations.try_lock().is_ok());
    }

    #[test]
    fn running_switch_preflight_accepts_two_local_profiles() {
        let mut settings = default_settings();
        settings.secret = "test".to_string();
        let profile_a = Profile {
            id: "local-a".to_string(),
            name: "Local A".to_string(),
            profile_type: "local".to_string(),
            path: "a.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "test".to_string(),
            digest: "a".to_string(),
        };
        let profile_b = Profile {
            id: "local-b".to_string(),
            name: "Local B".to_string(),
            profile_type: "local".to_string(),
            path: "b.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 2,
            updated_at: "test".to_string(),
            digest: "b".to_string(),
        };
        let yaml_a: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
external-controller: 127.0.0.1:19091
secret: test
proxies:
  - name: A
    type: ss
    server: a.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - A
      - DIRECT
rules:
  - MATCH,Proxy
"#,
        )
        .expect("yaml a");
        let yaml_b: YamlValue = serde_yaml::from_str(
            r#"
mixed-port: 7891
external-controller: 127.0.0.1:19091
secret: test
proxies:
  - name: B
    type: ss
    server: b.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Auto
    type: url-test
    proxies:
      - B
  - name: Proxy
    type: select
    proxies:
      - Auto
      - DIRECT
rules:
  - MATCH,Proxy
"#,
        )
        .expect("yaml b");

        preflight_runtime_config(&yaml_a, &profile_a, &settings)
            .expect("profile a should preflight");
        preflight_runtime_config(&yaml_b, &profile_b, &settings)
            .expect("profile b should preflight with group reference");
    }

    #[test]
    fn node_health_tracks_success_failure_and_cooldown() {
        let first = update_node_health(None, "HK 02", "trojan", 48, "", 100);
        assert_eq!(first.status, "low");
        assert_eq!(first.confidence, "high");
        assert_eq!(first.failure_streak, 0);
        assert!(first.score < 100);

        let failed_once = update_node_health(Some(&first), "HK 02", "trojan", -1, "timeout", 110);
        assert_eq!(failed_once.failure_streak, 1);
        assert_eq!(failed_once.status, "unstable");
        assert_eq!(failed_once.confidence, "low");
        assert_eq!(failed_once.last_failure_reason, "timeout");

        let failed_twice =
            update_node_health(Some(&failed_once), "HK 02", "trojan", -1, "dns", 120);
        assert_eq!(failed_twice.failure_streak, 2);
        assert!(failed_twice.cooldown_until > 120);
        assert_eq!(failed_twice.status, "cooldown");
        assert_eq!(failed_twice.confidence, "cooldown");
        assert_eq!(failed_twice.last_failure_reason, "dns");
    }

    #[test]
    fn delay_failure_reason_keeps_more_actionable_errors() {
        let mut reason = String::new();
        merge_delay_failure_reason(&mut reason, "timeout");
        assert_eq!(reason, "timeout");

        merge_delay_failure_reason(&mut reason, "network");
        assert_eq!(reason, "network");

        merge_delay_failure_reason(&mut reason, "dns");
        assert_eq!(reason, "dns");

        merge_delay_failure_reason(&mut reason, "auth");
        assert_eq!(reason, "auth");

        merge_delay_failure_reason(&mut reason, "timeout");
        assert_eq!(reason, "auth");
    }

    #[test]
    fn speed_result_confidence_tracks_fresh_stale_and_failed_results() {
        assert_eq!(speed_result_confidence(42, 0, 100, 100, 0, 120), "high");
        assert_eq!(speed_result_confidence(42, 0, 100, 100, 0, 900), "medium");
        assert_eq!(speed_result_confidence(42, 0, 100, 100, 0, 2000), "stale");
        assert_eq!(speed_result_confidence(-1, 1, 0, 200, 0, 201), "failed");
        assert_eq!(
            speed_result_confidence(-1, 2, 100, 220, 400, 230),
            "cooldown"
        );
    }

    #[test]
    fn recovery_suggestions_rank_same_region_and_fresh_results() {
        assert_eq!(infer_node_region("HK Premium 01"), "HK");
        assert_eq!(infer_node_region("\u{65e5}\u{672c} Tokyo"), "JP");
        assert!(recovery_confidence_rank("high") < recovery_confidence_rank("stale"));
        assert!(recovery_confidence_rank("medium") < recovery_confidence_rank("failed"));
    }

    #[test]
    fn log_category_keeps_user_core_diagnostic_and_debug_streams_distinct() {
        assert_eq!(log_category("core", "mihomo ready"), "core");
        assert_eq!(
            log_category("warn", "Profile preflight failed"),
            "diagnostic"
        );
        assert_eq!(log_category("info", "Selected best proxy"), "user");
        assert_eq!(log_category("debug", "raw controller payload"), "debug");
        assert_eq!(log_category("info", "heartbeat"), "runtime");
    }

    #[test]
    fn log_sanitizer_redacts_subscription_and_node_secrets() {
        let line = "update failed https://train.example/api/linkon?token=fixture-token-redacted&protocol=vless password: secret uuid=00000000-0000-4000-8000-000000000000 bearer abc.def trojan://pass@example.com:443 path C:\\Users\\JIE\\AppData\\Roaming\\com.codex.aegos\\settings.json lan 192.168.31.8 cgnat 100.64.1.2 public 8.8.8.8";
        let sanitized = sanitize_sensitive_text(line);

        assert!(sanitized.contains("token=[redacted]"));
        assert!(sanitized.contains("password: [redacted]"));
        assert!(sanitized.contains("uuid=[redacted]"));
        assert!(sanitized.contains("bearer [redacted]"));
        assert!(sanitized.contains("trojan://[redacted]@example.com:443"));
        assert!(sanitized.contains("path [local-path]"));
        assert!(sanitized.contains("lan [private-ip]"));
        assert!(sanitized.contains("cgnat [private-ip]"));
        assert!(sanitized.contains("public 8.8.8.8"));
        assert!(!sanitized.contains("fixture-token-redacted"));
        assert!(!sanitized.contains("00000000-0000-4000-8000-000000000000"));
        assert!(!sanitized.contains("abc.def"));
        assert!(!sanitized.contains("C:\\Users\\JIE"));
        assert!(!sanitized.contains("192.168.31.8"));
        assert!(!sanitized.contains("100.64.1.2"));
    }

    #[test]
    fn node_log_matching_finds_related_failures() {
        let entry = LogEntry {
            at: "test".to_string(),
            level: "warn".to_string(),
            category: "core".to_string(),
            line: "dial HK Premium 01 error: i/o timeout".to_string(),
        };
        assert!(log_matches_node(&entry, "HK Premium 01"));
        assert!(!log_matches_node(&entry, "JP Premium 01"));
        assert!(!log_matches_node(&entry, ""));
    }

    #[test]
    fn speed_test_phases_prioritize_fast_non_tuic_targets() {
        let targets = vec![
            SpeedTestTarget {
                name: "TUIC".to_string(),
                select_name: "TUIC".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "tuic".to_string(),
                server: "tuic.example.com".to_string(),
            },
            SpeedTestTarget {
                name: "Trojan".to_string(),
                select_name: "Trojan".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "trojan".to_string(),
                server: "trojan.example.com".to_string(),
            },
        ];
        let phases = speed_test_phases(targets, &HashMap::new(), 1);
        assert_eq!(phases.first().unwrap().0[0].name, "Trojan");
        assert!(phases
            .first()
            .unwrap()
            .0
            .iter()
            .any(|item| item.name == "TUIC"));
    }

    #[test]
    fn protocol_scheduler_handles_reality_hysteria2_and_tuic_explicitly() {
        assert_eq!(protocol_family("vless-reality"), "reality");
        assert_eq!(protocol_family("hysteria2"), "hysteria");
        assert_eq!(protocol_family("hy2"), "hysteria");
        assert_eq!(protocol_family("anytls"), "anytls");
        assert_eq!(protocol_family("ss-obfs"), "ss-obfs");
        assert_eq!(protocol_concurrency("vless-reality"), 32);
        assert_eq!(protocol_concurrency("hysteria2"), 10);
        assert_eq!(protocol_concurrency("anytls"), 16);
        assert_eq!(protocol_concurrency("tuic"), 8);
        assert_eq!(protocol_concurrency("ss-obfs"), 12);
        assert_eq!(protocol_primary_timeout_ms("vless-reality"), 5000);
        assert_eq!(protocol_primary_timeout_ms("hysteria2"), 5000);
        assert_eq!(protocol_primary_timeout_ms("anytls"), 5000);
        assert_eq!(protocol_primary_timeout_ms("tuic"), 5000);
        let fast_tuic_probes = delay_probe_plan("tuic", DelayProbeDepth::Fast);
        assert_eq!(fast_tuic_probes.len(), 1);
        assert_eq!(
            fast_tuic_probes[0].url,
            "https://www.gstatic.com/generate_204"
        );
        assert_eq!(fast_tuic_probes[0].timeout_ms, 5000);
        let fast_anytls_probes = delay_probe_plan("anytls", DelayProbeDepth::Fast);
        assert_eq!(fast_anytls_probes.len(), 1);
        assert_eq!(
            fast_anytls_probes[0].url,
            "https://www.gstatic.com/generate_204"
        );
        let tuic_probes = delay_probe_plan("tuic", DelayProbeDepth::Full);
        assert_eq!(tuic_probes[0].url, "http://www.gstatic.com/generate_204");
        assert!(tuic_probes
            .iter()
            .any(|probe| probe.url == "https://cp.cloudflare.com/generate_204"));
        assert!(tuic_probes.iter().all(|probe| probe.timeout_ms == 5000));
        let trojan_fast_probes = delay_probe_plan("trojan", DelayProbeDepth::Fast);
        assert_eq!(trojan_fast_probes[0].timeout_ms, 5000);
        let ss_obfs_fast_probes = delay_probe_plan("ss-obfs", DelayProbeDepth::Fast);
        assert_eq!(
            ss_obfs_fast_probes[0].url,
            "https://www.gstatic.com/generate_204"
        );
        assert_eq!(ss_obfs_fast_probes[0].timeout_ms, 5000);

        let targets = vec![
            SpeedTestTarget {
                name: "Hysteria2".to_string(),
                select_name: "Hysteria2".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "hysteria2".to_string(),
                server: "hy2.example.com".to_string(),
            },
            SpeedTestTarget {
                name: "Reality".to_string(),
                select_name: "Reality".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "vless-reality".to_string(),
                server: "reality.example.com".to_string(),
            },
            SpeedTestTarget {
                name: "TUIC".to_string(),
                select_name: "TUIC".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "tuic".to_string(),
                server: "tuic.example.com".to_string(),
            },
            SpeedTestTarget {
                name: "SS Obfs".to_string(),
                select_name: "SS Obfs".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "ss-obfs".to_string(),
                server: "ss.example.com".to_string(),
            },
        ];
        let phases = speed_test_phases(targets, &HashMap::new(), 1);
        assert_eq!(phases.first().unwrap().0[0].name, "Reality");
        let phase_names = phases
            .iter()
            .flat_map(|phase| phase.0.iter())
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        assert!(phase_names.contains(&"Hysteria2"));
        assert!(phase_names.contains(&"TUIC"));
        assert!(phase_names.contains(&"SS Obfs"));
    }

    #[test]
    fn ss_uri_preserves_obfs_plugin_options() {
        let node = parse_ss_uri(
            "ss://aes-128-gcm:secret@example.com:10015?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dedge.example.com#HK%20SS",
            1,
        )
        .expect("ss uri should parse");
        let map = node.as_mapping().expect("node map");
        assert_eq!(
            map.get(yaml_key("plugin")).and_then(YamlValue::as_str),
            Some("obfs")
        );
        let opts = map
            .get(yaml_key("plugin-opts"))
            .and_then(YamlValue::as_mapping)
            .expect("plugin opts");
        assert_eq!(
            opts.get(yaml_key("mode")).and_then(YamlValue::as_str),
            Some("http")
        );
        assert_eq!(
            opts.get(yaml_key("host")).and_then(YamlValue::as_str),
            Some("edge.example.com")
        );
        let item = yaml_proxy_to_json(&node).expect("proxy item");
        assert_eq!(
            item.get("speedProtocol").and_then(JsonValue::as_str),
            Some("ss-obfs")
        );
    }

    #[test]
    fn recommendation_requires_sub_100ms_available_node() {
        let targets = vec![
            SpeedTestTarget {
                name: "Fast".to_string(),
                select_name: "Fast".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "trojan".to_string(),
                server: "fast.example.com".to_string(),
            },
            SpeedTestTarget {
                name: "Slow".to_string(),
                select_name: "Slow".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "ss".to_string(),
                server: "slow.example.com".to_string(),
            },
        ];
        let mut health = HashMap::new();
        health.insert(
            "Fast".to_string(),
            update_node_health(None, "Fast", "trojan", 48, "", 100),
        );
        health.insert(
            "Slow".to_string(),
            update_node_health(None, "Slow", "ss", 120, "", 100),
        );
        let best = speed_recommendation(&targets, &health, 100).expect("best candidate");
        assert_eq!(best.get("proxy").and_then(JsonValue::as_str), Some("Fast"));
        assert_eq!(low_latency_names(&health, 100), vec!["Fast".to_string()]);
    }
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
        mixed_port: AEGOS_DEFAULT_MIXED_PORT,
        controller_port: AEGOS_DEFAULT_CONTROLLER_PORT,
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
        reliability_auto: default_reliability_auto(),
        reliability_profile_failover: default_reliability_profile_failover(),
        reliability_failure_threshold: default_reliability_failure_threshold(),
        reliability_max_delay_ms: default_reliability_max_delay_ms(),
        reliability_candidate_limit: default_reliability_candidate_limit(),
        selected_proxy_map: HashMap::new(),
        manual_nodes: HashMap::new(),
        profiles: Vec::new(),
    }
}

fn load_settings(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(default_settings)
}

fn save_json<T: Serialize>(path: &Path, root: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    atomic_write_text_confined(path, root, &raw)
}

fn is_port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn port_owner_detail(port: u16) -> String {
    run_powershell(&format!(
        r#"
$items = Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue |
  Select-Object -First 3 LocalAddress,LocalPort,State,OwningProcess
if (-not $items) {{ 'free'; exit 0 }}
$items | ForEach-Object {{
  $name = try {{ (Get-Process -Id $_.OwningProcess -ErrorAction Stop).ProcessName }} catch {{ 'unknown' }}
  "$($_.LocalAddress):$($_.LocalPort) $($_.State) pid=$($_.OwningProcess) process=$name"
}} | Out-String
"#
    ))
    .map(|output| {
        let text = output.trim();
        if text.is_empty() {
            "occupied".to_string()
        } else {
            text.to_string()
        }
    })
    .unwrap_or_else(|_| {
        if is_port_free(port) {
            "free".to_string()
        } else {
            "occupied; owner lookup unavailable".to_string()
        }
    })
}

fn find_free_port(current: u16, fallback: u16, reserved: &[u16]) -> Result<u16, String> {
    if !reserved.contains(&current) && is_port_free(current) {
        return Ok(current);
    }
    for port in fallback..fallback + 80 {
        if !reserved.contains(&port) && is_port_free(port) {
            return Ok(port);
        }
    }
    Err(format!("鏈壘鍒板彲鐢ㄧ鍙? {fallback}-{}", fallback + 79))
}

fn builtin_proxy_item(name: &str) -> JsonValue {
    json!({
        "name": name,
        "server": name,
        "type": name,
        "alive": true,
        "delay": -1,
        "builtin": true
    })
}

fn proxy_speed_protocol(protocol: &str, map: &Mapping) -> String {
    let normalized = core_runtime::normalize_proxy_type(protocol);
    if normalized == "ss" {
        if let Some(plugin) = map
            .get(yaml_key("plugin"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
        {
            if plugin.contains("obfs") {
                return "ss-obfs".to_string();
            }
            return format!("ss-{plugin}");
        }
    }
    normalized
}

fn yaml_proxy_to_json(proxy: &YamlValue) -> Option<JsonValue> {
    let map = proxy.as_mapping()?;
    let name = map
        .get(yaml_key("name"))
        .and_then(|value| value.as_str())
        .unwrap_or("Proxy");
    if is_subscription_metadata_node_name(name) {
        return None;
    }
    let server = map
        .get(yaml_key("server"))
        .and_then(|value| value.as_str())
        .unwrap_or(name);
    if is_fake_ip_address(server) {
        return None;
    }
    let protocol = map
        .get(yaml_key("type"))
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let speed_protocol = proxy_speed_protocol(protocol, map);
    Some(json!({
        "name": name,
        "server": server,
        "type": protocol,
        "speedProtocol": speed_protocol,
        "alive": true,
        "delay": -1
    }))
}

fn is_proxy_group_reference_item(item: &JsonValue) -> bool {
    item.get("group")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false)
        || item
            .get("isGroup")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false)
        || item
            .get("type")
            .or_else(|| item.get("protocol"))
            .and_then(JsonValue::as_str)
            .map(|value| value.eq_ignore_ascii_case("group"))
            .unwrap_or(false)
}

fn validate_proxy_selection_from_groups(
    groups: &JsonValue,
    group: &str,
    proxy: &str,
) -> Result<JsonValue, String> {
    let group = group.trim();
    let proxy = proxy.trim();
    if group.is_empty() {
        return Err("Node switch preflight failed: missing proxy group".to_string());
    }
    if proxy.is_empty() {
        return Err("Node switch preflight failed: missing proxy name".to_string());
    }
    let groups = groups.as_array().ok_or_else(|| {
        "Node switch preflight failed: proxy group list is unavailable".to_string()
    })?;
    let Some(target_group) = groups
        .iter()
        .find(|item| item.get("name").and_then(JsonValue::as_str) == Some(group))
    else {
        let available = groups
            .iter()
            .filter_map(|item| item.get("name").and_then(JsonValue::as_str))
            .take(8)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Node switch preflight failed: group '{group}' was not found. Available groups: {available}"
        ));
    };
    let items = target_group
        .get("items")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| format!("Node switch preflight failed: group '{group}' has no node list"))?;
    let Some(target_proxy) = items.iter().find(|item| {
        item.get("name").and_then(JsonValue::as_str) == Some(proxy)
            || item.get("realProxyName").and_then(JsonValue::as_str) == Some(proxy)
    }) else {
        let available = items
            .iter()
            .filter_map(|item| item.get("name").and_then(JsonValue::as_str))
            .take(8)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Node switch preflight failed: proxy '{proxy}' is not in group '{group}'. Available nodes: {available}"
        ));
    };
    Ok(json!({
        "ok": true,
        "group": group,
        "proxy": proxy,
        "groupType": target_group.get("type").and_then(JsonValue::as_str).unwrap_or(""),
        "realProxyName": target_proxy
            .get("realProxyName")
            .and_then(JsonValue::as_str)
            .or_else(|| target_proxy.get("name").and_then(JsonValue::as_str))
            .unwrap_or(proxy)
    }))
}

fn run_powershell(script: &str) -> Result<String, String> {
    let wrapped_script = format!(
        "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8;\n{script}"
    );
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &wrapped_script,
    ]);
    #[cfg(windows)]
    command.creation_flags(core_runtime::CREATE_NO_WINDOW);
    let output = command.output().map_err(|err| err.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn is_process_elevated() -> bool {
    static IS_ELEVATED: OnceLock<bool> = OnceLock::new();
    *IS_ELEVATED.get_or_init(|| {
        run_powershell(
            r#"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'true' } else { 'false' }
"#,
        )
        .map(|output| output.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    })
}

#[cfg(windows)]
fn detect_windows_primary_interface_name() -> Option<String> {
    static INTERFACE_NAME: OnceLock<String> = OnceLock::new();
    if let Some(name) = INTERFACE_NAME.get() {
        return Some(name.clone());
    }
    let detected = run_powershell(
        r#"
$deny = '(?i)(flclash|clash|mihomo|aegos|tun|tap|wintun|wireguard|loopback|virtual|vmware|hyper-v|tailscale|zerotier|docker)'
$routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
  Sort-Object RouteMetric, InterfaceMetric
foreach ($route in $routes) {
  $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
  if (-not $adapter) { continue }
  $text = "$($adapter.Name) $($adapter.InterfaceDescription)"
  if ($adapter.Status -ne 'Up') { continue }
  if ($text -match $deny) { continue }
  if ($adapter.Name) { $adapter.Name; exit 0 }
}
foreach ($route in $routes) {
  $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
  if ($adapter -and $adapter.Status -eq 'Up' -and $adapter.Name) { $adapter.Name; exit 0 }
}
"#,
    )
    .ok()
    .and_then(|output| {
        output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(|line| line.to_string())
    });
    if let Some(name) = detected.as_ref() {
        let _ = INTERFACE_NAME.set(name.clone());
    }
    detected
}

#[cfg(not(windows))]
fn detect_windows_primary_interface_name() -> Option<String> {
    None
}

fn is_private_lan_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            let [first, second, _, _] = value.octets();
            first == 10
                || (first == 172 && (16..=31).contains(&second))
                || (first == 192 && second == 168)
        }
        IpAddr::V6(value) => (value.segments()[0] & 0xfe00) == 0xfc00,
    }
}

fn is_usable_lan_ip(ip: IpAddr) -> bool {
    !(ip.is_loopback() || ip.is_unspecified() || ip.is_multicast()) && is_private_lan_ip(ip)
}

fn parse_usable_lan_ip(value: &str) -> Option<String> {
    let ip = value.trim().parse::<IpAddr>().ok()?;
    if is_usable_lan_ip(ip) {
        Some(ip.to_string())
    } else {
        None
    }
}

fn route_lan_ip() -> Option<String> {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            let _ = socket.connect("8.8.8.8:80");
            socket.local_addr()
        })
        .ok()
        .and_then(|addr| parse_usable_lan_ip(&addr.ip().to_string()))
}

#[cfg(windows)]
fn windows_active_lan_ip() -> Option<String> {
    let output = run_powershell(
        r#"
$privatePattern = '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)'
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -match $privatePattern -and
    $_.IPAddress -ne '127.0.0.1' -and
    $_.AddressState -eq 'Preferred' -and
    -not $_.SkipAsSource
  } |
  Sort-Object -Property InterfaceIndex |
  Select-Object -First 1 -ExpandProperty IPAddress
"#,
    )
    .ok()?;
    output.lines().find_map(parse_usable_lan_ip)
}

#[cfg(not(windows))]
fn windows_active_lan_ip() -> Option<String> {
    None
}

fn primary_lan_ip() -> String {
    route_lan_ip()
        .or_else(windows_active_lan_ip)
        .unwrap_or_else(|| "-".to_string())
}

fn read_windows_proxy_snapshot() -> Result<core_runtime::SystemProxySnapshot, String> {
    let output = run_powershell(
        r#"
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$item = Get-ItemProperty -Path $path
[pscustomobject]@{
  proxy_enable = [bool]$item.ProxyEnable
  proxy_server = [string]$item.ProxyServer
  proxy_override = [string]$item.ProxyOverride
  captured_at = (Get-Date).ToString('o')
} | ConvertTo-Json -Compress
"#,
    )?;
    serde_json::from_str(&output)
        .map_err(|err| format!("Windows proxy snapshot parse failed: {err}"))
}

fn write_windows_proxy_snapshot(
    snapshot: &core_runtime::SystemProxySnapshot,
) -> Result<(), String> {
    let plan = core_runtime::windows_proxy_snapshot_script_plan(snapshot);
    let enable = plan.proxy_enable_value;
    let server = plan.proxy_server_literal.as_deref().unwrap_or("''");
    let override_value = plan.proxy_override_literal;
    run_powershell(&format!(
        r#"
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value {enable}
Set-ItemProperty -Path $path -Name ProxyServer -Type String -Value {server}
Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value {override_value}
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
    ))?;
    Ok(())
}

fn build_proxy_script(enable: bool, mixed_port: u16) -> String {
    let plan = core_runtime::windows_proxy_takeover_script_plan(enable, mixed_port);
    let flag = plan.proxy_enable_value;
    let set_server = if plan.should_write_proxy_server() {
        let server = plan.proxy_server_literal.as_deref().unwrap_or("''");
        format!("Set-ItemProperty -Path $path -Name ProxyServer -Type String -Value {server}")
    } else {
        String::new()
    };
    let proxy_override = plan.proxy_override_literal;
    format!(
        r#"
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value {flag}
{set_server}
Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value {proxy_override}
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
    let plan = core_runtime::CoreFirewallPolicyPlan::disconnect_protection();
    let group = plan.group_name;
    let snapshot = plan.state_path(user_data);
    let exe = std::env::current_exe().unwrap_or_default();
    let programs = core_runtime::firewall_program_paths([exe, core_path.to_path_buf()]);
    let program_array = core_runtime::powershell_string_array_literal(&programs);
    if enable {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{ throw 'Disconnect protection requires administrator permission' }}
$snapshotPath = '{}'
$group = '{}'
$rulePrefix = "$group Allow"
$programs = {}
$dnsServiceHost = Join-Path $env:SystemRoot 'System32\svchost.exe'
function Invoke-AegosNetsh {{
  $output = & netsh @args 2>&1
  if ($LASTEXITCODE -ne 0) {{
    $message = ($output | Out-String).Trim()
    if (-not $message) {{ $message = "netsh failed with exit code $LASTEXITCODE" }}
    throw $message
  }}
  return ($output | Out-String).Trim()
}}
if ($programs.Count -lt 1) {{ throw 'No Aegos executable paths are available for firewall allow rules' }}
New-Item -ItemType Directory -Path (Split-Path -Parent $snapshotPath) -Force | Out-Null
if (-not (Test-Path -LiteralPath $snapshotPath)) {{
  Get-NetFirewallProfile | Select-Object Name,DefaultOutboundAction | ConvertTo-Json | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
}}
try {{
  Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  $index = 1
  foreach ($program in $programs) {{
    if (-not (Test-Path -LiteralPath $program)) {{ throw "Firewall allow target missing: $program" }}
    Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix $index" dir=out action=allow "program=$program" enable=yes profile=any | Out-Null
    $index += 1
  }}
  if (Test-Path -LiteralPath $dnsServiceHost) {{
    Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS UDP" dir=out action=allow "program=$dnsServiceHost" service=Dnscache protocol=UDP remoteport=53 enable=yes profile=any | Out-Null
    Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS TCP" dir=out action=allow "program=$dnsServiceHost" service=Dnscache protocol=TCP remoteport=53 enable=yes profile=any | Out-Null
  }}
  Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS Any UDP" dir=out action=allow protocol=UDP remoteport=53 enable=yes profile=any | Out-Null
  Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS Any TCP" dir=out action=allow protocol=TCP remoteport=53 enable=yes profile=any | Out-Null
  Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block
  $rules = @(Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Where-Object {{ $_.Direction -eq 'Outbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' }})
  if ($rules.Count -lt 1) {{ throw 'Disconnect protection did not create Aegos allow rules' }}
  $badProfiles = @(Get-NetFirewallProfile | Where-Object {{ $_.DefaultOutboundAction -ne 'Block' }})
  if ($badProfiles.Count -gt 0) {{ throw 'Disconnect protection did not block direct outbound traffic' }}
}} catch {{
  $failure = $_.Exception.Message
  try {{
    if (Test-Path -LiteralPath $snapshotPath) {{
      $profiles = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
      foreach ($profile in @($profiles)) {{
        Set-NetFirewallProfile -Profile $profile.Name -DefaultOutboundAction $profile.DefaultOutboundAction
      }}
      Remove-Item -LiteralPath $snapshotPath -Force
    }} else {{
      Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Allow
    }}
    Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }} catch {{}}
  throw "Disconnect protection enable failed: $failure"
}}
"#,
            core_runtime::powershell_single_quote_escape(snapshot.to_string_lossy()),
            core_runtime::powershell_single_quote_escape(&group),
            program_array
        )
    } else {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
trap {{ throw "Disconnect protection disable failed: $($_.Exception.Message)" }}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{ throw 'Disabling disconnect protection requires administrator permission' }}
$snapshotPath = '{}'
$group = '{}'
$rulePrefix = "$group Allow"
function Invoke-AegosNetsh {{
  $output = & netsh @args 2>&1
  if ($LASTEXITCODE -ne 0) {{
    $message = ($output | Out-String).Trim()
    if (-not $message) {{ $message = "netsh failed with exit code $LASTEXITCODE" }}
    throw $message
  }}
  return ($output | Out-String).Trim()
}}
if (Test-Path -LiteralPath $snapshotPath) {{
  $profiles = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
  foreach ($profile in @($profiles)) {{
    Set-NetFirewallProfile -Profile $profile.Name -DefaultOutboundAction $profile.DefaultOutboundAction
  }}
  Remove-Item -LiteralPath $snapshotPath -Force
}} else {{
  Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Allow
}}
Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$rules = @(Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue)
if ($rules.Count -gt 0) {{ throw 'Disconnect protection rules were not fully removed' }}
"#,
            core_runtime::powershell_single_quote_escape(snapshot.to_string_lossy()),
            core_runtime::powershell_single_quote_escape(&group)
        )
    }
}

fn build_speed_test_firewall_script(
    enable: bool,
    user_data: &Path,
    core_path: &Path,
    ports: &[u16],
) -> String {
    let plan = core_runtime::CoreFirewallPolicyPlan::speed_test();
    let group = plan.group_name;
    let exe = std::env::current_exe().unwrap_or_default();
    let programs = core_runtime::firewall_program_paths([exe, core_path.to_path_buf()]);
    let program_array = core_runtime::powershell_string_array_literal(&programs);
    let port_list = core_runtime::firewall_remote_port_list(ports);
    let marker = plan.state_path(user_data);
    if enable {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{ throw 'Speed test firewall rules require administrator permission' }}
$markerPath = '{}'
$group = '{}'
$rulePrefix = "$group Allow"
$programs = {}
$portList = '{}'
function Invoke-AegosNetsh {{
  $output = & netsh @args 2>&1
  if ($LASTEXITCODE -ne 0) {{
    $message = ($output | Out-String).Trim()
    if (-not $message) {{ $message = "netsh failed with exit code $LASTEXITCODE" }}
    throw $message
  }}
  return ($output | Out-String).Trim()
}}
New-Item -ItemType Directory -Path (Split-Path -Parent $markerPath) -Force | Out-Null
try {{
  Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if ($programs.Count -lt 1) {{ throw 'No Aegos executable paths are available for speed-test firewall allow rules' }}
  $index = 1
  foreach ($program in $programs) {{
    if (-not (Test-Path -LiteralPath $program)) {{ throw "Speed-test firewall allow target missing: $program" }}
    Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix Program $index" dir=out action=allow "program=$program" enable=yes profile=any | Out-Null
    $index += 1
  }}
  Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS UDP" dir=out action=allow protocol=UDP remoteport=53 enable=yes profile=any | Out-Null
  Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS TCP" dir=out action=allow protocol=TCP remoteport=53 enable=yes profile=any | Out-Null
  if ($portList) {{
    Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix Node TCP" dir=out action=allow protocol=TCP remoteport=$portList enable=yes profile=any | Out-Null
    Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix Node UDP" dir=out action=allow protocol=UDP remoteport=$portList enable=yes profile=any | Out-Null
  }}
  $rules = @(Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Where-Object {{ $_.Direction -eq 'Outbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' }})
  if ($rules.Count -lt 3) {{ throw 'Speed-test firewall did not create the required temporary allow rules' }}
  Set-Content -LiteralPath $markerPath -Value (Get-Date).ToString('o') -Encoding UTF8
}} catch {{
  $failure = $_.Exception.Message
  try {{
    Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (Test-Path -LiteralPath $markerPath) {{ Remove-Item -LiteralPath $markerPath -Force }}
  }} catch {{}}
  throw "Speed test firewall enable failed: $failure"
}}
"#,
            core_runtime::powershell_single_quote_escape(marker.to_string_lossy()),
            core_runtime::powershell_single_quote_escape(&group),
            program_array,
            core_runtime::powershell_single_quote_escape(port_list)
        )
    } else {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
$group = '{}'
$rulePrefix = "$group Allow"
$markerPath = '{}'
Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if (Test-Path -LiteralPath $markerPath) {{ Remove-Item -LiteralPath $markerPath -Force }}
$rules = @(Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue)
if ($rules.Count -gt 0) {{ throw 'Speed test firewall rules were not fully removed' }}
if (Test-Path -LiteralPath $markerPath) {{ throw 'Speed test firewall marker was not removed' }}
"#,
            core_runtime::powershell_single_quote_escape(&group),
            core_runtime::powershell_single_quote_escape(marker.to_string_lossy())
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
        let current_dir = std::env::current_dir().unwrap_or_default();
        let core_path = core_runtime::resolve_core_path(&resource_dir, &current_dir);
        let home_dir = app_data.join("core-home");
        let profile_dir = app_data.join("profiles");
        let settings_path = app_data.join("settings.json");
        let proxy_snapshot_path = app_data.join("system-proxy-snapshot.json");
        ensure_dir(&home_dir)?;
        ensure_dir(&profile_dir)?;
        let settings = load_settings(&settings_path);
        let mut manager = Self {
            app_data,
            home_dir,
            profile_dir,
            core_path,
            core_sha256: String::new(),
            settings_path,
            proxy_snapshot_path,
            settings,
            process: None,
            runtime_profile_id: None,
            runtime_config_digest: None,
            traffic_takeover: false,
            logs: Arc::new(Mutex::new(Vec::new())),
            last_traffic: json!({ "up": 0, "down": 0, "upTotal": 0, "downTotal": 0 }),
            speed_test: Arc::new(Mutex::new(SpeedTestState::default())),
            lan_ip_cache: "-".to_string(),
            lan_ip_checked_at: 0,
            outbound_ip_cache: "-".to_string(),
            outbound_ip_checked_at: 0,
            outbound_ip_query_generation: 0,
            reliability_failures: 0,
        };
        manager.core_sha256 = if manager.core_path.exists() {
            sha256_file(&manager.core_path)
        } else {
            String::new()
        };
        manager.ensure_direct_profile()?;
        manager.repair_profile_metadata();
        manager.save_settings()?;
        Ok(manager)
    }

    fn add_log(&self, line: impl AsRef<str>, level: &str) {
        let line = sanitize_sensitive_text(line.as_ref());
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let mut logs = self.logs.lock().unwrap();
        logs.push(LogEntry {
            at: now_iso(),
            level: level.to_string(),
            category: log_category(level, line).to_string(),
            line: line.to_string(),
        });
        if logs.len() > 700 {
            logs.remove(0);
        }
    }

    fn save_settings(&self) -> Result<(), String> {
        save_json(&self.settings_path, &self.app_data, &self.settings)
    }

    fn save_system_proxy_snapshot(
        &self,
        snapshot: &core_runtime::SystemProxySnapshot,
    ) -> Result<(), String> {
        save_json(&self.proxy_snapshot_path, &self.app_data, snapshot)
    }

    fn load_system_proxy_snapshot(&self) -> Option<core_runtime::SystemProxySnapshot> {
        fs::read_to_string(&self.proxy_snapshot_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
    }

    fn core_runtime_info(&self) -> JsonValue {
        core_runtime::CoreRuntimeContract::default()
            .identity_json(&self.core_runtime_paths(), &self.core_sha256)
    }

    fn core_runtime_paths(&self) -> core_runtime::CoreRuntimePaths {
        core_runtime::CoreRuntimePaths {
            core_path: self.core_path.clone(),
            home_dir: self.home_dir.clone(),
            runtime_profile_path: self.runtime_profile_path(),
        }
    }

    fn core_controller(&self) -> core_runtime::CoreController {
        core_runtime::CoreController::new(
            self.settings.controller_port,
            self.settings.secret.clone(),
        )
    }

    fn clear_system_proxy_snapshot(&self) {
        let _ = remove_file_confined(&self.proxy_snapshot_path, &self.app_data);
    }

    fn capture_proxy_snapshot_before_takeover(&self) -> Result<(), String> {
        let snapshot_file_exists = self.proxy_snapshot_path.exists();
        if snapshot_file_exists {
            return Ok(());
        }
        let snapshot = read_windows_proxy_snapshot()?;
        if core_runtime::should_capture_system_proxy_snapshot(
            snapshot_file_exists,
            &snapshot,
            self.settings.mixed_port,
        ) {
            self.save_system_proxy_snapshot(&snapshot)?;
        }
        Ok(())
    }

    fn verify_system_proxy_points_to_aegos(&self, expected: bool) -> Result<(), String> {
        let current = read_windows_proxy_snapshot()?;
        core_runtime::verify_system_proxy_snapshot(&current, expected, self.settings.mixed_port)
    }

    fn ensure_direct_profile(&mut self) -> Result<(), String> {
        let path = self.profile_dir.join("direct.yaml");
        let config = config_pipeline::patch_direct_profile(&self.settings)?;
        atomic_write_text_confined(
            &path,
            &self.profile_dir,
            &serde_yaml::to_string(&config).map_err(|err| err.to_string())?,
        )?;
        if !self.settings.profiles.iter().any(|p| p.id == "direct") {
            self.settings.profiles.insert(
                0,
                Profile {
                    id: "direct".to_string(),
                    name: "鐩磋繛璇婃柇閰嶇疆".to_string(),
                    profile_type: "builtin".to_string(),
                    path: path.to_string_lossy().to_string(),
                    source_url: None,
                    node_count: 0,
                    proxy_group_count: 0,
                    updated_at: now_iso(),
                    digest: sha256_file(&path),
                },
            );
        }
        Ok(())
    }

    fn repair_profile_metadata(&mut self) -> usize {
        let mut repaired = Vec::new();
        let mut failed = Vec::new();
        for profile in &mut self.settings.profiles {
            if !should_repair_profile_metadata(profile) {
                continue;
            }
            match profile_file_summary(profile) {
                Ok(summary) => {
                    let changed = profile.node_count != summary.proxies
                        || profile.proxy_group_count != summary.proxy_groups;
                    if changed {
                        profile.node_count = summary.proxies;
                        profile.proxy_group_count = summary.proxy_groups;
                        repaired.push(format!(
                            "{}: {} nodes / {} groups",
                            profile.name, summary.proxies, summary.proxy_groups
                        ));
                    }
                }
                Err(err) => failed.push(format!("{}: {err}", profile.name)),
            }
        }
        for line in &repaired {
            self.add_log(
                format!("Profile metadata repaired from file: {line}"),
                "info",
            );
        }
        for line in failed {
            self.add_log(format!("Profile metadata repair skipped: {line}"), "warn");
        }
        repaired.len()
    }

    fn validate_port_settings_snapshot(settings: &Settings) -> Result<(), String> {
        core_runtime::validate_runtime_ports(settings.mixed_port, settings.controller_port)
    }

    fn validate_port_settings(&self) -> Result<(), String> {
        Self::validate_port_settings_snapshot(&self.settings)
    }

    fn apply_port_candidate_value(
        settings: &mut Settings,
        key: &str,
        value: &JsonValue,
    ) -> Result<(), String> {
        match key {
            "mixedPort" => {
                settings.mixed_port =
                    core_runtime::mixed_port_from_value(value, settings.mixed_port)?;
            }
            "controllerPort" => {
                settings.controller_port = core_runtime::port_from_value(
                    value,
                    settings.controller_port,
                    "Controller port",
                )?;
            }
            "startWithSystemProxy"
            | "tunEnabled"
            | "tunStack"
            | "dnsHijackEnabled"
            | "ipv6Enabled"
            | "allowLan"
            | "logLevel"
            | "reliabilityAuto"
            | "reliabilityProfileFailover"
            | "reliabilityFailureThreshold"
            | "reliabilityMaxDelayMs"
            | "reliabilityCandidateLimit"
            | "killSwitchEnabled" => {}
            _ => return Err(format!("Unsupported setting: {key}")),
        }
        Ok(())
    }

    fn validate_setting_update_candidate(
        &self,
        key: &str,
        value: &JsonValue,
    ) -> Result<(), String> {
        let mut candidate = self.settings.clone();
        Self::apply_port_candidate_value(&mut candidate, key, value)?;
        Self::validate_port_settings_snapshot(&candidate)
    }

    fn validate_settings_update_candidate(
        &self,
        map: &serde_json::Map<String, JsonValue>,
    ) -> Result<(), String> {
        let mut candidate = self.settings.clone();
        for (key, value) in map {
            Self::apply_port_candidate_value(&mut candidate, key, value)?;
        }
        Self::validate_port_settings_snapshot(&candidate)
    }

    fn rollback_settings_after_failure(
        &mut self,
        previous_settings: Settings,
        restart_previous_runtime: bool,
        reason: String,
    ) -> String {
        self.add_log(
            format!("Settings update failed; rolling back: {reason}"),
            "error",
        );
        if restart_previous_runtime && self.process.is_some() {
            let _ = self.stop();
            thread::sleep(Duration::from_millis(
                core_runtime::RUNTIME_RESTART_SETTLE_MS,
            ));
        }
        self.settings = previous_settings;
        let mut rollback_errors = Vec::new();
        if let Err(err) = self.save_settings() {
            rollback_errors.push(format!("save failed: {err}"));
        }
        if let Err(err) = self.ensure_direct_profile() {
            rollback_errors.push(format!("direct profile refresh failed: {err}"));
        }
        if restart_previous_runtime {
            if let Err(err) = self.start() {
                rollback_errors.push(format!("restart previous runtime failed: {err}"));
            }
        }
        if rollback_errors.is_empty() {
            format!("{reason}; settings rolled back")
        } else {
            format!(
                "{reason}; settings rollback had errors: {}",
                rollback_errors.join("; ")
            )
        }
    }

    fn active_profile(&self) -> Option<Profile> {
        self.settings
            .profiles
            .iter()
            .find(|p| p.id == self.settings.active_profile_id)
            .cloned()
            .or_else(|| self.settings.profiles.first().cloned())
    }

    fn routing_apply_backup_paths(&self) -> (PathBuf, PathBuf) {
        (
            self.app_data.join("routing-last-apply-backup.yaml"),
            self.app_data.join("routing-last-apply-backup.json"),
        )
    }

    fn routing_apply_metadata(&self) -> Option<JsonValue> {
        let (_, backup_meta_path) = self.routing_apply_backup_paths();
        fs::read_to_string(&backup_meta_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
    }

    fn apply_routing_drafts(
        &mut self,
        drafts: Vec<RoutingDraftInput>,
    ) -> Result<JsonValue, String> {
        if drafts.is_empty() {
            return Err("No routing drafts to apply.".to_string());
        }
        if drafts.len() > 24 {
            return Err("Apply at most 24 routing drafts at once.".to_string());
        }
        let profile = self
            .active_profile()
            .ok_or_else(|| "No active profile; routing rules cannot be applied.".to_string())?;
        if profile.profile_type == "builtin" {
            return Err(
                "The built-in direct profile cannot be edited; import a subscription first."
                    .to_string(),
            );
        }
        let profile_path = PathBuf::from(&profile.path);
        let previous_raw = fs::read_to_string(&profile_path)
            .map_err(|err| format!("鍒嗘祦瑙勫垯搴旂敤澶辫触锛氳鍙栧綋鍓嶉厤缃け璐ワ細{err}"))?;
        let mut source: YamlValue = serde_yaml::from_str(&previous_raw).map_err(|err| {
            format!("Routing apply failed: active profile YAML parse failed: {err}")
        })?;
        let targets = routing_rule_target_catalog(&source);
        let mut applied_rules = Vec::new();
        let mut applied_details = Vec::new();
        for draft in drafts {
            let (rule, detail) = normalize_routing_draft_rule(&draft, &targets)?;
            applied_rules.push(rule);
            applied_details.push(detail);
        }
        let Some(config) = source.as_mapping_mut() else {
            return Err("Routing apply failed: config root is not a YAML object.".to_string());
        };
        let rules = ensure_yaml_sequence(config, "rules");
        for rule in &applied_rules {
            let duplicate = rules
                .iter()
                .filter_map(YamlValue::as_str)
                .any(|existing| existing.trim() == rule);
            if duplicate {
                return Err(format!("鍒嗘祦瑙勫垯宸插瓨鍦紝鏈噸澶嶅啓鍏ワ細{rule}"));
            }
        }
        let insert_at = rules
            .iter()
            .position(|value| {
                value
                    .as_str()
                    .map(|rule| rule.trim_start().to_ascii_uppercase().starts_with("MATCH,"))
                    .unwrap_or(false)
            })
            .unwrap_or(rules.len());
        for (offset, rule) in applied_rules.iter().enumerate() {
            rules.insert(insert_at + offset, yaml_str(rule));
        }
        let settings = self.settings.clone();
        let runtime =
            config_pipeline::preflight_profile_source(source.clone(), &profile, &settings)
                .map_err(|err| format!("Routing preflight failed: {err}"))?;
        let runtime_preflight = runtime.report;
        let next_raw = serde_yaml::to_string(&source)
            .map_err(|err| format!("鍒嗘祦瑙勫垯搴忓垪鍖栧け璐ワ細{err}"))?;
        let (backup_path, backup_meta_path) = self.routing_apply_backup_paths();
        atomic_write_text_confined(&backup_path, &self.app_data, &previous_raw)?;
        let previous_digest = sha256_text(&previous_raw);
        let next_digest = sha256_text(&next_raw);
        let metadata = json!({
            "profileId": profile.id,
            "profileName": profile.name,
            "createdAt": now_iso(),
            "previousDigest": previous_digest,
            "nextDigest": next_digest,
            "appliedRules": applied_rules,
            "appliedCount": applied_details.len()
        });
        atomic_write_text_confined(
            &backup_meta_path,
            &self.app_data,
            &serde_json::to_string_pretty(&metadata).map_err(|err| err.to_string())?,
        )?;
        atomic_write_text_confined(&profile_path, &self.profile_dir, &next_raw)?;
        let was_running = self.process.is_some();
        let reload_result = if was_running {
            self.hot_reload_profile(&profile)
        } else {
            Ok(json!({ "ok": true, "skipped": true, "reason": "core is not running" }))
        };
        if let Err(err) = reload_result {
            let restore_file =
                atomic_write_text_confined(&profile_path, &self.profile_dir, &previous_raw);
            let restore_runtime = if was_running && restore_file.is_ok() {
                self.hot_reload_profile(&profile).map(|_| ())
            } else {
                restore_file.map(|_| ())
            };
            return Err(match restore_runtime {
                Ok(_) => format!("Routing hot reload failed and config was rolled back: {err}"),
                Err(rollback_err) => {
                    format!(
                        "Routing hot reload failed: {err}; rollback also failed: {rollback_err}"
                    )
                }
            });
        }
        self.add_log(
            format!(
                "Routing drafts applied: {} rule(s), profile {}, digest {}",
                applied_details.len(),
                sanitize_sensitive_text(&profile.name),
                &next_digest[..12.min(next_digest.len())]
            ),
            "info",
        );
        add_routing_user_rules(&self.app_data, &profile.id, &applied_rules)?;
        Ok(json!({
            "ok": true,
            "profileId": profile.id,
            "profileName": profile.name,
            "appliedCount": applied_details.len(),
            "rules": applied_details,
            "runtimePreflight": runtime_preflight,
            "rollbackAvailable": true,
            "nextStep": "Applied. You can undo the latest routing apply from the routing page."
        }))
    }

    fn undo_last_routing_apply(&mut self) -> Result<JsonValue, String> {
        let (backup_path, backup_meta_path) = self.routing_apply_backup_paths();
        let backup_raw = fs::read_to_string(&backup_path)
            .map_err(|_| "No routing apply record is available to undo.".to_string())?;
        let metadata: JsonValue = fs::read_to_string(&backup_meta_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| json!({}));
        let profile_id = metadata
            .get("profileId")
            .and_then(JsonValue::as_str)
            .ok_or_else(|| "Routing undo record is incomplete: missing profile id.".to_string())?;
        if self.settings.active_profile_id != profile_id {
            return Err(
                "Switch back to the profile used for the routing apply before undoing it."
                    .to_string(),
            );
        }
        let profile = self
            .settings
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
            .ok_or_else(|| "Routing undo failed: original profile no longer exists.".to_string())?;
        let restored_config: YamlValue = serde_yaml::from_str(&backup_raw)
            .map_err(|err| format!("Routing undo failed: backup YAML parse failed: {err}"))?;
        let settings = self.settings.clone();
        let runtime =
            config_pipeline::preflight_profile_source(restored_config, &profile, &settings)
                .map_err(|err| format!("Routing undo preflight failed: {err}"))?;
        let runtime_preflight = runtime.report;
        let profile_path = PathBuf::from(&profile.path);
        atomic_write_text_confined(&profile_path, &self.profile_dir, &backup_raw)?;
        if self.process.is_some() {
            self.hot_reload_profile(&profile).map_err(|err| {
                format!("Routing undo restored the file, but hot reload failed: {err}")
            })?;
        }
        let _ = remove_file_confined(&backup_path, &self.app_data);
        let _ = remove_file_confined(&backup_meta_path, &self.app_data);
        self.add_log(
            format!(
                "Routing apply undone: profile {}, restored digest {}",
                sanitize_sensitive_text(&profile.name),
                &sha256_text(&backup_raw)[..12]
            ),
            "info",
        );
        Ok(json!({
            "ok": true,
            "profileId": profile.id,
            "profileName": profile.name,
            "runtimePreflight": runtime_preflight,
            "rollbackAvailable": false,
            "nextStep": "Latest routing apply has been undone."
        }))
    }

    fn commit_profile_routing_config(
        &mut self,
        profile: &Profile,
        source: &YamlValue,
        previous_raw: &str,
        label: &str,
    ) -> Result<JsonValue, String> {
        let settings = self.settings.clone();
        let runtime = config_pipeline::preflight_profile_source(source.clone(), profile, &settings)
            .map_err(|err| format!("{label} preflight failed: {err}"))?;
        let runtime_preflight = runtime.report;
        let next_raw = serde_yaml::to_string(source)
            .map_err(|err| format!("{label} YAML serialization failed: {err}"))?;
        let profile_path = PathBuf::from(&profile.path);
        atomic_write_text_confined(&profile_path, &self.profile_dir, &next_raw)?;
        let was_running = self.process.is_some();
        if was_running {
            if let Err(err) = self.hot_reload_profile(profile) {
                let restore_file =
                    atomic_write_text_confined(&profile_path, &self.profile_dir, previous_raw);
                let restore_runtime = if restore_file.is_ok() {
                    self.hot_reload_profile(profile).map(|_| ())
                } else {
                    restore_file.map(|_| ())
                };
                return Err(match restore_runtime {
                    Ok(_) => format!("{label} hot reload failed and config was rolled back: {err}"),
                    Err(rollback_err) => {
                        format!("{label} hot reload failed: {err}; rollback also failed: {rollback_err}")
                    }
                });
            }
        }
        Ok(json!({
            "ok": true,
            "profileId": profile.id,
            "profileName": profile.name,
            "runtimePreflight": runtime_preflight,
            "digest": sha256_text(&next_raw)
        }))
    }

    fn active_editable_profile_and_config(
        &self,
        label: &str,
    ) -> Result<(Profile, String, YamlValue), String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| format!("{label} failed: no active profile"))?;
        if profile.profile_type == "builtin" {
            return Err(format!(
                "{label} failed: builtin direct profile cannot be edited"
            ));
        }
        let raw = fs::read_to_string(&profile.path)
            .map_err(|err| format!("{label} failed: read profile config failed: {err}"))?;
        let source: YamlValue = serde_yaml::from_str(&raw)
            .map_err(|err| format!("{label} failed: profile YAML parse failed: {err}"))?;
        Ok((profile, raw, source))
    }

    fn apply_routing_group_edit(
        &mut self,
        edit: RoutingGroupEditInput,
    ) -> Result<JsonValue, String> {
        let (profile, previous_raw, mut source) =
            self.active_editable_profile_and_config("Routing group edit")?;
        let action = edit.action.trim().to_ascii_lowercase();
        {
            let Some(config) = source.as_mapping_mut() else {
                return Err(
                    "Routing group edit failed: profile root is not a YAML object".to_string(),
                );
            };
            config_pipeline::normalize_runtime_proxy_groups_for_display(config);
        }
        let targets_before = routing_rule_target_catalog(&source);
        let name = edit.name.unwrap_or_default();
        let new_name = edit.new_name.unwrap_or_else(|| name.clone());
        let validated_name = if action == "add" {
            validate_routing_rule_part("strategy group name", &new_name, 80)?
        } else {
            validate_routing_rule_part("strategy group name", &name, 80)?
        };
        let validated_new_name = validate_routing_rule_part("strategy group name", &new_name, 80)?;
        if config_pipeline::is_internal_proxy_group_name(&validated_name)
            || config_pipeline::is_internal_proxy_group_name(&validated_new_name)
        {
            return Err("Routing group edit failed: internal groups cannot be edited".to_string());
        }
        if action == "delete" && validated_name.eq_ignore_ascii_case("Proxies") {
            return Err(
                "Routing group edit failed: Proxies is the main group and cannot be deleted"
                    .to_string(),
            );
        }
        if action == "delete" {
            let blocking_rules = yaml_sequence(&source, "rules")
                .into_iter()
                .flat_map(|items| items.iter())
                .filter_map(YamlValue::as_str)
                .filter(|rule| {
                    routing_rule_target(rule).as_deref() == Some(validated_name.as_str())
                })
                .take(3)
                .count();
            if blocking_rules > 0 && !targets_before.contains("Proxies") {
                return Err(format!(
                    "Routing group edit failed: {validated_name} is still used by {blocking_rules} rule(s), and Proxies is not available as fallback"
                ));
            }
        }
        let Some(config) = source.as_mapping_mut() else {
            return Err("Routing group edit failed: profile root is not a YAML object".to_string());
        };
        let mut renamed = false;
        {
            let groups = ensure_yaml_sequence(config, "proxy-groups");
            let group_index = groups
                .iter()
                .position(|group| yaml_mapping_name(group) == Some(validated_name.as_str()));
            match action.as_str() {
                "add" => {
                    if groups
                        .iter()
                        .any(|group| yaml_mapping_name(group) == Some(validated_new_name.as_str()))
                    {
                        return Err(format!(
                            "Routing group edit failed: group already exists: {validated_new_name}"
                        ));
                    }
                    let members = validate_routing_group_members(
                        &edit.items.unwrap_or_default(),
                        &targets_before,
                    )?;
                    let group_type = validate_routing_group_type(
                        edit.group_type.as_deref().unwrap_or("select"),
                    )?;
                    let mut group = Mapping::new();
                    set_yaml(&mut group, "name", yaml_str(validated_new_name.clone()));
                    set_yaml(&mut group, "type", yaml_str(group_type));
                    set_yaml(&mut group, "proxies", yaml_string_values(&members));
                    groups.push(YamlValue::Mapping(group));
                }
                "edit" => {
                    let Some(index) = group_index else {
                        return Err(format!(
                            "Routing group edit failed: group not found: {validated_name}"
                        ));
                    };
                    if validated_name != validated_new_name
                        && groups.iter().any(|group| {
                            yaml_mapping_name(group) == Some(validated_new_name.as_str())
                        })
                    {
                        return Err(format!(
                            "Routing group edit failed: group already exists: {validated_new_name}"
                        ));
                    }
                    let members = validate_routing_group_members(
                        &edit.items.unwrap_or_default(),
                        &targets_before,
                    )?;
                    let group_type = validate_routing_group_type(
                        edit.group_type.as_deref().unwrap_or("select"),
                    )?;
                    let Some(map) = groups[index].as_mapping_mut() else {
                        return Err(
                            "Routing group edit failed: group is not editable YAML".to_string()
                        );
                    };
                    set_yaml(map, "name", yaml_str(validated_new_name.clone()));
                    set_yaml(map, "type", yaml_str(group_type));
                    set_yaml(map, "proxies", yaml_string_values(&members));
                    renamed = validated_name != validated_new_name;
                }
                "delete" => {
                    let Some(index) = group_index else {
                        return Err(format!(
                            "Routing group edit failed: group not found: {validated_name}"
                        ));
                    };
                    groups.remove(index);
                }
                _ => return Err("Routing group edit failed: unsupported action".to_string()),
            }
        }
        if renamed {
            if let Some(rules) = config
                .get_mut(yaml_key("rules"))
                .and_then(YamlValue::as_sequence_mut)
            {
                for rule in rules {
                    if let Some(raw) = rule.as_str() {
                        if let Some(next) =
                            routing_rule_replace_target(raw, &validated_name, &validated_new_name)
                        {
                            *rule = yaml_str(next);
                        }
                    }
                }
            }
            if let Some(value) = self.settings.selected_proxy_map.remove(&validated_name) {
                self.settings
                    .selected_proxy_map
                    .insert(validated_new_name.clone(), value);
                let _ = self.save_settings();
            }
        }
        if action == "delete" {
            if let Some(rules) = config
                .get_mut(yaml_key("rules"))
                .and_then(YamlValue::as_sequence_mut)
            {
                for rule in rules {
                    if let Some(raw) = rule.as_str() {
                        if let Some(next) =
                            routing_rule_replace_target(raw, &validated_name, "Proxies")
                        {
                            *rule = yaml_str(next);
                        }
                    }
                }
            }
            self.settings.selected_proxy_map.remove(&validated_name);
            let _ = self.save_settings();
        }
        let mut result = self.commit_profile_routing_config(
            &profile,
            &source,
            &previous_raw,
            "Routing group edit",
        )?;
        if let Some(map) = result.as_object_mut() {
            map.insert("action".to_string(), json!(action));
            map.insert("group".to_string(), json!(validated_new_name));
        }
        Ok(result)
    }

    fn apply_routing_rule_edit(&mut self, edit: RoutingRuleEditInput) -> Result<JsonValue, String> {
        let (profile, previous_raw, mut source) =
            self.active_editable_profile_and_config("Routing rule edit")?;
        let action = edit.action.trim().to_ascii_lowercase();
        let raw = edit.raw.unwrap_or_default();
        let user_rules = routing_user_rule_set(&self.app_data, &profile.id);
        if matches!(action.as_str(), "edit" | "delete") && !user_rules.contains(raw.trim()) {
            return Err(
                "Routing rule edit failed: only Aegos user rules can be edited or deleted"
                    .to_string(),
            );
        }
        let targets = routing_rule_target_catalog(&source);
        let Some(config) = source.as_mapping_mut() else {
            return Err("Routing rule edit failed: profile root is not a YAML object".to_string());
        };
        let rules = ensure_yaml_sequence(config, "rules");
        let index = if action == "add" {
            None
        } else {
            rules
                .iter()
                .position(|rule| rule.as_str().map(str::trim) == Some(raw.trim()))
        };
        let mut next_user_rule = None;
        match action.as_str() {
            "add" | "edit" => {
                let draft = RoutingDraftInput {
                    kind: edit.kind.unwrap_or_default(),
                    condition: edit.condition.unwrap_or_default(),
                    target: edit.target.unwrap_or_default(),
                    option: edit.option,
                    label: edit.label,
                    source: Some("user".to_string()),
                };
                let (next_rule, _) = normalize_routing_draft_rule(&draft, &targets)?;
                if rules
                    .iter()
                    .any(|rule| rule.as_str().map(str::trim) == Some(next_rule.as_str()))
                    && raw.trim() != next_rule
                {
                    return Err(format!(
                        "Routing rule edit failed: rule already exists: {next_rule}"
                    ));
                }
                if action == "add" {
                    let insert_at = rules
                        .iter()
                        .position(|value| {
                            value
                                .as_str()
                                .map(|rule| {
                                    rule.trim_start().to_ascii_uppercase().starts_with("MATCH,")
                                })
                                .unwrap_or(false)
                        })
                        .unwrap_or(rules.len());
                    rules.insert(insert_at, yaml_str(next_rule.clone()));
                } else {
                    let Some(index) = index else {
                        return Err("Routing rule edit failed: rule not found".to_string());
                    };
                    rules[index] = yaml_str(next_rule.clone());
                }
                next_user_rule = Some(next_rule);
            }
            "delete" => {
                let Some(index) = index else {
                    return Err("Routing rule edit failed: rule not found".to_string());
                };
                rules.remove(index);
            }
            _ => return Err("Routing rule edit failed: unsupported action".to_string()),
        }
        let result = self.commit_profile_routing_config(
            &profile,
            &source,
            &previous_raw,
            "Routing rule edit",
        )?;
        match action.as_str() {
            "add" => replace_routing_user_rule(
                &self.app_data,
                &profile.id,
                None,
                next_user_rule.as_deref(),
            )?,
            "edit" => replace_routing_user_rule(
                &self.app_data,
                &profile.id,
                Some(raw.trim()),
                next_user_rule.as_deref(),
            )?,
            "delete" => {
                replace_routing_user_rule(&self.app_data, &profile.id, Some(raw.trim()), None)?
            }
            _ => {}
        }
        Ok(result)
    }

    fn standby_settings(&self) -> Settings {
        let mut settings = self.settings.clone();
        settings.tun_enabled = false;
        settings
    }

    fn preflight_profile_file(&self, profile: &Profile) -> Result<JsonValue, String> {
        self.render_runtime_profile(profile)
            .map(|rendered| rendered.report)
    }

    fn render_runtime_profile(
        &self,
        profile: &Profile,
    ) -> Result<profile_compiler::RenderedProfile, String> {
        self.render_runtime_profile_with_settings(profile, &self.settings)
    }

    fn render_runtime_profile_with_settings(
        &self,
        profile: &Profile,
        settings: &Settings,
    ) -> Result<profile_compiler::RenderedProfile, String> {
        profile_compiler::compile_profile_file(profile, settings)
    }

    fn launch_runtime_yaml(
        &self,
        rendered: &profile_compiler::RenderedProfile,
    ) -> Result<core_runtime::CoreRuntimeProfile, String> {
        core_runtime::render_runtime_profile_yaml(
            &rendered.yaml,
            detect_windows_primary_interface_name(),
        )
    }

    fn patch_profile_file(&mut self, profile: &Profile) -> Result<String, String> {
        let path = PathBuf::from(&profile.path);
        let rendered = self.render_runtime_profile(profile)?;
        let runtime_profile = self.launch_runtime_yaml(&rendered)?;
        let current_digest = sha256_file(&path);
        if current_digest != rendered.digest {
            atomic_write_text_confined(&path, &self.profile_dir, &rendered.yaml)?;
        }
        let runtime_write =
            core_runtime::write_runtime_profile(&self.core_runtime_paths(), &runtime_profile)?;
        self.add_log(
            format!(
                "Config preflight passed: {} proxies, {} groups, digest {}{}{}, runtime {}",
                rendered
                    .report
                    .get("proxies")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                rendered
                    .report
                    .get("proxyGroups")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                core_runtime::digest_prefix(&runtime_write.digest),
                if current_digest == rendered.digest {
                    " (unchanged)"
                } else {
                    ""
                },
                runtime_write
                    .outbound_interface
                    .as_ref()
                    .map(|name| format!(", outbound interface {name}"))
                    .unwrap_or_else(|| ", outbound interface auto".to_string()),
                runtime_write.path.display()
            ),
            "info",
        );
        Ok(runtime_write.digest)
    }

    fn speed_test_firewall_ports(&self) -> Vec<u16> {
        let mut ports = [80u16, 443u16].into_iter().collect::<HashSet<_>>();
        if let Some(profile) = self.active_profile() {
            let path = PathBuf::from(&profile.path);
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(source) = serde_yaml::from_str::<YamlValue>(&raw) {
                    if let Ok(profile_ports) =
                        config_pipeline::speed_test_firewall_ports_from_source(
                            source,
                            &profile,
                            &self.standby_settings(),
                        )
                    {
                        ports.extend(profile_ports);
                    }
                }
            }
        }
        let mut ports = ports.into_iter().collect::<Vec<_>>();
        ports.sort_unstable();
        ports
    }

    fn runtime_profile_path(&self) -> PathBuf {
        self.home_dir.join("aegos-runtime-profile.yaml")
    }

    fn hot_reload_profile(&mut self, profile: &Profile) -> Result<JsonValue, String> {
        let config_digest = self.patch_profile_file(profile)?;
        let same_runtime = self.runtime_profile_id.as_deref() == Some(profile.id.as_str())
            && self.runtime_config_digest.as_deref() == Some(config_digest.as_str());
        if same_runtime && self.core_controller().runtime_reuse_ready() {
            self.add_log(
                format!(
                    "Profile apply skipped; unchanged runtime config digest: {}",
                    core_runtime::digest_prefix(&config_digest)
                ),
                "info",
            );
            return Ok(core_runtime::runtime_config_unchanged_result_json(
                config_digest,
            ));
        }
        let apply_transaction = core_runtime::CoreRuntimeApplyTransaction::new(
            self.runtime_profile_path(),
            profile.name.clone(),
            config_digest.clone(),
        );
        self.add_log(apply_transaction.display_label(), "info");
        let result = apply_transaction.apply(&self.core_controller())?;
        self.wait_for_controller()?;
        self.runtime_profile_id = Some(profile.id.clone());
        self.runtime_config_digest = Some(result.digest.clone());
        if self.traffic_takeover
            && (self.settings.start_with_system_proxy || self.settings.system_proxy)
        {
            if let Err(err) = self.set_system_proxy(true) {
                self.add_log(
                    format!("System proxy enable failed after profile hot reload: {err}"),
                    "warn",
                );
            }
        }
        self.add_log(
            core_runtime::hot_reload_success_message(
                &profile.name,
                &result.digest,
                result
                    .version_probe
                    .get("version")
                    .and_then(JsonValue::as_str),
            ),
            "info",
        );
        Ok(result.controller_response)
    }

    fn ensure_runtime_ports(&mut self) -> Result<(), String> {
        self.settings.mixed_port = find_free_port(
            self.settings.mixed_port,
            AEGOS_DEFAULT_MIXED_PORT,
            core_runtime::RESERVED_MIXED_PORTS,
        )?;
        let controller_reserved = [self.settings.mixed_port];
        self.settings.controller_port = find_free_port(
            self.settings.controller_port,
            AEGOS_DEFAULT_CONTROLLER_PORT,
            &controller_reserved,
        )?;
        self.validate_port_settings()?;
        self.save_settings()
    }

    fn reap_exited_core(&mut self) -> Option<String> {
        let child = self.process.as_mut()?;
        let reason = core_runtime::process_exit_message(child.try_wait());
        if reason.is_some() {
            self.process = None;
            self.runtime_profile_id = None;
            self.runtime_config_digest = None;
            self.traffic_takeover = false;
        }
        reason
    }

    fn recent_logs(&self, limit: usize) -> Vec<LogEntry> {
        let logs = self.logs.lock().unwrap();
        let mut items = logs.iter().rev().take(limit).cloned().collect::<Vec<_>>();
        items.reverse();
        items
    }

    fn recent_log_summary(&self, limit: usize) -> String {
        let items = self.recent_logs(limit);
        if items.is_empty() {
            return "No recent logs.".to_string();
        }
        items
            .into_iter()
            .map(|entry| format!("[{}] {}", entry.level, entry.line))
            .collect::<Vec<_>>()
            .join(" | ")
    }

    fn start_failure_message(&self, profile: Option<&Profile>, reason: &str) -> String {
        core_runtime::CoreStartFailureContext::new(
            self.core_path.clone(),
            profile.map(|item| item.name.clone()),
            profile.map(|item| item.path.clone()),
            self.settings.mixed_port,
            self.settings.controller_port,
            self.recent_log_summary(8),
        )
        .message(reason)
    }

    fn prepare_runtime_profile(
        &mut self,
        profile: &Profile,
        enable_takeover: bool,
    ) -> Result<String, String> {
        if enable_takeover {
            return self.patch_profile_file(profile);
        }
        let settings = self.standby_settings();
        let rendered = self.render_runtime_profile_with_settings(profile, &settings)?;
        let runtime_profile = self.launch_runtime_yaml(&rendered)?;
        let runtime_write =
            core_runtime::write_runtime_profile(&self.core_runtime_paths(), &runtime_profile)?;
        self.add_log(
            format!(
                "Standby config preflight passed: {} proxies, {} groups, digest {}{}, runtime {}",
                rendered
                    .report
                    .get("proxies")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                rendered
                    .report
                    .get("proxyGroups")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                core_runtime::digest_prefix(&runtime_write.digest),
                runtime_write
                    .outbound_interface
                    .as_ref()
                    .map(|name| format!(", outbound interface {name}"))
                    .unwrap_or_else(|| ", outbound interface auto".to_string()),
                runtime_write.path.display()
            ),
            "info",
        );
        Ok(runtime_write.digest)
    }

    fn apply_takeover_after_core_ready(&mut self, enable_takeover: bool) {
        let takeover_plan = core_runtime::CoreTrafficTakeoverPlan::after_core_ready(
            enable_takeover,
            self.settings.system_proxy,
            self.settings.start_with_system_proxy,
            self.settings.tun_enabled,
        );
        let mut system_proxy_applied = false;
        if takeover_plan.should_apply_system_proxy {
            self.traffic_takeover = takeover_plan.optimistic_takeover_before_system_proxy();
            match self.set_system_proxy(true) {
                Ok(_) => system_proxy_applied = true,
                Err(err) => {
                    self.add_log(
                        format!("System proxy enable failed after core start: {err}"),
                        "warn",
                    );
                }
            }
        }
        self.traffic_takeover = takeover_plan.final_traffic_takeover(system_proxy_applied);
    }

    fn start(&mut self) -> Result<JsonValue, String> {
        self.start_with_takeover(true)
    }

    fn start_standby(&mut self) -> Result<JsonValue, String> {
        self.start_with_takeover(false)
    }

    fn start_with_takeover(&mut self, enable_takeover: bool) -> Result<JsonValue, String> {
        if !self.core_path.exists() {
            return Err(core_runtime::core_missing_message(&self.core_path));
        }
        self.ensure_runtime_ports().map_err(|err| {
            self.start_failure_message(None, &format!("Port preparation failed: {err}"))
        })?;
        let profile = self
            .active_profile()
            .ok_or_else(|| "娌℃湁娲诲姩閰嶇疆".to_string())?;
        let config_digest = self
            .prepare_runtime_profile(&profile, enable_takeover)
            .map_err(|err| {
                self.start_failure_message(
                    Some(&profile),
                    &format!("Config generation failed: {err}"),
                )
            })?;
        let identity_matches = core_runtime::runtime_identity_matches(
            self.runtime_profile_id.as_deref(),
            profile.id.as_str(),
            self.runtime_config_digest.as_deref(),
            config_digest.as_str(),
        );
        let process_running = self.process.is_some();
        let controller_ready =
            process_running && identity_matches && self.core_controller().runtime_reuse_ready();
        match core_runtime::decide_runtime_start(
            process_running,
            identity_matches,
            controller_ready,
        ) {
            core_runtime::CoreRuntimeStartAction::LaunchFresh => {}
            core_runtime::CoreRuntimeStartAction::ReuseRunning => {
                self.apply_takeover_after_core_ready(enable_takeover);
                return Ok(core_runtime::core_start_result_json(
                    Some("Core already running"),
                    !enable_takeover,
                    self.traffic_takeover,
                    self.connection_closure(),
                ));
            }
            core_runtime::CoreRuntimeStartAction::RestartForDrift => {
                let restart_plan = core_runtime::CoreRuntimeRestartPlan::for_runtime_drift(
                    self.settings.system_proxy,
                    self.traffic_takeover,
                    enable_takeover,
                );
                self.add_log(core_runtime::RUNTIME_DRIFT_RESTART_MESSAGE, "warn");
                self.stop()?;
                if restart_plan.should_restore_proxy_preference() {
                    self.restore_system_proxy_preference(restart_plan.restore_system_proxy);
                }
                thread::sleep(Duration::from_millis(restart_plan.delay_ms));
            }
        }
        ensure_dir(&self.home_dir).map_err(|err| {
            self.start_failure_message(
                Some(&profile),
                &format!("Runtime directory preparation failed: {err}"),
            )
        })?;
        let launch_plan = core_runtime::CoreLaunchPlan::new(
            self.core_runtime_paths(),
            profile.name.clone(),
            !enable_takeover,
        );
        self.add_log(launch_plan.display_label(), "info");
        let mut command = launch_plan.command();
        let mut child = command.spawn().map_err(|err| {
            self.start_failure_message(Some(&profile), &format!("Core process spawn failed: {err}"))
        })?;
        if let Some(stdout) = child.stdout.take() {
            let logs = self.logs.clone();
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().flatten() {
                    let line = sanitize_sensitive_text(&line);
                    let mut logs = logs.lock().unwrap();
                    logs.push(LogEntry {
                        at: now_iso(),
                        level: "core".to_string(),
                        category: "core".to_string(),
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
                    let line = sanitize_sensitive_text(&line);
                    let mut logs = logs.lock().unwrap();
                    logs.push(LogEntry {
                        at: now_iso(),
                        level: "warn".to_string(),
                        category: "core".to_string(),
                        line,
                    });
                    if logs.len() > 700 {
                        logs.remove(0);
                    }
                }
            });
        }
        self.process = Some(child);
        if let Err(err) = self.wait_for_controller() {
            let message = self.start_failure_message(Some(&profile), &err);
            self.terminate_core_process(core_runtime::TERMINATE_FAILED_STARTUP_MESSAGE);
            return Err(message);
        }
        self.runtime_profile_id = Some(profile.id.clone());
        self.runtime_config_digest = Some(config_digest);
        self.apply_takeover_after_core_ready(enable_takeover);
        Ok(core_runtime::core_start_result_json(
            None,
            !enable_takeover,
            self.traffic_takeover,
            self.connection_closure(),
        ))
    }

    fn terminate_core_process(&mut self, message: &str) {
        if let Some(mut child) = self.process.take() {
            self.add_log(message, "warn");
            let _ = child.kill();
            let _ = child.wait();
        }
        self.runtime_profile_id = None;
        self.runtime_config_digest = None;
        self.traffic_takeover = false;
    }

    fn restore_system_proxy_preference(&mut self, enabled: bool) {
        if enabled && !self.settings.system_proxy {
            self.settings.system_proxy = true;
            if let Err(err) = self.save_settings() {
                self.add_log(
                    format!("Failed to restore system proxy preference: {err}"),
                    "warn",
                );
            }
        }
    }

    fn restart_core_preserving_proxy(&mut self, delay_ms: u64) -> Result<JsonValue, String> {
        let restart_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
            self.settings.system_proxy,
            self.traffic_takeover,
            delay_ms,
        );
        self.stop()?;
        self.start_from_restart_plan(restart_plan)
    }

    fn start_from_restart_plan(
        &mut self,
        restart_plan: core_runtime::CoreRuntimeRestartPlan,
    ) -> Result<JsonValue, String> {
        if restart_plan.should_restore_proxy_preference() {
            self.restore_system_proxy_preference(restart_plan.restore_system_proxy);
        }
        thread::sleep(Duration::from_millis(restart_plan.delay_ms));
        match restart_plan.next_action() {
            core_runtime::CoreRuntimeRestartAction::StartWithTakeover => self.start(),
            core_runtime::CoreRuntimeRestartAction::StartStandby => self.start_standby(),
        }
    }

    fn stop(&mut self) -> Result<JsonValue, String> {
        let restore_result = self.set_system_proxy(false);
        self.terminate_core_process(core_runtime::TERMINATE_STOP_MESSAGE);
        if let Err(err) = restore_result {
            return Err(format!(
                "Core stopped, but Windows system proxy restore failed: {err}"
            ));
        }
        Ok(core_runtime::core_stop_result_json())
    }

    fn shutdown_for_exit(&mut self) {
        if self.settings.system_proxy || self.proxy_snapshot_path.exists() {
            if let Err(err) = self.set_system_proxy(false) {
                self.add_log(
                    format!("System proxy restore failed during exit: {err}"),
                    "warn",
                );
            }
        }
        self.terminate_core_process(core_runtime::TERMINATE_EXIT_MESSAGE);
    }

    fn wait_for_controller(&mut self) -> Result<(), String> {
        let controller = self.core_controller();
        controller.wait_until_ready(|| {
            let reason = self.reap_exited_core();
            if let Some(reason) = &reason {
                self.add_log(&reason, "error");
            }
            reason
        })
    }

    fn status(&mut self) -> JsonValue {
        if let Some(reason) = self.reap_exited_core() {
            self.add_log(reason, "warn");
        }
        let running = self.process.is_some();
        let traffic = self
            .core_controller()
            .status_traffic_snapshot_or_idle(running, &self.last_traffic);
        self.last_traffic = traffic.clone();
        let lan_ip = self.cached_lan_ip();
        core_runtime::status_surface_json(
            self.core_runtime_info(),
            running,
            self.traffic_takeover,
            traffic,
            &self.settings.mode,
            self.settings.system_proxy,
            self.settings.mixed_port,
            &lan_ip,
            &self.cached_outbound_ip(),
            is_process_elevated(),
            json!(self.active_profile()),
            self.speed_test_snapshot(),
            self.public_settings(),
            self.connection_status_summary(),
            self.protection_status(),
            self.network_availability(),
            json!(self.recent_logs(120)),
        )
    }

    fn network_availability(&self) -> JsonValue {
        core_runtime::network_availability_json(
            self.process.is_some(),
            self.traffic_takeover,
            &self.cached_outbound_ip(),
            self.outbound_ip_checked_at,
            now_secs(),
        )
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

    fn cached_outbound_ip(&self) -> String {
        if self.outbound_ip_cache.trim().is_empty() {
            "-".to_string()
        } else {
            self.outbound_ip_cache.clone()
        }
    }

    fn connection_status_summary(&self) -> JsonValue {
        core_runtime::connection_status_json(
            self.process.is_some(),
            self.traffic_takeover,
            self.settings.system_proxy,
            self.settings.tun_enabled,
        )
    }

    fn connection_closure(&self) -> JsonValue {
        let groups = self.proxy_groups();
        let current_node = self
            .current_outbound_ip_proxy_name(&groups)
            .unwrap_or_else(|| "-".to_string());
        let outbound_ip = self.cached_outbound_ip();
        core_runtime::connection_closure_json(
            self.process.is_some(),
            self.traffic_takeover,
            self.settings.system_proxy,
            self.settings.tun_enabled,
            &self.settings.mode,
            &self.settings.active_profile_id,
            &current_node,
            &outbound_ip,
            now_secs(),
        )
    }

    fn public_settings(&self) -> JsonValue {
        core_runtime::public_settings_surface_json(
            &self.settings.active_profile_id,
            self.settings.mixed_port,
            self.settings.controller_port,
            json!(self.public_profiles()),
            self.settings.start_with_system_proxy,
            self.settings.system_proxy,
            self.settings.kill_switch_enabled,
            self.settings.tun_enabled,
            &self.settings.tun_stack,
            self.settings.dns_hijack_enabled,
            self.settings.ipv6_enabled,
            self.settings.allow_lan,
            &self.settings.log_level,
            json!(&self.settings.selected_proxy_map),
            json!(&self.settings.manual_nodes),
            self.settings.reliability_auto,
            self.settings.reliability_profile_failover,
            self.settings.reliability_failure_threshold,
            self.settings.reliability_max_delay_ms,
            self.settings.reliability_candidate_limit,
            self.reliability_failures,
            self.core_path.exists(),
            self.process.is_some(),
            self.traffic_takeover,
            self.proxy_snapshot_path.exists(),
        )
    }

    fn public_profiles(&self) -> Vec<JsonValue> {
        self.settings.profiles.iter().map(public_profile).collect()
    }

    fn protection_status(&self) -> JsonValue {
        core_runtime::protection_status_json(
            self.process.is_some(),
            self.traffic_takeover,
            self.settings.kill_switch_enabled,
            self.settings.tun_enabled,
            self.settings.system_proxy,
        )
    }

    fn set_system_proxy(&mut self, enable: bool) -> Result<bool, String> {
        if enable && !self.traffic_takeover {
            self.settings.system_proxy = true;
            self.save_settings()?;
            self.add_log(
                "System proxy preference enabled; connect before applying Windows proxy takeover",
                "info",
            );
            return Ok(enable);
        }
        if enable {
            self.capture_proxy_snapshot_before_takeover()?;
            run_powershell(&build_proxy_script(true, self.settings.mixed_port))?;
            self.verify_system_proxy_points_to_aegos(true)?;
        } else if let Some(snapshot) = self.load_system_proxy_snapshot() {
            write_windows_proxy_snapshot(&snapshot)?;
            self.clear_system_proxy_snapshot();
            self.verify_system_proxy_points_to_aegos(false)?;
        } else {
            run_powershell(&build_proxy_script(false, self.settings.mixed_port))?;
            self.verify_system_proxy_points_to_aegos(false)?;
        }
        self.settings.system_proxy = enable;
        self.traffic_takeover = self.process.is_some()
            && (enable || (self.traffic_takeover && self.settings.tun_enabled));
        self.save_settings()?;
        self.add_log(
            if enable {
                "System proxy takeover enabled"
            } else {
                "System proxy restored"
            },
            "info",
        );
        Ok(enable)
    }

    fn set_kill_switch(&mut self, enable: bool) -> Result<bool, String> {
        if enable && !is_process_elevated() {
            return Err("Disconnect protection requires administrator permission; restart Aegos as administrator in settings.".to_string());
        }
        run_powershell(&build_kill_switch_script(
            enable,
            &self.app_data,
            &self.core_path,
        ))?;
        self.settings.kill_switch_enabled = enable;
        self.save_settings()?;
        Ok(enable)
    }

    fn repair_system_proxy_takeover(&mut self) -> Result<JsonValue, String> {
        if self.process.is_none() {
            self.start()?;
        }
        self.set_system_proxy(true)?;
        let current = read_windows_proxy_snapshot()?;
        let ok =
            core_runtime::system_proxy_snapshot_points_to_aegos(&current, self.settings.mixed_port);
        if !ok {
            return Err(format!(
                "Windows system proxy still points to '{}', expected 127.0.0.1:{}",
                current.proxy_server, self.settings.mixed_port
            ));
        }
        Ok(core_runtime::system_proxy_repair_result_json(
            self.settings.mixed_port,
            &current,
        ))
    }

    fn apply_setting_value(&mut self, key: &str, value: &JsonValue) -> Result<bool, String> {
        match key {
            "startWithSystemProxy" => {
                self.settings.start_with_system_proxy = value.as_bool().unwrap_or(false)
            }
            "tunEnabled" => {
                let enable = value.as_bool().unwrap_or(false);
                if enable && !is_process_elevated() {
                    return Err(
                        "TUN mode requires administrator permission; restart Aegos as administrator in settings.".to_string()
                    );
                }
                self.settings.tun_enabled = enable;
            }
            "tunStack" => {
                self.settings.tun_stack = string_choice_from_value(
                    value,
                    "mixed",
                    &["mixed", "gvisor", "system"],
                    "TUN stack",
                )?
            }
            "dnsHijackEnabled" => {
                self.settings.dns_hijack_enabled = value.as_bool().unwrap_or(true)
            }
            "ipv6Enabled" => self.settings.ipv6_enabled = value.as_bool().unwrap_or(false),
            "allowLan" => self.settings.allow_lan = value.as_bool().unwrap_or(false),
            "logLevel" => {
                self.settings.log_level = string_choice_from_value(
                    value,
                    "info",
                    &["debug", "info", "warning", "error"],
                    "Log level",
                )?
            }
            "reliabilityAuto" => self.settings.reliability_auto = value.as_bool().unwrap_or(true),
            "reliabilityProfileFailover" => {
                self.settings.reliability_profile_failover = value.as_bool().unwrap_or(true)
            }
            "reliabilityFailureThreshold" => {
                self.settings.reliability_failure_threshold = value
                    .as_u64()
                    .unwrap_or(default_reliability_failure_threshold())
                    .clamp(1, 10)
            }
            "reliabilityMaxDelayMs" => {
                self.settings.reliability_max_delay_ms = value
                    .as_u64()
                    .unwrap_or(default_reliability_max_delay_ms())
                    .clamp(100, 10000)
            }
            "reliabilityCandidateLimit" => {
                self.settings.reliability_candidate_limit = value
                    .as_u64()
                    .unwrap_or(default_reliability_candidate_limit())
                    .clamp(3, 200)
            }
            "mixedPort" => {
                self.settings.mixed_port =
                    core_runtime::mixed_port_from_value(value, self.settings.mixed_port)?
            }
            "controllerPort" => {
                self.settings.controller_port = core_runtime::port_from_value(
                    value,
                    self.settings.controller_port,
                    "Controller port",
                )?
            }
            "killSwitchEnabled" => {
                self.set_kill_switch(value.as_bool().unwrap_or(false))?;
                return Ok(false);
            }
            _ => return Err(format!("Unsupported setting: {key}")),
        }
        Ok(matches!(
            key,
            "mixedPort"
                | "controllerPort"
                | "tunEnabled"
                | "tunStack"
                | "dnsHijackEnabled"
                | "ipv6Enabled"
                | "allowLan"
                | "logLevel"
        ))
    }

    fn restart_after_settings_if_needed(
        &mut self,
        was_running: bool,
        restart: bool,
    ) -> Result<(), String> {
        if restart && was_running {
            self.restart_core_preserving_proxy(350)?;
        }
        Ok(())
    }

    fn update_setting(&mut self, key: &str, value: JsonValue) -> Result<JsonValue, String> {
        let previous_settings = self.settings.clone();
        let was_running = self.process.is_some();
        self.validate_setting_update_candidate(key, &value)?;
        let restart = match self.apply_setting_value(key, &value) {
            Ok(restart) => restart,
            Err(err) => {
                return Err(self.rollback_settings_after_failure(previous_settings, false, err));
            }
        };
        if let Err(err) = self.validate_port_settings() {
            return Err(self.rollback_settings_after_failure(previous_settings, false, err));
        }
        if let Err(err) = self.save_settings() {
            self.settings = previous_settings;
            return Err(format!("Settings save failed: {err}"));
        }
        if let Err(err) = self.ensure_direct_profile() {
            return Err(self.rollback_settings_after_failure(previous_settings, false, err));
        }
        if let Err(err) = self.restart_after_settings_if_needed(was_running, restart) {
            return Err(self.rollback_settings_after_failure(previous_settings, was_running, err));
        }
        Ok(self.public_settings())
    }

    fn update_settings(&mut self, updates: JsonValue) -> Result<JsonValue, String> {
        let map = updates
            .as_object()
            .ok_or_else(|| "Settings update must be an object".to_string())?;
        let previous_settings = self.settings.clone();
        let was_running = self.process.is_some();
        let mut restart = false;
        self.validate_settings_update_candidate(map)?;
        for (key, value) in map {
            restart |= match self.apply_setting_value(key, value) {
                Ok(item_restart) => item_restart,
                Err(err) => {
                    return Err(self.rollback_settings_after_failure(
                        previous_settings,
                        false,
                        err,
                    ));
                }
            };
        }
        if let Err(err) = self.validate_port_settings() {
            return Err(self.rollback_settings_after_failure(previous_settings, false, err));
        }
        if let Err(err) = self.save_settings() {
            self.settings = previous_settings;
            return Err(format!("Settings save failed: {err}"));
        }
        if let Err(err) = self.ensure_direct_profile() {
            return Err(self.rollback_settings_after_failure(previous_settings, false, err));
        }
        if let Err(err) = self.restart_after_settings_if_needed(was_running, restart) {
            return Err(self.rollback_settings_after_failure(previous_settings, was_running, err));
        }
        Ok(self.public_settings())
    }

    fn set_mode(&mut self, mode: &str) -> Result<String, String> {
        if !["rule", "global", "direct"].contains(&mode) {
            return Err("Unsupported mode".to_string());
        }
        self.settings.mode = mode.to_string();
        self.save_settings()?;
        let _ = self
            .core_controller()
            .apply_mode_if_running(self.process.is_some(), mode);
        Ok(mode.to_string())
    }

    fn proxy_groups(&self) -> JsonValue {
        let manual_names = self.active_manual_node_names();
        let speed = self.speed_test.lock().unwrap().clone();
        assemble_proxy_groups_snapshot(
            self.process.is_some(),
            self.core_controller(),
            self.active_profile(),
            self.settings.selected_proxy_map.clone(),
            manual_names,
            speed,
        )
    }

    fn active_manual_node_names(&self) -> HashSet<String> {
        self.active_profile()
            .and_then(|profile| self.settings.manual_nodes.get(&profile.id).cloned())
            .map(|nodes| nodes.keys().cloned().collect::<HashSet<_>>())
            .unwrap_or_default()
    }

    fn collect_proxy_targets(groups: &JsonValue) -> Vec<SpeedTestTarget> {
        groups
            .as_array()
            .map(|groups| {
                let mut seen = HashSet::new();
                groups
                    .iter()
                    .filter_map(|group| {
                        let group_name = group.get("name").and_then(|value| value.as_str())?;
                        let items = group.get("items").and_then(|items| items.as_array())?;
                        Some((group_name.to_string(), items))
                    })
                    .flat_map(|(group_name, items)| {
                        items.iter().filter_map(move |item| {
                            if is_proxy_group_reference_item(item) {
                                return None;
                            }
                            let select_name = item.get("name").and_then(|value| value.as_str())?;
                            let name = item
                                .get("realProxyName")
                                .or_else(|| item.get("name"))
                                .and_then(|value| value.as_str())?;
                            if matches!(name, "DIRECT" | "REJECT" | "PASS" | "COMPATIBLE") {
                                return None;
                            }
                            if is_subscription_metadata_node_name(name) {
                                return None;
                            }
                            let protocol = item
                                .get("speedProtocol")
                                .or_else(|| item.get("protocol"))
                                .or_else(|| item.get("type"))
                                .and_then(|value| value.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let server = item
                                .get("server")
                                .or_else(|| item.get("host"))
                                .and_then(|value| value.as_str())
                                .unwrap_or("")
                                .to_string();
                            Some(SpeedTestTarget {
                                name: name.to_string(),
                                select_name: select_name.to_string(),
                                group_name: group_name.clone(),
                                protocol,
                                server,
                            })
                        })
                    })
                    .filter(|target| {
                        if seen.insert(target.name.clone()) {
                            true
                        } else {
                            false
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn current_outbound_ip_proxy_name(&self, groups: &JsonValue) -> Option<String> {
        let snapshot = groups.as_array()?;
        let group_names = snapshot
            .iter()
            .filter_map(|group| group.get("name").and_then(|value| value.as_str()))
            .map(str::to_string)
            .collect::<HashSet<_>>();
        let primary = ["GLOBAL", "Final", "Proxy", "Proxies"]
            .iter()
            .find(|name| group_names.contains(**name))
            .map(|name| (*name).to_string())
            .or_else(|| {
                self.settings
                    .selected_proxy_map
                    .keys()
                    .find(|name| group_names.contains(*name))
                    .cloned()
            })
            .or_else(|| {
                snapshot
                    .first()
                    .and_then(|group| group.get("name"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })?;
        let leaf = core_runtime::resolve_group_leaf(
            snapshot,
            &self.settings.selected_proxy_map,
            &primary,
            0,
        );
        if leaf.trim().is_empty() || leaf == AEGOS_OUTBOUND_IP_GROUP {
            return None;
        }
        Some(leaf)
    }

    fn sync_outbound_ip_group_selection(&mut self) -> Option<String> {
        let groups = self.proxy_groups();
        let proxy = self.current_outbound_ip_proxy_name(&groups)?;
        if let Some(Err(err)) = self
            .core_controller()
            .apply_auxiliary_proxy_selection_if_running(
                self.process.is_some(),
                AEGOS_OUTBOUND_IP_GROUP,
                &proxy,
            )
        {
            self.add_log(
                format!("Outbound IP lookup group sync failed: {err}"),
                "warn",
            );
            return None;
        }
        self.process.is_some().then_some(proxy)
    }

    fn speed_test_snapshot(&self) -> JsonValue {
        speed_test_runtime_snapshot(&self.speed_test, now_secs())
    }

    fn reset_speed_test_state(&self, reason: &str, clear_health: bool) {
        reset_speed_test_runtime_state(&self.speed_test, reason, clear_health, now_secs());
    }

    fn best_proxy_candidate(&self) -> Option<JsonValue> {
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        let speed = self.speed_test.lock().unwrap().clone();
        speed_recommendation(&targets, &speed.health, now_secs())
    }

    fn select_best_proxy(&mut self) -> Result<JsonValue, String> {
        let candidate = self.best_proxy_candidate().ok_or_else(|| {
            "No low-latency candidate below 100 ms is available; run speed test first".to_string()
        })?;
        let group = candidate
            .get("group")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Best candidate is missing proxy group".to_string())?
            .to_string();
        let proxy = candidate
            .get("proxy")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Best candidate is missing proxy name".to_string())?
            .to_string();
        self.change_proxy(&group, &proxy)?;
        self.add_log(
            format!(
                "Selected best proxy: {} -> {} ({} ms, score {})",
                group,
                proxy,
                candidate
                    .get("delay")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(-1),
                candidate
                    .get("score")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(-1)
            ),
            "info",
        );
        Ok(json!({
            "ok": true,
            "candidate": candidate
        }))
    }

    fn ensure_core_for_delay_test(&mut self) -> Result<(), String> {
        if self.process.is_some() && self.core_controller().runtime_reuse_ready() {
            return Ok(());
        }
        if self.traffic_takeover {
            self.add_log(
                "Speed test requires controller recovery; restarting active core",
                "warn",
            );
            self.start()?;
        } else {
            self.add_log(core_runtime::STANDBY_SPEED_START_MESSAGE, "info");
            self.start_standby()?;
        }
        Ok(())
    }

    fn start_proxy_delay_test_for_run(
        &mut self,
        expected_run_id: Option<u64>,
    ) -> Result<JsonValue, String> {
        if let Err(err) = self.ensure_core_for_delay_test() {
            let message = format!("speed-test-prepare-failed: {err}");
            if let Some(run_id) = expected_run_id {
                fail_speed_test_if_current(&self.speed_test, run_id, message.clone(), now_secs());
            } else {
                let mut speed = self.speed_test.lock().unwrap();
                speed.running = false;
                speed.error = Some(message.clone());
                speed.updated_at = now_secs();
            }
            return Err(message);
        }
        if let Some(run_id) = expected_run_id {
            if !speed_test_run_is_current(&self.speed_test, run_id) {
                return Ok(self.speed_test_snapshot());
            }
        }
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        if let Err(err) = speed_test_preflight(&targets) {
            if let Some(run_id) = expected_run_id {
                fail_speed_test_if_current(&self.speed_test, run_id, err.clone(), now_secs());
            } else {
                let mut speed = self.speed_test.lock().unwrap();
                speed.running = false;
                speed.error = Some(err.clone());
                speed.updated_at = now_secs();
            }
            self.add_log(err.clone(), "warn");
            return Err(err);
        }
        let total = targets.len();
        if total == 0 {
            return Ok(self.speed_test_snapshot());
        }

        let controller = self.core_controller();
        let speed_test = self.speed_test.clone();
        let previous_health = speed_test.lock().unwrap().health.clone();
        let phases = speed_test_phases(targets.clone(), &previous_health, now_secs());
        let run_id;
        {
            let mut speed = speed_test.lock().unwrap();
            if let Some(expected_run_id) = expected_run_id {
                if speed.run_id != expected_run_id || !speed.running {
                    drop(speed);
                    return Ok(self.speed_test_snapshot());
                }
                run_id = expected_run_id;
            } else if speed.running {
                drop(speed);
                return Ok(self.speed_test_snapshot());
            } else {
                run_id = speed.run_id.saturating_add(1);
            }
            let now = now_secs();
            *speed = SpeedTestState {
                run_id,
                running: true,
                started_at: now,
                updated_at: now,
                total,
                completed: 0,
                ok: 0,
                failed: 0,
                delays: HashMap::new(),
                health: previous_health,
                low_latency: Vec::new(),
                recommended: None,
                error: None,
            };
        }

        let speed_firewall_enabled =
            core_runtime::speed_test_firewall_enabled(self.settings.kill_switch_enabled);
        let speed_firewall_ports = core_runtime::speed_test_firewall_ports(
            speed_firewall_enabled,
            &self.speed_test_firewall_ports(),
        );
        self.add_log(format!("Speed test started: {total} nodes"), "info");
        let speed_firewall_app_data = self.app_data.clone();
        let speed_firewall_core_path = self.core_path.clone();
        thread::spawn(move || {
            if speed_firewall_enabled {
                if let Err(err) = run_powershell(&build_speed_test_firewall_script(
                    true,
                    &speed_firewall_app_data,
                    &speed_firewall_core_path,
                    &speed_firewall_ports,
                )) {
                    let message = format!("protection-blocked: {err}");
                    let mut speed = speed_test.lock().unwrap();
                    if speed.run_id == run_id {
                        speed.running = false;
                        speed.error = Some(message);
                        speed.updated_at = now_secs();
                    }
                    return;
                }
            }
            let cleanup_speed_firewall = || {
                if speed_firewall_enabled {
                    let _ = run_powershell(&build_speed_test_firewall_script(
                        false,
                        &speed_firewall_app_data,
                        &speed_firewall_core_path,
                        &speed_firewall_ports,
                    ));
                }
            };
            let client = match Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(6500))
                .build()
            {
                Ok(client) => Arc::new(client),
                Err(err) => {
                    let mut speed = speed_test.lock().unwrap();
                    if speed.run_id == run_id {
                        speed.running = false;
                        speed.error = Some(err.to_string());
                        speed.updated_at = now_secs();
                    }
                    cleanup_speed_firewall();
                    return;
                }
            };
            for (phase_targets, chunk_size) in phases {
                for chunk in phase_targets.chunks(chunk_size) {
                    {
                        let speed = speed_test.lock().unwrap();
                        if !speed.running || speed.run_id != run_id {
                            cleanup_speed_firewall();
                            return;
                        }
                    }
                    let (tx, rx) = mpsc::channel();
                    let mut handles = Vec::with_capacity(chunk.len());
                    for target in chunk.iter().cloned() {
                        let tx = tx.clone();
                        let controller = controller.clone();
                        let client = client.clone();
                        handles.push(thread::spawn(move || {
                            let result = test_proxy_delay_fast(
                                &client,
                                &controller,
                                &target.name,
                                &target.protocol,
                            );
                            let _ = tx.send((target, result));
                        }));
                    }
                    drop(tx);
                    for (target, result) in rx {
                        let mut speed = speed_test.lock().unwrap();
                        if !speed.running || speed.run_id != run_id {
                            cleanup_speed_firewall();
                            return;
                        }
                        speed.completed += 1;
                        if result.delay > 0 {
                            speed.ok += 1;
                        } else {
                            speed.failed += 1;
                        }
                        speed.delays.insert(target.name.clone(), result.delay);
                        let now = now_secs();
                        let health = update_node_health(
                            speed.health.get(&target.name),
                            &target.name,
                            &target.protocol,
                            result.delay,
                            &result.failure_reason,
                            now,
                        );
                        speed.health.insert(target.name.clone(), health);
                        speed.low_latency = low_latency_names(&speed.health, now);
                        speed.recommended = speed_recommendation(&targets, &speed.health, now);
                        speed.updated_at = now;
                    }
                    for handle in handles {
                        let _ = handle.join();
                    }
                }
            }
            let mut speed = speed_test.lock().unwrap();
            if speed.run_id == run_id {
                speed.running = false;
                speed.updated_at = now_secs();
            }
            drop(speed);
            cleanup_speed_firewall();
        });
        Ok(self.speed_test_snapshot())
    }

    fn test_single_proxy_delay_for_run(
        &mut self,
        name: String,
        expected_run_id: Option<u64>,
    ) -> Result<JsonValue, String> {
        if let Err(err) = self.ensure_core_for_delay_test() {
            if let Some(run_id) = expected_run_id {
                fail_speed_test_if_current(&self.speed_test, run_id, err.clone(), now_secs());
            }
            return Err(err);
        }
        if let Some(run_id) = expected_run_id {
            if !speed_test_run_is_current(&self.speed_test, run_id) {
                return Ok(self.speed_test_snapshot());
            }
        }
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        if let Err(err) = speed_test_preflight(&targets) {
            if let Some(run_id) = expected_run_id {
                fail_speed_test_if_current(&self.speed_test, run_id, err.clone(), now_secs());
            }
            return Err(err);
        }
        let target = match targets
            .iter()
            .find(|target| target.name == name || target.select_name == name)
            .cloned()
        {
            Some(target) => target,
            None => {
                let message = format!("Node not found: {name}");
                if let Some(run_id) = expected_run_id {
                    fail_speed_test_if_current(
                        &self.speed_test,
                        run_id,
                        message.clone(),
                        now_secs(),
                    );
                }
                return Err(message);
            }
        };
        let controller = self.core_controller();
        let speed_test = self.speed_test.clone();
        let targets_for_recommendation = targets.clone();
        let speed_firewall_enabled =
            core_runtime::speed_test_firewall_enabled(self.settings.kill_switch_enabled);
        let speed_firewall_ports = core_runtime::speed_test_firewall_ports(
            speed_firewall_enabled,
            &self.speed_test_firewall_ports(),
        );
        let speed_firewall_app_data = self.app_data.clone();
        let speed_firewall_core_path = self.core_path.clone();
        let run_id;
        {
            let mut speed = speed_test.lock().unwrap();
            if let Some(expected_run_id) = expected_run_id {
                if speed.run_id != expected_run_id || !speed.running {
                    drop(speed);
                    return Ok(self.speed_test_snapshot());
                }
                run_id = expected_run_id;
            } else {
                run_id = speed.run_id.saturating_add(1);
            }
            speed.run_id = run_id;
            speed.running = true;
            speed.started_at = now_secs();
            speed.completed = 0;
            speed.total = 1;
            speed.ok = 0;
            speed.failed = 0;
            speed.delays.insert(target.name.clone(), 0);
            speed.error = None;
            speed.updated_at = now_secs();
        }
        let queued_group = target.group_name.clone();
        let queued_proxy = target.select_name.clone();
        let queued_real_proxy = target.name.clone();
        let queued_protocol = target.protocol.clone();
        thread::spawn(move || {
            let fail_single = |message: String| {
                let now = now_secs();
                let mut speed = speed_test.lock().unwrap();
                if speed.run_id != run_id {
                    return;
                }
                let health = update_node_health(
                    speed.health.get(&target.name),
                    &target.name,
                    &target.protocol,
                    -1,
                    &message,
                    now,
                );
                speed.delays.insert(target.name.clone(), -1);
                speed.health.insert(target.name.clone(), health);
                speed.failed = 1;
                speed.completed = 1;
                speed.running = false;
                speed.error = Some(message);
                speed.low_latency = low_latency_names(&speed.health, now);
                speed.recommended =
                    speed_recommendation(&targets_for_recommendation, &speed.health, now);
                speed.updated_at = now;
            };
            if speed_firewall_enabled {
                if let Err(err) = run_powershell(&build_speed_test_firewall_script(
                    true,
                    &speed_firewall_app_data,
                    &speed_firewall_core_path,
                    &speed_firewall_ports,
                )) {
                    fail_single(format!("protection-blocked: {err}"));
                    return;
                }
            }
            let cleanup_speed_firewall = || {
                if speed_firewall_enabled {
                    let _ = run_powershell(&build_speed_test_firewall_script(
                        false,
                        &speed_firewall_app_data,
                        &speed_firewall_core_path,
                        &speed_firewall_ports,
                    ));
                }
            };
            let client = match Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(6500))
                .build()
            {
                Ok(client) => client,
                Err(err) => {
                    fail_single(err.to_string());
                    cleanup_speed_firewall();
                    return;
                }
            };
            let result =
                test_proxy_delay_with_retry(&client, &controller, &target.name, &target.protocol);
            let now = now_secs();
            let mut speed = speed_test.lock().unwrap();
            if speed.run_id == run_id {
                let health = update_node_health(
                    speed.health.get(&target.name),
                    &target.name,
                    &target.protocol,
                    result.delay,
                    &result.failure_reason,
                    now,
                );
                speed.delays.insert(target.name.clone(), result.delay);
                speed.health.insert(target.name.clone(), health);
                speed.completed = 1;
                if result.delay > 0 {
                    speed.ok = 1;
                    speed.failed = 0;
                } else {
                    speed.ok = 0;
                    speed.failed = 1;
                }
                speed.running = false;
                speed.error = if result.delay > 0 {
                    None
                } else {
                    Some(result.failure_reason.clone())
                };
                speed.low_latency = low_latency_names(&speed.health, now);
                speed.recommended =
                    speed_recommendation(&targets_for_recommendation, &speed.health, now);
                speed.updated_at = now;
            }
            drop(speed);
            cleanup_speed_firewall();
        });
        Ok(json!({
            "ok": true,
            "queued": true,
            "runId": run_id,
            "group": queued_group,
            "proxy": queued_proxy,
            "realProxyName": queued_real_proxy,
            "protocol": queued_protocol,
            "delay": 0,
            "healthStatus": "testing",
            "healthConfidence": "testing"
        }))
    }

    fn probe_proxy_network(&self, timeout_ms: u64) -> JsonValue {
        if self.process.is_none() {
            return core_runtime::recovery_probe_result_json(false, "", 0, "core stopped");
        }
        let proxy_url = format!("http://127.0.0.1:{}", self.settings.mixed_port);
        let proxy = match reqwest::Proxy::all(&proxy_url) {
            Ok(proxy) => proxy,
            Err(err) => {
                return core_runtime::recovery_probe_result_json(false, "", 0, err.to_string())
            }
        };
        let client = match Client::builder()
            .no_proxy()
            .proxy(proxy)
            .timeout(Duration::from_millis(timeout_ms))
            .build()
        {
            Ok(client) => client,
            Err(err) => {
                return core_runtime::recovery_probe_result_json(false, "", 0, err.to_string())
            }
        };
        let mut last_error = "probe failed".to_string();
        for url in [
            "http://www.gstatic.com/generate_204",
            "https://www.gstatic.com/generate_204",
            "https://api.ipify.org",
        ] {
            match client.get(url).send() {
                Ok(res) => {
                    let status = res.status().as_u16();
                    if status < 500 {
                        return core_runtime::recovery_probe_result_json(true, url, status, "");
                    }
                    last_error = format!("HTTP {status}");
                }
                Err(err) => last_error = err.to_string(),
            }
        }
        core_runtime::recovery_probe_result_json(false, "", 0, last_error)
    }

    fn recovery_candidates(&self) -> Vec<(String, String, i64)> {
        let groups = self.proxy_groups();
        let plan = core_runtime::recovery_candidate_plan(
            &groups,
            self.settings.reliability_candidate_limit as usize,
        );
        let client = match Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(
                self.settings.reliability_max_delay_ms.saturating_add(1600),
            ))
            .build()
        {
            Ok(client) => client,
            Err(err) => {
                self.add_log(format!("Recovery delay client failed: {err}"), "warn");
                return Vec::new();
            }
        };
        let mut results = Vec::new();
        let max_delay = self.settings.reliability_max_delay_ms as i64;
        let controller = self.core_controller();
        for candidate in plan {
            let result = test_proxy_delay_with_retry(
                &client,
                &controller,
                &candidate.proxy_name,
                &candidate.protocol,
            );
            let delay = result.delay;
            if delay > 0 && delay <= max_delay {
                results.push((candidate.group_name, candidate.proxy_name, delay));
            }
        }
        results.sort_by_key(|(_, _, delay)| *delay);
        results
    }

    fn recovery_suggestions_from_groups(&self, groups: &JsonValue, limit: usize) -> Vec<JsonValue> {
        let speed = self.speed_test.lock().unwrap().clone();
        recovery_suggestions_from_snapshot(
            groups,
            &speed,
            self.settings.reliability_max_delay_ms,
            limit,
        )
    }

    fn recovery_suggestions(&self, limit: usize) -> Vec<JsonValue> {
        let groups = self.proxy_groups();
        self.recovery_suggestions_from_groups(&groups, limit)
    }

    fn try_recover_current_profile(&mut self) -> Result<Option<JsonValue>, String> {
        let candidates = self.recovery_candidates();
        for (group, proxy, delay) in candidates.into_iter().take(5) {
            self.add_log(
                format!("Recovery candidate: {group} -> {proxy} ({delay} ms)"),
                "info",
            );
            self.change_proxy(&group, &proxy)?;
            thread::sleep(Duration::from_millis(650));
            let probe = self.probe_proxy_network(6000);
            if probe.get("ok").and_then(|value| value.as_bool()) == Some(true) {
                return Ok(Some(core_runtime::recovery_switch_proxy_result_json(
                    group, proxy, delay, probe,
                )));
            }
            self.add_log(
                format!("Recovery candidate failed after switch: {group} -> {proxy}"),
                "warn",
            );
        }
        Ok(None)
    }

    fn recover_network(&mut self, force: bool) -> Result<JsonValue, String> {
        self.add_log("Reliability recovery requested", "info");
        if self.process.is_none() {
            self.start()?;
        }
        let before = self.probe_proxy_network(6000);
        if before.get("ok").and_then(|value| value.as_bool()) == Some(true) {
            self.reliability_failures = 0;
            return Ok(core_runtime::recovery_healthy_result_json(
                self.reliability_failures,
                before,
                json!(self.recovery_suggestions(5)),
                self.public_settings(),
            ));
        }
        self.reliability_failures = self.reliability_failures.saturating_add(1);
        if !force && self.reliability_failures < self.settings.reliability_failure_threshold {
            self.add_log(
                format!(
                    "Recovery observing failure {}/{}",
                    self.reliability_failures, self.settings.reliability_failure_threshold
                ),
                "warn",
            );
            return Ok(core_runtime::recovery_observe_result_json(
                self.reliability_failures,
                self.settings.reliability_failure_threshold,
                before,
                json!(self.recovery_suggestions(5)),
                self.public_settings(),
            ));
        }
        if let Some(result) = self.try_recover_current_profile()? {
            self.add_log("Reliability recovery switched proxy", "info");
            self.reliability_failures = 0;
            return Ok(core_runtime::recovery_proxy_switched_result_json(
                self.reliability_failures,
                result,
                json!(self.recovery_suggestions(5)),
                self.public_settings(),
            ));
        }
        if self.settings.reliability_profile_failover {
            let original_profile_id = self.settings.active_profile_id.clone();
            let profiles = json!(self.settings.profiles);
            let failover_plan =
                core_runtime::recovery_profile_failover_plan(&profiles, &original_profile_id);
            for candidate in failover_plan {
                let profile = self.set_active_profile(&candidate.id)?;
                self.add_log(format!("Recovery trying profile: {}", profile.name), "info");
                if let Some(result) = self.try_recover_current_profile()? {
                    self.add_log(
                        format!("Reliability recovery switched profile: {}", profile.name),
                        "info",
                    );
                    self.reliability_failures = 0;
                    return Ok(core_runtime::recovery_profile_switched_result_json(
                        self.reliability_failures,
                        json!(profile),
                        result,
                        json!(self.recovery_suggestions(5)),
                        self.public_settings(),
                    ));
                }
            }
            if self.settings.active_profile_id != original_profile_id {
                let _ = self.set_active_profile(&original_profile_id);
            }
        }
        Ok(core_runtime::recovery_failed_result_json(
            self.reliability_failures,
            before,
            json!(self.recovery_suggestions(5)),
            self.public_settings(),
        ))
    }

    fn change_proxy(&mut self, group: &str, proxy: &str) -> Result<bool, String> {
        let groups = self.proxy_groups();
        let preflight = validate_proxy_selection_from_groups(&groups, group, proxy)?;
        self.add_log(
            format!(
                "Node switch preflight passed: {} -> {} ({})",
                preflight
                    .get("group")
                    .and_then(JsonValue::as_str)
                    .unwrap_or(group),
                preflight
                    .get("proxy")
                    .and_then(JsonValue::as_str)
                    .unwrap_or(proxy),
                preflight
                    .get("groupType")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("")
            ),
            "info",
        );
        let previous = self
            .settings
            .selected_proxy_map
            .insert(group.to_string(), proxy.to_string());
        self.save_settings()?;
        if self.process.is_some() {
            if let Err(err) = self
                .core_controller()
                .apply_proxy_selection_with_cleanup(group, proxy)
            {
                match previous {
                    Some(value) => {
                        self.settings
                            .selected_proxy_map
                            .insert(group.to_string(), value);
                    }
                    None => {
                        self.settings.selected_proxy_map.remove(group);
                    }
                }
                let _ = self.save_settings();
                return Err(core_runtime::classified_error("Node switch", err));
            }
            let _ = self.sync_outbound_ip_group_selection();
        }
        Ok(true)
    }

    fn set_active_profile(&mut self, id: &str) -> Result<Profile, String> {
        let was_running = self.process.is_some();
        let previous_profile_id = self.settings.active_profile_id.clone();
        let profile = self
            .settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "Profile not found".to_string())?;
        self.add_log(
            format!(
                "Profile switch requested: {} -> {} ({}, path {}, running {was_running})",
                previous_profile_id, profile.id, profile.name, profile.path
            ),
            "info",
        );
        if previous_profile_id != id {
            self.reset_speed_test_state("profile switched; previous speed test cancelled", true);
        }
        self.preflight_profile_file(&profile).map_err(|err| {
            let message = format!(
                "Profile switch preflight failed for {} at {}: {err}",
                profile.name, profile.path
            );
            self.add_log(&message, "error");
            message
        })?;
        let rule_validation = routing_rule_validation_summary_for_profile(&profile);
        let warning_count = rule_validation
            .get("warningCount")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        if warning_count > 0 {
            self.add_log(
                format!(
                    "Profile switch rule validation warning: {} issue(s) in {}",
                    warning_count, profile.name
                ),
                "warn",
            );
        } else {
            self.add_log(
                format!("Profile switch rule validation passed: {}", profile.name),
                "info",
            );
        }
        self.settings.active_profile_id = id.to_string();
        self.save_settings()?;
        if was_running {
            let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
                self.settings.system_proxy,
                self.traffic_takeover,
                core_runtime::RUNTIME_RESTART_SETTLE_MS,
            );
            let apply_result = self.hot_reload_profile(&profile).or_else(|hot_err| {
                self.add_log(
                    format!("Profile hot reload failed; falling back to restart: {hot_err}"),
                    "warn",
                );
                self.restart_core_preserving_proxy(250)
            });
            if let Err(start_err) = apply_result {
                let _ = self.stop();
                self.settings.active_profile_id = previous_profile_id.clone();
                let save_result = self.save_settings();
                let rollback_result = if save_result.is_ok() {
                    self.start_from_restart_plan(rollback_plan).map(|_| ())
                } else {
                    save_result.map(|_| ())
                };
                let message = match rollback_result {
                    Ok(_) => format!(
                        "Profile switch failed and rolled back to {previous_profile_id}: {start_err}"
                    ),
                    Err(rollback_err) => format!(
                        "Profile switch failed: {start_err}; rollback to {previous_profile_id} also failed: {rollback_err}"
                    ),
                };
                self.add_log(&message, "error");
                return Err(message);
            }
        }
        self.add_log(
            format!(
                "Profile switch completed: {} ({})",
                profile.id, profile.name
            ),
            "info",
        );
        Ok(profile)
    }

    fn rename_profile(&mut self, id: &str, name: &str) -> Result<Profile, String> {
        let next_name = name.trim();
        if next_name.is_empty() {
            return Err("璁㈤槄鍚嶇О涓嶈兘涓虹┖".to_string());
        }
        if next_name.chars().count() > 80 {
            return Err("Profile name must be 80 characters or fewer.".to_string());
        }
        let profile = self
            .settings
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| "Profile not found".to_string())?;
        profile.name = next_name.to_string();
        let renamed = profile.clone();
        self.save_settings()?;
        self.add_log(
            format!("Profile renamed: {} -> {}", renamed.id, renamed.name),
            "info",
        );
        Ok(renamed)
    }

    fn remove_profile(&mut self, id: &str) -> Result<bool, String> {
        if id == "direct" {
            return Err("鍐呯疆鐩磋繛閰嶇疆涓嶈兘鍒犻櫎".to_string());
        }
        let was_running = self.process.is_some();
        let was_active = self.settings.active_profile_id == id;
        let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
            self.settings.system_proxy,
            self.traffic_takeover,
            core_runtime::RUNTIME_RESTART_SETTLE_MS,
        );
        let remove_path = self
            .settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .map(|profile| profile.path.clone());
        if was_running && was_active {
            self.stop()?;
        }
        if let Some(path) = remove_path {
            let _ = remove_file_confined(Path::new(&path), &self.profile_dir);
        }
        self.settings.profiles.retain(|p| p.id != id);
        if was_active {
            self.settings.active_profile_id = "direct".to_string();
        }
        self.save_settings()?;
        if was_running && was_active {
            self.start_from_restart_plan(rollback_plan)?;
        }
        Ok(true)
    }

    fn save_manual_node(&mut self, input: JsonValue) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "Import or enable a profile before adding a fixed node.".to_string())?;
        let node = normalize_manual_node(&input)?;
        let name = node
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "鍥哄畾鑺傜偣缂哄皯鍚嶇О".to_string())?
            .to_string();
        let original_name = input
            .get("originalName")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let previous_settings = self.settings.clone();
        let profile_nodes = self
            .settings
            .manual_nodes
            .entry(profile.id.clone())
            .or_default();
        if !original_name.is_empty() && original_name != name {
            profile_nodes.remove(&original_name);
        }
        profile_nodes.insert(name.clone(), node.clone());
        if let Err(err) = self.save_settings() {
            self.settings = previous_settings;
            return Err(format!("Fixed node save failed: {err}"));
        }
        if self.process.is_some() && self.settings.active_profile_id == profile.id {
            if let Err(err) = self.hot_reload_profile(&profile) {
                self.settings = previous_settings;
                let _ = self.save_settings();
                let message =
                    format!("Fixed node hot reload failed after save; rolled back: {err}");
                self.add_log(&message, "error");
                return Err(message);
            }
        }
        self.add_log(
            format!("Manual fixed node saved: {} / {}", profile.name, name),
            "info",
        );
        Ok(json!({
            "node": node,
            "profileId": profile.id,
            "settings": self.public_settings()
        }))
    }
}

fn recent_node_logs_from_snapshot(logs: &LogStore, node: &str, limit: usize) -> Vec<LogEntry> {
    let logs = logs.lock().unwrap();
    let mut items = logs
        .iter()
        .rev()
        .filter(|entry| log_matches_node(entry, node))
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    items.reverse();
    items
}

fn recovery_suggestions_from_snapshot(
    groups: &JsonValue,
    speed: &SpeedTestState,
    max_delay_ms: u64,
    limit: usize,
) -> Vec<JsonValue> {
    let targets = CoreManager::collect_proxy_targets(groups);
    let now = now_secs();
    let current_node = groups
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find_map(|group| group.get("now").and_then(|value| value.as_str()))
        })
        .unwrap_or("");
    let current_region = infer_node_region(current_node);
    let max_delay = max_delay_ms as i64;
    let mut suggestions = targets
        .into_iter()
        .filter_map(|target| {
            if target.name == current_node || target.select_name == current_node {
                return None;
            }
            let health = speed.health.get(&target.name)?;
            if health.last_delay <= 0 || health.last_delay > max_delay {
                return None;
            }
            let confidence = speed_result_confidence(
                health.last_delay,
                health.failure_streak,
                health.last_success_at,
                health.last_tested_at,
                health.cooldown_until,
                now,
            );
            if confidence == "failed" || confidence == "cooldown" {
                return None;
            }
            let region = infer_node_region(&target.name);
            let same_region = region == current_region && region != "GL";
            Some((
                if same_region { 0usize } else { 1usize },
                recovery_confidence_rank(&confidence),
                health.score,
                health.last_delay,
                json!({
                    "group": target.group_name,
                    "proxy": target.select_name,
                    "realProxyName": target.name,
                    "region": region,
                    "sameRegion": same_region,
                    "delay": health.last_delay,
                    "medianDelay": health.median_delay,
                    "jitter": health.jitter,
                    "confidence": confidence,
                    "score": health.score,
                    "requiresConfirmation": true,
                    "reason": if same_region { "same-region low-latency fallback" } else { "low-latency fallback" }
                }),
            ))
        })
        .collect::<Vec<_>>();
    suggestions.sort_by_key(|(same_region_rank, confidence_rank, score, delay, _)| {
        (*same_region_rank, *confidence_rank, *score, *delay)
    });
    suggestions
        .into_iter()
        .take(limit)
        .map(|(_, _, _, _, value)| value)
        .collect()
}

fn node_diagnostics_from_snapshot(
    name: String,
    groups: &JsonValue,
    speed: &SpeedTestState,
    logs: &LogStore,
    max_delay_ms: u64,
) -> Result<JsonValue, String> {
    let targets = CoreManager::collect_proxy_targets(groups);
    let target = targets
        .iter()
        .find(|target| target.name == name || target.select_name == name)
        .cloned()
        .ok_or_else(|| format!("Node not found: {name}"))?;
    let health = speed.health.get(&target.name).cloned();
    let logs = recent_node_logs_from_snapshot(logs, &target.name, 20);
    let last_failure = logs
        .iter()
        .rev()
        .find(|entry| entry.level == "warn" || entry.level == "error")
        .map(|entry| {
            json!({
                "level": entry.level,
                "category": entry.category,
                "line": entry.line,
                "classification": core_runtime::classify_failure_reason(&entry.line)
            })
        });
    let region = infer_node_region(&target.name);
    let suggestions = recovery_suggestions_from_snapshot(groups, speed, max_delay_ms, 8)
        .into_iter()
        .filter(|item| {
            item.get("region")
                .and_then(|value| value.as_str())
                .map(|value| value == region)
                .unwrap_or(false)
        })
        .take(5)
        .collect::<Vec<_>>();
    Ok(json!({
        "node": {
            "group": target.group_name,
            "proxy": target.select_name,
            "realProxyName": target.name,
            "protocol": target.protocol,
            "region": region
        },
        "health": health,
        "logs": logs,
        "lastFailure": last_failure,
        "suggestions": suggestions,
        "generatedAt": now_secs()
    }))
}

fn take_diagnostics_snapshot(core: Arc<Mutex<CoreManager>>) -> DiagnosticsSnapshot {
    let mut core = core.lock().unwrap();
    if let Some(reason) = core.reap_exited_core() {
        core.add_log(reason, "warn");
    }
    let speed_test = core.speed_test.lock().unwrap().clone();
    DiagnosticsSnapshot {
        settings: core.settings.clone(),
        active_profile: core.active_profile(),
        core_path: core.core_path.clone(),
        runtime_info: core.core_runtime_info(),
        proxy_snapshot_path: core.proxy_snapshot_path.clone(),
        running: core.process.is_some(),
        traffic_takeover: core.traffic_takeover,
        last_traffic: core.last_traffic.clone(),
        speed_test,
        lan_ip_cache: core.lan_ip_cache.clone(),
        outbound_ip_cache: core.cached_outbound_ip(),
        outbound_ip_checked_at: core.outbound_ip_checked_at,
        reliability_failures: core.reliability_failures,
        recent_logs: core.recent_logs(8),
        status_logs: core.recent_logs(120),
    }
}

fn diagnostics_speed_snapshot(speed: &SpeedTestState) -> JsonValue {
    json!({
        "running": speed.running,
        "startedAt": speed.started_at,
        "updatedAt": speed.updated_at,
        "total": speed.total,
        "completed": speed.completed,
        "ok": speed.ok,
        "failed": speed.failed,
        "error": speed.error,
        "delays": speed.delays,
        "health": speed.health,
        "lowLatency": speed.low_latency,
        "recommended": speed.recommended
    })
}

fn diagnostics_protection_status(snapshot: &DiagnosticsSnapshot) -> JsonValue {
    core_runtime::protection_status_json(
        snapshot.running,
        snapshot.traffic_takeover,
        snapshot.settings.kill_switch_enabled,
        snapshot.settings.tun_enabled,
        snapshot.settings.system_proxy,
    )
}

fn diagnostics_public_settings(snapshot: &DiagnosticsSnapshot) -> JsonValue {
    core_runtime::public_settings_surface_json(
        &snapshot.settings.active_profile_id,
        snapshot.settings.mixed_port,
        snapshot.settings.controller_port,
        json!(snapshot
            .settings
            .profiles
            .iter()
            .map(public_profile)
            .collect::<Vec<_>>()),
        snapshot.settings.start_with_system_proxy,
        snapshot.settings.system_proxy,
        snapshot.settings.kill_switch_enabled,
        snapshot.settings.tun_enabled,
        &snapshot.settings.tun_stack,
        snapshot.settings.dns_hijack_enabled,
        snapshot.settings.ipv6_enabled,
        snapshot.settings.allow_lan,
        &snapshot.settings.log_level,
        json!(&snapshot.settings.selected_proxy_map),
        json!(&snapshot.settings.manual_nodes),
        snapshot.settings.reliability_auto,
        snapshot.settings.reliability_profile_failover,
        snapshot.settings.reliability_failure_threshold,
        snapshot.settings.reliability_max_delay_ms,
        snapshot.settings.reliability_candidate_limit,
        snapshot.reliability_failures,
        snapshot.core_path.exists(),
        snapshot.running,
        snapshot.traffic_takeover,
        snapshot.proxy_snapshot_path.exists(),
    )
}

fn diagnostics_status_from_snapshot(snapshot: &DiagnosticsSnapshot, is_admin: bool) -> JsonValue {
    let lan_ip = if snapshot.lan_ip_cache.trim().is_empty() {
        "-".to_string()
    } else {
        snapshot.lan_ip_cache.clone()
    };
    let traffic = if snapshot.running {
        snapshot.last_traffic.clone()
    } else {
        core_runtime::idle_traffic_snapshot()
    };
    core_runtime::status_surface_json(
        snapshot.runtime_info.clone(),
        snapshot.running,
        snapshot.traffic_takeover,
        traffic,
        &snapshot.settings.mode,
        snapshot.settings.system_proxy,
        snapshot.settings.mixed_port,
        &lan_ip,
        &snapshot.outbound_ip_cache,
        is_admin,
        json!(snapshot.active_profile),
        diagnostics_speed_snapshot(&snapshot.speed_test),
        diagnostics_public_settings(snapshot),
        core_runtime::connection_status_json(
            snapshot.running,
            snapshot.traffic_takeover,
            snapshot.settings.system_proxy,
            snapshot.settings.tun_enabled,
        ),
        diagnostics_protection_status(snapshot),
        core_runtime::network_availability_json(
            snapshot.running,
            snapshot.traffic_takeover,
            &snapshot.outbound_ip_cache,
            snapshot.outbound_ip_checked_at,
            now_secs(),
        ),
        json!(snapshot.status_logs),
    )
}

fn diagnostics_from_snapshot(snapshot: DiagnosticsSnapshot) -> JsonValue {
    let is_admin = is_process_elevated();
    let admin_required = snapshot.settings.tun_enabled || snapshot.settings.kill_switch_enabled;
    let admin_ok = is_admin || !admin_required;
    let active_profile_path = snapshot
        .active_profile
        .as_ref()
        .map(|profile| PathBuf::from(&profile.path));
    let active_profile_exists = active_profile_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let profile_preflight = snapshot
        .active_profile
        .as_ref()
        .ok_or_else(|| "no active profile".to_string())
        .and_then(|profile| {
            let path = PathBuf::from(&profile.path);
            let raw = fs::read_to_string(&path).map_err(|err| {
                format!("Profile preflight read failed {}: {err}", path.display())
            })?;
            let source: YamlValue = serde_yaml::from_str(&raw).map_err(|err| {
                format!(
                    "Profile preflight YAML parse failed {}: {err}",
                    path.display()
                )
            })?;
            let runtime =
                config_pipeline::preflight_profile_source(source, profile, &snapshot.settings)?;
            Ok(format!(
                "{} proxies, {} groups, {} rules",
                runtime
                    .report
                    .get("proxies")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                runtime
                    .report
                    .get("proxyGroups")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                runtime
                    .report
                    .get("rules")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0)
            ))
        });
    let profile_preflight_ok = profile_preflight.is_ok();
    let profile_preflight_detail = profile_preflight.unwrap_or_else(|err| err);
    let runtime_dns_safety = snapshot
        .active_profile
        .as_ref()
        .ok_or_else(|| "no active profile".to_string())
        .and_then(|profile| {
            let path = PathBuf::from(&profile.path);
            let raw = fs::read_to_string(&path)
                .map_err(|err| format!("DNS preflight read failed {}: {err}", path.display()))?;
            let source: YamlValue = serde_yaml::from_str(&raw).map_err(|err| {
                format!("DNS preflight YAML parse failed {}: {err}", path.display())
            })?;
            let patched =
                config_pipeline::patch_profile_source(source, profile, &snapshot.settings)?;
            config_pipeline::runtime_dns_safety_report(&patched)
        });
    let runtime_dns_safety_ok = runtime_dns_safety.is_ok();
    let runtime_dns_safety_detail = runtime_dns_safety.unwrap_or_else(|err| err);
    let recent_error = snapshot.recent_logs.iter().rev().find(|entry| {
        matches!(entry.level.as_str(), "error" | "warn")
            || entry.line.to_ascii_lowercase().contains("error")
    });
    let recent_log_detail = if snapshot.recent_logs.is_empty() {
        "no recent core logs".to_string()
    } else {
        snapshot
            .recent_logs
            .iter()
            .map(|entry| format!("[{}] {}", entry.level, entry.line))
            .collect::<Vec<_>>()
            .join(" | ")
    };
    let recent_logs_ok = recent_error.is_none();
    let current_proxy = read_windows_proxy_snapshot();
    let proxy_takeover_integrity = core_runtime::proxy_takeover_integrity_json(
        snapshot.settings.system_proxy,
        snapshot.traffic_takeover,
        snapshot.proxy_snapshot_path.exists(),
        current_proxy.as_ref().ok(),
        current_proxy.as_ref().err().map(|err| err.as_str()),
        snapshot.settings.mixed_port,
    );
    let proxy_takeover_ok = proxy_takeover_integrity
        .get("ok")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let proxy_takeover_level = proxy_takeover_integrity
        .get("level")
        .and_then(JsonValue::as_str)
        .unwrap_or("warning");
    let proxy_takeover_detail = proxy_takeover_integrity
        .get("detail")
        .and_then(JsonValue::as_str)
        .unwrap_or("Windows system proxy state unavailable")
        .to_string();
    let proxy_takeover_action = proxy_takeover_integrity
        .get("action")
        .and_then(JsonValue::as_str)
        .unwrap_or("Use repair takeover or reconnect Aegos.")
        .to_string();
    let mixed_port_free = is_port_free(snapshot.settings.mixed_port);
    let controller_port_free = is_port_free(snapshot.settings.controller_port);
    let checks = vec![
        core_runtime::diagnostic_check_json(
            "mihomo core",
            snapshot.core_path.exists(),
            snapshot.core_path.to_string_lossy().to_string(),
            "error",
            "runtime",
            core_runtime::MISSING_RESOURCE_HINT,
        ),
        core_runtime::diagnostic_check_json(
            "Active profile config",
            active_profile_exists,
            active_profile_path
                .clone()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|| "no active profile".to_string()),
            "error",
            "profile",
            "The active profile config file does not exist. Switch to another profile or import the subscription again.",
        ),
        core_runtime::diagnostic_check_json(
            "Profile preflight",
            profile_preflight_ok,
            profile_preflight_detail,
            "error",
            "profile",
            "Profile preflight failed. Check subscription content, proxy-group references, and port settings first.",
        ),
        core_runtime::diagnostic_check_json(
            "Speed test DNS isolation",
            runtime_dns_safety_ok,
            runtime_dns_safety_detail,
            "error",
            "speed",
            "Speed-test DNS isolation is abnormal. Restart Aegos to regenerate runtime config; if it repeats, check DNS port conflicts.",
        ),
        core_runtime::diagnostic_check_json("Tauri shell", true, "Aegos".to_string(), "warning", "app", ""),
        core_runtime::diagnostic_check_json(
            "Administrator",
            admin_ok,
            if is_admin {
                "elevated".to_string()
            } else if admin_required {
                "not elevated; TUN and Disconnect protection require admin restart".to_string()
            } else {
                "not elevated; only required when TUN or Disconnect protection is enabled".to_string()
            },
            "warning",
            "permission",
            "TUN or disconnect protection requires restarting Aegos as administrator from settings.",
        ),
        core_runtime::diagnostic_check_json(
            "FlClash/Codex port isolation",
            snapshot.settings.mixed_port != 7890,
            format!(
                "Aegos mixed port: {}, reserved: 7890",
                snapshot.settings.mixed_port
            ),
            "error",
            "network",
            "Aegos must not use port 7890. Keep mixed port at 7891 or another free port to avoid FlClash/Codex conflicts.",
        ),
        core_runtime::diagnostic_check_json(
            "Controller port",
            snapshot.settings.controller_port != snapshot.settings.mixed_port,
            format!("127.0.0.1:{}", snapshot.settings.controller_port),
            "error",
            "network",
            "Controller port cannot equal the proxy port. Use 19091 or another free port in settings.",
        ),
        core_runtime::diagnostic_check_json(
            "System Proxy",
            true,
            if snapshot.settings.system_proxy {
                "enabled"
            } else {
                "disabled"
            }
            .to_string(),
            "warning",
            "network",
            "",
        ),
        core_runtime::diagnostic_check_json(
            "Mixed port availability",
            snapshot.running || mixed_port_free,
            port_owner_detail(snapshot.settings.mixed_port),
            "error",
            "network",
            "Aegos core is not running, but the mixed proxy port is already occupied. Change Aegos mixed port or close the conflicting proxy app.",
        ),
        core_runtime::diagnostic_check_json(
            "Controller port availability",
            snapshot.running || controller_port_free,
            port_owner_detail(snapshot.settings.controller_port),
            "error",
            "network",
            "Aegos core is not running, but the controller port is already occupied. Change Aegos controller port or close the conflicting app.",
        ),
        core_runtime::diagnostic_check_json(
            "Windows System Proxy takeover",
            proxy_takeover_ok,
            proxy_takeover_detail,
            if proxy_takeover_level == "error" {
                "error"
            } else {
                "warning"
            },
            "network",
            &proxy_takeover_action,
        ),
        core_runtime::diagnostic_check_json(
            "TUN",
            !snapshot.settings.tun_enabled || is_admin,
            if snapshot.settings.tun_enabled {
                "enabled"
            } else {
                "disabled"
            }
            .to_string(),
            "warning",
            "permission",
            "TUN is enabled but Aegos is not elevated. Restart as administrator from settings.",
        ),
        core_runtime::diagnostic_check_json(
            "Disconnect protection",
            !snapshot.settings.kill_switch_enabled || is_admin,
            if snapshot.settings.kill_switch_enabled {
                "enabled"
            } else {
                "disabled"
            }
            .to_string(),
            "warning",
            "permission",
            "Disconnect protection is enabled but Aegos is not elevated. Restart as administrator from settings.",
        ),
        core_runtime::diagnostic_check_json(
            "Recent core logs",
            recent_logs_ok,
            recent_log_detail,
            "warning",
            "logs",
            "Recent core logs contain warning/error entries. Open Logs for startup or proxy failure context.",
        ),
    ];
    let summary = core_runtime::diagnostic_summary_json(&checks);
    json!({
        "generatedAt": now_iso(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "status": diagnostics_status_from_snapshot(&snapshot, is_admin),
        "summary": summary,
        "checks": checks
    })
}

fn diagnostics_detached(core: Arc<Mutex<CoreManager>>) -> JsonValue {
    diagnostics_from_snapshot(take_diagnostics_snapshot(core))
}

fn add_profile_url_detached(
    core: Arc<Mutex<CoreManager>>,
    operations: Arc<Mutex<()>>,
    url: &str,
) -> Result<Profile, String> {
    let parsed = reqwest::Url::parse(url).map_err(|err| err.to_string())?;
    let (settings, profile_dir) = {
        let core = core.lock().unwrap();
        (core.settings.clone(), core.profile_dir.clone())
    };
    let source = download_profile_source_url_diagnostic(url)?;
    let summary = source.summary.clone();
    let id = format!("url-{}", now_iso());
    let path = profile_dir.join(format!("{id}.yaml"));
    let mut profile = Profile {
        id: id.clone(),
        name: parsed.host_str().unwrap_or("remote").to_string(),
        profile_type: "url".to_string(),
        path: path.to_string_lossy().to_string(),
        source_url: Some(url.to_string()),
        node_count: summary.proxies,
        proxy_group_count: summary.proxy_groups,
        updated_at: now_iso(),
        digest: String::new(),
    };
    let runtime = config_pipeline::preflight_profile_source(source.config, &profile, &settings)
        .map_err(|err| {
            subscription_diagnostic(
                "runtime-preflight",
                format!("runtime config preflight failed: {err}"),
                "the subscription was downloaded, but the generated Mihomo config is not runnable; check unsupported node fields or malformed proxy groups",
            )
        })?;
    let patched = runtime.config;
    atomic_write_text_confined(
        &path,
        &profile_dir,
        &serde_yaml::to_string(&patched).map_err(|err| err.to_string())?,
    )?;
    profile.digest = sha256_file(&path);
    {
        let _operation = lock_operation_queue(&operations, "addProfileUrl apply")?;
        let mut core = core.lock().unwrap();
        let was_running = core.process.is_some();
        let previous_profile_id = core.settings.active_profile_id.clone();
        let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
            core.settings.system_proxy,
            core.traffic_takeover,
            core_runtime::RUNTIME_RESTART_SETTLE_MS,
        );
        core.settings.profiles.push(profile.clone());
        core.settings.active_profile_id = id;
        if let Err(err) = core.save_settings() {
            core.settings.profiles.retain(|item| item.id != profile.id);
            core.settings.active_profile_id = previous_profile_id;
            let _ = remove_file_confined(&path, &profile_dir);
            return Err(err);
        }
        core.add_log(
            format!(
                "Profile imported: {} ({} nodes, {} groups, {} rules, {}, {} unsupported lines)",
                profile.name,
                summary.proxies,
                summary.proxy_groups,
                summary.rules,
                summary.format,
                summary.unsupported_lines
            ),
            "info",
        );
        if was_running {
            if let Err(start_err) = core.restart_core_preserving_proxy(250) {
                let _ = core.stop();
                core.settings.profiles.retain(|item| item.id != profile.id);
                core.settings.active_profile_id = previous_profile_id.clone();
                let _ = remove_file_confined(&path, &profile_dir);
                let save_result = core.save_settings();
                let rollback_result = if save_result.is_ok() {
                    core.start_from_restart_plan(rollback_plan).map(|_| ())
                } else {
                    save_result.map(|_| ())
                };
                return Err(match rollback_result {
                    Ok(_) => format!(
                        "Profile import applied but startup failed; rolled back to {previous_profile_id}: {start_err}"
                    ),
                    Err(rollback_err) => format!(
                        "Profile import startup failed: {start_err}; rollback to {previous_profile_id} also failed: {rollback_err}"
                    ),
                });
            }
        }
    }
    Ok(profile)
}

fn update_profile_detached(
    core: Arc<Mutex<CoreManager>>,
    operations: Arc<Mutex<()>>,
    id: &str,
) -> Result<Profile, String> {
    let (mut profile, settings) = {
        let core = core.lock().unwrap();
        let profile = core
            .settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "Profile not found".to_string())?;
        (profile, core.settings.clone())
    };
    let Some(url) = profile.source_url.clone() else {
        return Ok(profile);
    };
    let source = download_profile_source_url_diagnostic(&url)?;
    let summary = source.summary.clone();
    profile.node_count = summary.proxies;
    profile.proxy_group_count = summary.proxy_groups;
    let runtime = config_pipeline::preflight_profile_source(source.config, &profile, &settings)
        .map_err(|err| {
            subscription_diagnostic(
                "runtime-preflight",
                format!("runtime config preflight failed: {err}"),
                "the subscription was downloaded, but the generated Mihomo config is not runnable; the previous subscription is kept",
            )
        })?;
    let patched = runtime.config;
    let previous_profile = profile.clone();
    let profile_path = PathBuf::from(&profile.path);
    let previous_raw = fs::read_to_string(&profile_path).ok();
    let profile_root = profile_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("Profile path has no parent: {}", profile_path.display()))?;
    atomic_write_text_confined(
        &profile_path,
        &profile_root,
        &serde_yaml::to_string(&patched).map_err(|err| err.to_string())?,
    )?;
    profile.updated_at = now_iso();
    profile.digest = sha256_file(&profile_path);
    {
        let _operation = lock_operation_queue(&operations, "updateProfile apply")?;
        let mut core = core.lock().unwrap();
        let was_running = core.process.is_some();
        let was_active = core.settings.active_profile_id == id;
        let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
            core.settings.system_proxy,
            core.traffic_takeover,
            core_runtime::RUNTIME_RESTART_SETTLE_MS,
        );
        let Some(stored) = core.settings.profiles.iter_mut().find(|p| p.id == id) else {
            if let Some(raw) = previous_raw.as_ref() {
                let _ = atomic_write_text_confined(&profile_path, &profile_root, raw);
            }
            return Err("Profile was removed before update completed".to_string());
        };
        *stored = profile.clone();
        if let Err(err) = core.save_settings() {
            if let Some(raw) = previous_raw.as_ref() {
                let _ = atomic_write_text_confined(&profile_path, &profile_root, raw);
            }
            if let Some(stored) = core.settings.profiles.iter_mut().find(|p| p.id == id) {
                *stored = previous_profile.clone();
            }
            return Err(format!(
                "Profile update save failed; restored previous file: {err}"
            ));
        }
        core.add_log(
            format!(
                "Profile updated: {} ({} nodes, {} groups, {} rules, {}, {} unsupported lines)",
                profile.name,
                summary.proxies,
                summary.proxy_groups,
                summary.rules,
                summary.format,
                summary.unsupported_lines
            ),
            "info",
        );
        if was_running && was_active {
            if let Err(start_err) = core.restart_core_preserving_proxy(250) {
                let _ = core.stop();
                if let Some(raw) = previous_raw.as_ref() {
                    let _ = atomic_write_text_confined(&profile_path, &profile_root, raw);
                }
                if let Some(stored) = core.settings.profiles.iter_mut().find(|p| p.id == id) {
                    *stored = previous_profile.clone();
                }
                let save_result = core.save_settings();
                let rollback_result = if save_result.is_ok() {
                    core.start_from_restart_plan(rollback_plan).map(|_| ())
                } else {
                    save_result.map(|_| ())
                };
                return Err(match rollback_result {
                    Ok(_) => format!(
                        "Profile update applied but startup failed; restored previous subscription: {start_err}"
                    ),
                    Err(rollback_err) => format!(
                        "Profile update startup failed: {start_err}; restoring previous subscription also failed: {rollback_err}"
                    ),
                });
            }
        }
    }
    Ok(profile)
}

fn refresh_outbound_ip_detached(core: Arc<Mutex<CoreManager>>) -> Result<String, String> {
    let (mixed_port, query_generation, selected_proxy) = {
        let mut core = core.lock().unwrap();
        if core.process.is_none() {
            core.outbound_ip_cache = "-".to_string();
            core.outbound_ip_checked_at = now_secs();
            core.outbound_ip_query_generation = core.outbound_ip_query_generation.saturating_add(1);
            return Err("Core is not running; outbound IP cannot be queried.".to_string());
        }
        let selected_proxy = core.sync_outbound_ip_group_selection();
        core.outbound_ip_query_generation = core.outbound_ip_query_generation.saturating_add(1);
        (
            core.settings.mixed_port,
            core.outbound_ip_query_generation,
            selected_proxy,
        )
    };
    let ip = query_outbound_ip(mixed_port);
    let mut core = core.lock().unwrap();
    let current_proxy = {
        let groups = core.proxy_groups();
        core.current_outbound_ip_proxy_name(&groups)
    };
    if core.outbound_ip_query_generation != query_generation || current_proxy != selected_proxy {
        core.add_log(
            "Outbound IP refresh result ignored because the selected node changed.",
            "info",
        );
        let fallback = core.cached_outbound_ip();
        if fallback != "-" {
            return Ok(fallback);
        }
        return Err(
            "Outbound IP query expired after node changed; retrying will use the current node."
                .to_string(),
        );
    }
    core.outbound_ip_checked_at = now_secs();
    match ip {
        Ok(ip) => {
            core.outbound_ip_cache = ip.clone();
            core.add_log(format!("Outbound IP refreshed: {ip}"), "info");
            Ok(ip)
        }
        Err(reason) => {
            let fallback = core.outbound_ip_cache.trim().to_string();
            if !fallback.is_empty() && fallback != "-" {
                core.add_log(
                    format!(
                        "Outbound IP refresh failed; keeping cached value {fallback}: {reason}"
                    ),
                    "warn",
                );
                Ok(fallback)
            } else {
                core.add_log(&reason, "warn");
                Err(reason)
            }
        }
    }
}

fn update_all_profiles_detached(
    core: Arc<Mutex<CoreManager>>,
    operations: Arc<Mutex<()>>,
    jobs: JobStore,
    job_id: &str,
) -> Result<JsonValue, String> {
    let profile_ids = {
        let core = core.lock().unwrap();
        core.settings
            .profiles
            .iter()
            .filter(|profile| profile.source_url.is_some() && profile.profile_type != "builtin")
            .map(|profile| profile.id.clone())
            .collect::<Vec<_>>()
    };
    if profile_ids.is_empty() {
        return Err("No URL subscriptions to update".to_string());
    }
    let total = profile_ids.len() as u64;
    let mut updated = Vec::new();
    let mut failed = Vec::new();
    for (index, profile_id) in profile_ids.iter().enumerate() {
        if job_cancel_requested(&jobs, job_id) {
            finish_cancelled(&jobs, job_id, "cancelled");
            return Ok(json!({
                "updated": updated,
                "failed": failed,
                "cancelled": true
            }));
        }
        set_job_state(
            &jobs,
            job_id,
            "running",
            index as u64 + 1,
            total,
            &format!("updating {profile_id}"),
        );
        match update_profile_detached(core.clone(), operations.clone(), profile_id) {
            Ok(profile) => updated.push(profile),
            Err(err) => failed.push(json!({ "id": profile_id, "error": err })),
        }
    }
    if updated.is_empty() {
        return Err(format!(
            "All subscriptions failed to update: {}",
            failed.len()
        ));
    }
    Ok(json!({
        "updated": updated,
        "failed": failed,
        "total": total
    }))
}

fn lock_operation_queue<'a>(
    operations: &'a Arc<Mutex<()>>,
    label: &str,
) -> Result<std::sync::MutexGuard<'a, ()>, String> {
    operations
        .lock()
        .map_err(|_| format!("Operation queue poisoned while waiting for {label}"))
}

fn job_label(kind: &str) -> String {
    match kind {
        "addProfileUrl" => "瀵煎叆璁㈤槄",
        "renameProfile" => "Rename profile",
        "updateProfile" => "鏇存柊璁㈤槄",
        "recoverNetwork" => "缃戠粶鑷剤",
        "refreshOutboundIp" => "鍒锋柊钀藉湴 IP",
        "startCore" => "杩炴帴鏍稿績",
        "stopCore" => "鏂紑鏍稿績",
        "restartCore" => "閲嶅惎鏍稿績",
        "setActiveProfile" => "鍒囨崲璁㈤槄",
        "updateSettings" => "淇濆瓨璁剧疆",
        "updateSetting" => "淇濆瓨璁剧疆",
        "setMode" => "鍒囨崲妯″紡",
        "changeProxy" => "鍒囨崲鑺傜偣",
        "selectBestProxy" => "Switch to recommended",
        "applyRoutingDrafts" => "搴旂敤鍒嗘祦鑽夌",
        "undoRoutingApply" => "鎾ら攢鍒嗘祦搴旂敤",
        "applyRoutingGroupEdit" => "Edit strategy group",
        "applyRoutingRuleEdit" => "缂栬緫鐢ㄦ埛瑙勫垯",
        "exportDiagnostics" => "瀵煎嚭璇婃柇鎶ュ憡",
        _ => "鍚庡彴浠诲姟",
    }
    .to_string()
}

#[tauri::command]
fn start_job(
    state: State<AppState>,
    kind: String,
    payload: JsonValue,
) -> Result<JsonValue, String> {
    if !matches!(
        kind.as_str(),
        "addProfileUrl"
            | "updateProfile"
            | "renameProfile"
            | "updateAllProfiles"
            | "recoverNetwork"
            | "refreshOutboundIp"
            | "diagnostics"
            | "startCore"
            | "stopCore"
            | "restartCore"
            | "setActiveProfile"
            | "removeProfile"
            | "updateSettings"
            | "updateSetting"
            | "setMode"
            | "changeProxy"
            | "selectBestProxy"
            | "repairSystemProxy"
            | "applyRoutingDrafts"
            | "undoRoutingApply"
            | "applyRoutingGroupEdit"
            | "applyRoutingRuleEdit"
            | "exportDiagnostics"
    ) {
        return Err(format!("Unsupported job kind: {kind}"));
    }
    let id = format!("job-{}-{}", now_secs(), hex_random(4));
    let record = new_job_record(id.clone(), kind.clone(), job_label(&kind));

    state
        .jobs
        .lock()
        .unwrap()
        .insert(id.clone(), record.clone());

    let core = state.core.clone();
    let jobs = state.jobs.clone();
    let operations = state.operations.clone();
    let app_data = state.app_data.clone();
    thread::spawn(move || {
        set_job_state(&jobs, &id, "running", 0, 3, "姝ｅ湪鍑嗗");
        if job_cancel_requested(&jobs, &id) {
            finish_cancelled(&jobs, &id, "cancelled before start");
            return;
        }
        let result = match kind.as_str() {
            "addProfileUrl" => {
                let url = payload
                    .get("url")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing url".to_string())
                    .and_then(|url| {
                        set_job_state(&jobs, &id, "running", 1, 3, "姝ｅ湪涓嬭浇璁㈤槄");
                        add_profile_url_detached(core.clone(), operations.clone(), url)
                            .map(|profile| json!({ "profile": profile }))
                    });
                url
            }
            "updateProfile" => {
                let profile_id = payload
                    .get("id")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing profile id".to_string())
                    .and_then(|profile_id| {
                        set_job_state(&jobs, &id, "running", 1, 3, "姝ｅ湪鏇存柊璁㈤槄");
                        update_profile_detached(core.clone(), operations.clone(), profile_id)
                            .map(|profile| json!({ "profile": profile }))
                    });
                profile_id
            }
            "renameProfile" => {
                let result = payload
                    .get("id")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing profile id".to_string())
                    .and_then(|profile_id| {
                        let name = payload
                            .get("name")
                            .and_then(|value| value.as_str())
                            .ok_or_else(|| "Missing profile name".to_string())?;
                        set_job_state(&jobs, &id, "running", 1, 2, "Renaming profile");
                        let _operation = lock_operation_queue(&operations, "renameProfile")?;
                        core.lock()
                            .unwrap()
                            .rename_profile(profile_id, name)
                            .map(|profile| json!({ "profile": profile }))
                    });
                result
            }
            "updateAllProfiles" => {
                update_all_profiles_detached(core.clone(), operations.clone(), jobs.clone(), &id)
            }
            "refreshOutboundIp" => {
                set_job_state(&jobs, &id, "running", 1, 2, "姝ｅ湪鏌ヨ钀藉湴 IP");
                refresh_outbound_ip_detached(core.clone()).map(|ip| json!({ "ip": ip }))
            }
            "diagnostics" => {
                set_job_state(&jobs, &id, "running", 1, 2, "diagnostics running");
                Ok(diagnostics_detached(core.clone()))
            }
            "exportDiagnostics" => {
                set_job_state(&jobs, &id, "running", 1, 2, "姝ｅ湪瀵煎嚭璇婃柇鎶ュ憡");
                export_diagnostics_report_from_state(core.clone(), &app_data)
            }
            "recoverNetwork" => {
                let force = payload
                    .get("force")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                set_job_state(&jobs, &id, "running", 1, 4, "姝ｅ湪鎵ц缃戠粶鑷剤");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "recoverNetwork")?;
                    core.lock().unwrap().recover_network(force)
                })()
            }
            "startCore" => {
                set_job_state(&jobs, &id, "running", 1, 4, "姝ｅ湪鍚姩鏍稿績");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "startCore")?;
                    core.lock().unwrap().start()
                })()
            }
            "stopCore" => {
                set_job_state(&jobs, &id, "running", 1, 2, "姝ｅ湪鏂紑鏍稿績");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "stopCore")?;
                    core.lock().unwrap().stop()
                })()
            }
            "restartCore" => {
                set_job_state(&jobs, &id, "running", 1, 5, "姝ｅ湪閲嶅惎鏍稿績");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "restartCore")?;
                    let mut core = core.lock().unwrap();
                    core.restart_core_preserving_proxy(350)
                })()
            }
            "setActiveProfile" => {
                let profile_id = payload
                    .get("id")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing profile id".to_string())
                    .and_then(|profile_id| {
                        set_job_state(&jobs, &id, "running", 1, 4, "姝ｅ湪搴旂敤璁㈤槄");
                        let _operation = lock_operation_queue(&operations, "setActiveProfile")?;
                        core.lock()
                            .unwrap()
                            .set_active_profile(profile_id)
                            .map(|profile| json!({ "profile": profile }))
                    });
                profile_id
            }
            "removeProfile" => {
                let profile_id = payload
                    .get("id")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing profile id".to_string())
                    .and_then(|profile_id| {
                        set_job_state(&jobs, &id, "running", 1, 4, "removing profile");
                        let _operation = lock_operation_queue(&operations, "removeProfile")?;
                        core.lock()
                            .unwrap()
                            .remove_profile(profile_id)
                            .map(|removed| json!({ "removed": removed, "id": profile_id }))
                    });
                profile_id
            }
            "updateSettings" => {
                let updates = payload
                    .get("updates")
                    .cloned()
                    .unwrap_or_else(|| payload.clone());
                set_job_state(&jobs, &id, "running", 1, 4, "姝ｅ湪淇濆瓨璁剧疆");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "updateSettings")?;
                    core.lock()
                        .unwrap()
                        .update_settings(updates)
                        .map(|settings| json!({ "settings": settings }))
                })()
            }
            "updateSetting" => (|| -> Result<JsonValue, String> {
                let key = payload
                    .get("key")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing setting key".to_string())?;
                let value = payload
                    .get("value")
                    .cloned()
                    .ok_or_else(|| "Missing setting value".to_string())?;
                set_job_state(&jobs, &id, "running", 1, 3, "姝ｅ湪淇濆瓨璁剧疆");
                let _operation = lock_operation_queue(&operations, "updateSetting")?;
                let mut core = core.lock().unwrap();
                if key == "systemProxy" {
                    core.set_system_proxy(value.as_bool().unwrap_or(false))?;
                    Ok(json!({ "settings": core.public_settings() }))
                } else {
                    core.update_setting(key, value)
                        .map(|settings| json!({ "settings": settings }))
                }
            })(),
            "setMode" => {
                let mode = payload
                    .get("mode")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing mode".to_string())
                    .and_then(|mode| {
                        set_job_state(&jobs, &id, "running", 1, 2, "姝ｅ湪鍒囨崲妯″紡");
                        let _operation = lock_operation_queue(&operations, "setMode")?;
                        core.lock()
                            .unwrap()
                            .set_mode(mode)
                            .map(|mode| json!({ "mode": mode }))
                    });
                mode
            }
            "changeProxy" => (|| -> Result<JsonValue, String> {
                let group = payload
                    .get("group")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing proxy group".to_string())?;
                let proxy = payload
                    .get("proxy")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Missing proxy name".to_string())?;
                set_job_state(&jobs, &id, "running", 1, 2, "姝ｅ湪鍒囨崲鑺傜偣");
                let _operation = lock_operation_queue(&operations, "changeProxy")?;
                let mut core = core.lock().unwrap();
                core.change_proxy(group, proxy)?;
                let connection = core.connection_closure();
                Ok(json!({ "group": group, "proxy": proxy, "connection": connection }))
            })(),
            "selectBestProxy" => (|| -> Result<JsonValue, String> {
                set_job_state(&jobs, &id, "running", 1, 2, "selecting best proxy");
                let _operation = lock_operation_queue(&operations, "selectBestProxy")?;
                core.lock().unwrap().select_best_proxy()
            })(),
            "repairSystemProxy" => (|| -> Result<JsonValue, String> {
                set_job_state(
                    &jobs,
                    &id,
                    "running",
                    1,
                    3,
                    "repairing system proxy takeover",
                );
                let _operation = lock_operation_queue(&operations, "repairSystemProxy")?;
                core.lock().unwrap().repair_system_proxy_takeover()
            })(),
            "applyRoutingDrafts" => (|| -> Result<JsonValue, String> {
                let drafts_value = payload
                    .get("drafts")
                    .cloned()
                    .ok_or_else(|| "Missing routing drafts".to_string())?;
                let drafts = serde_json::from_value::<Vec<RoutingDraftInput>>(drafts_value)
                    .map_err(|err| format!("Invalid routing drafts: {err}"))?;
                set_job_state(&jobs, &id, "running", 1, 4, "姝ｅ湪棰勬鍒嗘祦鑽夌");
                let _operation = lock_operation_queue(&operations, "applyRoutingDrafts")?;
                core.lock().unwrap().apply_routing_drafts(drafts)
            })(),
            "undoRoutingApply" => (|| -> Result<JsonValue, String> {
                set_job_state(&jobs, &id, "running", 1, 3, "姝ｅ湪鎾ら攢鍒嗘祦搴旂敤");
                let _operation = lock_operation_queue(&operations, "undoRoutingApply")?;
                core.lock().unwrap().undo_last_routing_apply()
            })(),
            "applyRoutingGroupEdit" => (|| -> Result<JsonValue, String> {
                let edit = serde_json::from_value::<RoutingGroupEditInput>(payload.clone())
                    .map_err(|err| format!("Invalid routing group edit: {err}"))?;
                set_job_state(&jobs, &id, "running", 1, 4, "Saving strategy group");
                let _operation = lock_operation_queue(&operations, "applyRoutingGroupEdit")?;
                core.lock().unwrap().apply_routing_group_edit(edit)
            })(),
            "applyRoutingRuleEdit" => (|| -> Result<JsonValue, String> {
                let edit = serde_json::from_value::<RoutingRuleEditInput>(payload.clone())
                    .map_err(|err| format!("Invalid routing rule edit: {err}"))?;
                set_job_state(&jobs, &id, "running", 1, 4, "姝ｅ湪淇濆瓨鐢ㄦ埛瑙勫垯");
                let _operation = lock_operation_queue(&operations, "applyRoutingRuleEdit")?;
                core.lock().unwrap().apply_routing_rule_edit(edit)
            })(),
            _ => Err("Unsupported job kind".to_string()),
        };
        finish_job(&jobs, &id, result);
    });

    Ok(json!(record))
}

#[tauri::command]
fn job_status(state: State<AppState>, id: Option<String>) -> Result<JsonValue, String> {
    job_status_snapshot(&state.jobs, id)
}

#[tauri::command]
fn cancel_job(state: State<AppState>, id: String) -> Result<JsonValue, String> {
    request_job_cancel(&state.jobs, &id)
}

#[tauri::command]
fn app_status(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().status())
}

#[tauri::command]
fn core_runtime_info(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().core_runtime_info())
}

#[tauri::command]
fn update_settings(state: State<AppState>, updates: JsonValue) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "update_settings command")?;
    state.core.lock().unwrap().update_settings(updates)
}

#[tauri::command]
fn relaunch_as_admin(app: AppHandle) -> Result<bool, String> {
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let cwd = exe
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    run_powershell(&format!(
        "Start-Process -FilePath '{}' -WorkingDirectory '{}' -Verb RunAs",
        core_runtime::powershell_single_quote_escape(exe.to_string_lossy()),
        core_runtime::powershell_single_quote_escape(cwd.to_string_lossy())
    ))?;
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        app.exit(0);
    });
    Ok(true)
}

#[tauri::command]
fn proxy_groups(state: State<AppState>) -> Result<JsonValue, String> {
    let (running, controller, active_profile, selected_map, manual_names, speed) = {
        let core = state.core.lock().unwrap();
        let active_profile = core.active_profile();
        let manual_names = active_profile
            .as_ref()
            .and_then(|profile| core.settings.manual_nodes.get(&profile.id).cloned())
            .map(|nodes| nodes.keys().cloned().collect::<HashSet<_>>())
            .unwrap_or_default();
        let speed = core.speed_test.lock().unwrap().clone();
        (
            core.process.is_some(),
            core.core_controller(),
            active_profile,
            core.settings.selected_proxy_map.clone(),
            manual_names,
            speed,
        )
    };
    Ok(assemble_proxy_groups_snapshot(
        running,
        controller,
        active_profile,
        selected_map,
        manual_names,
        speed,
    ))
}

#[tauri::command]
fn preview_profile_groups(state: State<AppState>, id: String) -> Result<JsonValue, String> {
    let (profile, selected_map) = {
        let core = state.core.lock().unwrap();
        let profile = core
            .settings
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
            .ok_or_else(|| "Profile not found".to_string())?;
        (profile, core.settings.selected_proxy_map.clone())
    };
    Ok(profile_proxy_groups_for_profile_snapshot(
        &profile,
        &selected_map,
        false,
    ))
}

#[tauri::command]
fn profile_rule_validation(state: State<AppState>, id: String) -> Result<JsonValue, String> {
    let profile = {
        let core = state.core.lock().unwrap();
        core.settings
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
            .ok_or_else(|| "Profile not found".to_string())?
    };
    Ok(routing_rule_validation_summary_for_profile(&profile))
}

#[tauri::command]
fn routing_reload_preflight(
    state: State<AppState>,
    id: Option<String>,
) -> Result<JsonValue, String> {
    let (profile, runtime_preflight) = {
        let core = state.core.lock().unwrap();
        let profile = if let Some(id) = id.as_deref() {
            core.settings
                .profiles
                .iter()
                .find(|profile| profile.id == id)
                .cloned()
        } else {
            core.active_profile()
        }
        .ok_or_else(|| "Profile not found".to_string())?;
        let runtime_preflight = core.preflight_profile_file(&profile);
        (profile, runtime_preflight)
    };
    let rule_validation = routing_rule_validation_summary_for_profile(&profile);
    Ok(routing_reload_contract_from_parts(
        &profile,
        rule_validation,
        runtime_preflight,
    ))
}

#[tauri::command]
fn routing_rollback_plan(state: State<AppState>, id: Option<String>) -> Result<JsonValue, String> {
    let (
        profile,
        profile_digest,
        runtime_profile_id,
        runtime_config_digest,
        runtime_digest,
        running,
        traffic_takeover,
        selected_proxy_map_size,
    ) = {
        let core = state.core.lock().unwrap();
        let profile = if let Some(id) = id.as_deref() {
            core.settings
                .profiles
                .iter()
                .find(|profile| profile.id == id)
                .cloned()
        } else {
            core.active_profile()
        }
        .ok_or_else(|| "Profile not found".to_string())?;
        let profile_path = PathBuf::from(&profile.path);
        let profile_digest = profile_path.exists().then(|| sha256_file(&profile_path));
        let runtime_path = core.runtime_profile_path();
        let runtime_digest = runtime_path.exists().then(|| sha256_file(&runtime_path));
        (
            profile,
            profile_digest,
            core.runtime_profile_id.clone(),
            core.runtime_config_digest.clone(),
            runtime_digest,
            core.process.is_some(),
            core.traffic_takeover,
            core.settings.selected_proxy_map.len(),
        )
    };
    Ok(routing_rollback_plan_from_parts(
        &profile,
        profile_digest,
        runtime_profile_id,
        runtime_config_digest,
        runtime_digest,
        running,
        traffic_takeover,
        selected_proxy_map_size,
    ))
}

#[tauri::command]
fn routing_diagnostics_report(
    state: State<AppState>,
    id: Option<String>,
) -> Result<JsonValue, String> {
    let (
        profile,
        runtime_preflight,
        profile_digest,
        runtime_profile_id,
        runtime_config_digest,
        runtime_digest,
        running,
        traffic_takeover,
        selected_proxy_map_size,
    ) = {
        let core = state.core.lock().unwrap();
        let profile = if let Some(id) = id.as_deref() {
            core.settings
                .profiles
                .iter()
                .find(|profile| profile.id == id)
                .cloned()
        } else {
            core.active_profile()
        }
        .ok_or_else(|| "Profile not found".to_string())?;
        let runtime_preflight = core.preflight_profile_file(&profile);
        let profile_path = PathBuf::from(&profile.path);
        let profile_digest = profile_path.exists().then(|| sha256_file(&profile_path));
        let runtime_path = core.runtime_profile_path();
        let runtime_digest = runtime_path.exists().then(|| sha256_file(&runtime_path));
        (
            profile,
            runtime_preflight,
            profile_digest,
            core.runtime_profile_id.clone(),
            core.runtime_config_digest.clone(),
            runtime_digest,
            core.process.is_some(),
            core.traffic_takeover,
            core.settings.selected_proxy_map.len(),
        )
    };
    let rule_validation = routing_rule_validation_summary_for_profile(&profile);
    let reload_preflight =
        routing_reload_contract_from_parts(&profile, rule_validation.clone(), runtime_preflight);
    let rollback_plan = routing_rollback_plan_from_parts(
        &profile,
        profile_digest,
        runtime_profile_id,
        runtime_config_digest,
        runtime_digest,
        running,
        traffic_takeover,
        selected_proxy_map_size,
    );
    Ok(routing_diagnostics_report_from_parts(
        &profile,
        rule_validation,
        reload_preflight,
        rollback_plan,
    ))
}

#[tauri::command]
fn routing_foundation_acceptance(state: State<AppState>) -> Result<JsonValue, String> {
    let active_profile_id = {
        let core = state.core.lock().unwrap();
        core.active_profile().map(|profile| profile.id)
    };
    Ok(routing_foundation_acceptance_contract(active_profile_id))
}

#[tauri::command]
fn routing_assistant_gate() -> Result<JsonValue, String> {
    Ok(routing_assistant_gate_contract())
}

#[tauri::command]
fn apply_routing_drafts(
    state: State<AppState>,
    drafts: Vec<RoutingDraftInput>,
) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "apply_routing_drafts command")?;
    state.core.lock().unwrap().apply_routing_drafts(drafts)
}

#[tauri::command]
fn undo_last_routing_apply(state: State<AppState>) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "undo_last_routing_apply command")?;
    state.core.lock().unwrap().undo_last_routing_apply()
}

#[tauri::command]
fn start_proxy_delay_test(state: State<AppState>) -> Result<JsonValue, String> {
    let already_running = state.speed_test.lock().unwrap().running;
    let snapshot = mark_speed_test_preparing(&state.speed_test, now_secs());
    let run_id = snapshot
        .get("runId")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if already_running || run_id == 0 {
        return Ok(snapshot);
    }
    let core = state.core.clone();
    let speed_test = state.speed_test.clone();
    thread::spawn(move || {
        let result = core
            .lock()
            .unwrap()
            .start_proxy_delay_test_for_run(Some(run_id));
        if let Err(err) = result {
            fail_speed_test_if_current(&speed_test, run_id, err, now_secs());
        }
    });
    Ok(snapshot)
}

#[tauri::command]
fn test_single_proxy_delay(state: State<AppState>, name: String) -> Result<JsonValue, String> {
    let snapshot = mark_single_speed_test_preparing(&state.speed_test, &name, now_secs());
    let run_id = snapshot
        .get("runId")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if run_id == 0 {
        return Ok(snapshot);
    }
    let core = state.core.clone();
    let speed_test = state.speed_test.clone();
    let queued_name = name.clone();
    thread::spawn(move || {
        let result = core
            .lock()
            .unwrap()
            .test_single_proxy_delay_for_run(name, Some(run_id));
        if let Err(err) = result {
            fail_speed_test_if_current(&speed_test, run_id, err, now_secs());
        }
    });
    Ok(json!({
        "ok": true,
        "queued": true,
        "runId": run_id,
        "proxy": queued_name.clone(),
        "realProxyName": queued_name,
        "delay": 0,
        "healthStatus": "testing",
        "healthConfidence": "testing"
    }))
}

#[tauri::command]
fn node_diagnostics(state: State<AppState>, name: String) -> Result<JsonValue, String> {
    let logs = state.logs.clone();
    let (running, controller, active_profile, selected_map, manual_names, speed, max_delay_ms) = {
        let core = state.core.lock().unwrap();
        let active_profile = core.active_profile();
        let manual_names = active_profile
            .as_ref()
            .and_then(|profile| core.settings.manual_nodes.get(&profile.id).cloned())
            .map(|nodes| nodes.keys().cloned().collect::<HashSet<_>>())
            .unwrap_or_default();
        let speed = core.speed_test.lock().unwrap().clone();
        (
            core.process.is_some(),
            core.core_controller(),
            active_profile,
            core.settings.selected_proxy_map.clone(),
            manual_names,
            speed,
            core.settings.reliability_max_delay_ms,
        )
    };
    let groups = assemble_proxy_groups_snapshot(
        running,
        controller,
        active_profile,
        selected_map,
        manual_names,
        speed.clone(),
    );
    node_diagnostics_from_snapshot(name, &groups, &speed, &logs, max_delay_ms)
}

#[tauri::command]
fn speed_test_status(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(speed_test_runtime_snapshot(&state.speed_test, now_secs()))
}

#[tauri::command]
fn cancel_proxy_delay_test(state: State<AppState>) -> Result<JsonValue, String> {
    reset_speed_test_runtime_state(&state.speed_test, "cancelled", false, now_secs());
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn recover_network(state: State<AppState>, force: Option<bool>) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "recover_network command")?;
    state
        .core
        .lock()
        .unwrap()
        .recover_network(force.unwrap_or(false))
}

#[tauri::command]
fn refresh_outbound_ip(state: State<AppState>) -> Result<String, String> {
    refresh_outbound_ip_detached(state.core.clone())
}

#[tauri::command]
fn ipv6_dns_safety_snapshot(state: State<AppState>) -> Result<JsonValue, String> {
    let (running, mixed_port, settings, active_profile) = {
        let core = state.core.lock().unwrap();
        (
            core.process.is_some(),
            core.settings.mixed_port,
            core.settings.clone(),
            core.active_profile(),
        )
    };
    let local = local_ipv6_capability();
    let ipv4_outlet = if running {
        query_outbound_ip_family(mixed_port, "ipv4")
    } else {
        Err("core is not running".to_string())
    };
    let ipv6_outlet = if running {
        query_outbound_ip_family(mixed_port, "ipv6")
    } else {
        Err("core is not running".to_string())
    };
    let dns_safety = active_profile
        .as_ref()
        .ok_or_else(|| "no active profile".to_string())
        .and_then(|profile| {
            let path = PathBuf::from(&profile.path);
            let raw = fs::read_to_string(&path).map_err(|err| {
                format!("Profile preflight read failed {}: {err}", path.display())
            })?;
            let source: YamlValue = serde_yaml::from_str(&raw)
                .map_err(|err| format!("DNS safety YAML parse failed {}: {err}", path.display()))?;
            let patched = config_pipeline::patch_profile_source(source, profile, &settings)?;
            config_pipeline::runtime_dns_safety_report(&patched)
        });
    Ok(ipv6_dns_safety_from_parts(
        local,
        ipv4_outlet,
        ipv6_outlet,
        dns_safety,
        &settings,
        running,
    ))
}

#[tauri::command]
fn environment_readiness(state: State<AppState>) -> Result<JsonValue, String> {
    let (running, core_path, settings, traffic_takeover, proxy_snapshot_exists) = {
        let core = state.core.lock().unwrap();
        (
            core.process.is_some(),
            core.core_path.clone(),
            core.settings.clone(),
            core.traffic_takeover,
            core.proxy_snapshot_path.exists(),
        )
    };
    let is_admin = is_process_elevated();
    let mixed_port_ok = running || is_port_free(settings.mixed_port);
    let controller_port_ok = running || is_port_free(settings.controller_port);
    let current_proxy = read_windows_proxy_snapshot();
    let proxy_takeover_integrity = core_runtime::proxy_takeover_integrity_json(
        settings.system_proxy,
        traffic_takeover,
        proxy_snapshot_exists,
        current_proxy.as_ref().ok(),
        current_proxy.as_ref().err().map(|err| err.as_str()),
        settings.mixed_port,
    );
    let proxy_takeover_level = proxy_takeover_integrity
        .get("level")
        .and_then(JsonValue::as_str)
        .unwrap_or("warning");
    let mut checks = vec![
        json!({
            "id": "webview2",
            "label": "WebView2",
            "ok": true,
            "level": "ok",
            "detail": "Current WebView is running; the installer will show the WebView2 bootstrapper if needed.",
            "action": "Other Windows devices can run the installer directly and follow the WebView2 prompt if it appears."
        }),
        json!({
            "id": "admin",
            "label": "Administrator",
            "ok": is_admin || (!settings.tun_enabled && !settings.kill_switch_enabled),
            "level": if is_admin { "ok" } else if settings.tun_enabled || settings.kill_switch_enabled { "warn" } else { "info" },
            "detail": if is_admin { "Running as administrator" } else { "Running with normal permissions" },
            "action": if is_admin { "No action needed." } else { "Only TUN and disconnect protection require administrator permission; normal system proxy can continue." }
        }),
        json!({
            "id": "mixed-port",
            "label": "Proxy port",
            "ok": mixed_port_ok,
            "level": if mixed_port_ok { "ok" } else { "error" },
            "detail": port_owner_detail(settings.mixed_port),
            "action": if mixed_port_ok { "Port is available." } else { "Change the proxy port or close the conflicting app." }
        }),
        json!({
            "id": "controller-port",
            "label": "Controller port",
            "ok": controller_port_ok,
            "level": if controller_port_ok { "ok" } else { "error" },
            "detail": port_owner_detail(settings.controller_port),
            "action": if controller_port_ok { "Port is available." } else { "Change the controller port or close the conflicting app." }
        }),
        json!({
            "id": "controller-bind",
            "label": "Controller bind",
            "ok": !settings.allow_lan,
            "level": if settings.allow_lan { "warn" } else { "ok" },
            "detail": if settings.allow_lan { "allow-lan expands the listening surface." } else { "Controller is bound to 127.0.0.1 by default." },
            "action": if settings.allow_lan { "Turn off LAN access unless another device must connect." } else { "Keep the safer default." }
        }),
        json!({
            "id": "allow-lan",
            "label": "LAN access",
            "ok": !settings.allow_lan,
            "level": if settings.allow_lan { "warn" } else { "ok" },
            "detail": if settings.allow_lan { "LAN devices may access the proxy." } else { "LAN access is disabled." },
            "action": if settings.allow_lan { "Enable only when another device must connect." } else { "No action needed." }
        }),
        json!({
            "id": "core-resource",
            "label": "Core file",
            "ok": core_path.exists(),
            "level": if core_path.exists() { "ok" } else { "error" },
            "detail": core_path.to_string_lossy(),
            "action": if core_path.exists() { "Core resource exists." } else { core_runtime::MISSING_RESOURCE_HINT }
        }),
        json!({
            "id": "proxy-restore",
            "label": "System proxy takeover",
            "ok": proxy_takeover_integrity.get("ok").and_then(JsonValue::as_bool).unwrap_or(false),
            "level": if proxy_takeover_level == "error" { "error" } else if proxy_takeover_level == "warning" { "warn" } else { "ok" },
            "detail": proxy_takeover_integrity.get("detail").and_then(JsonValue::as_str).unwrap_or("Windows system proxy state unavailable"),
            "action": proxy_takeover_integrity.get("action").and_then(JsonValue::as_str).unwrap_or("Use repair takeover or reconnect Aegos.")
        }),
    ];
    checks.sort_by_key(|item| {
        match item
            .get("level")
            .and_then(JsonValue::as_str)
            .unwrap_or("info")
        {
            "error" => 0,
            "warn" => 1,
            "ok" => 2,
            _ => 3,
        }
    });
    let errors = checks
        .iter()
        .filter(|item| item.get("level").and_then(JsonValue::as_str) == Some("error"))
        .count();
    let warnings = checks
        .iter()
        .filter(|item| item.get("level").and_then(JsonValue::as_str) == Some("warn"))
        .count();
    Ok(json!({
        "generatedAt": now_iso(),
        "ok": errors == 0,
        "summary": {
            "errors": errors,
            "warnings": warnings,
            "total": checks.len(),
            "label": if errors > 0 { "Needs attention" } else if warnings > 0 { "Can improve" } else { "Environment OK" }
        },
        "checks": checks
    }))
}

#[tauri::command]
fn select_best_proxy(state: State<AppState>) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "select_best_proxy command")?;
    state.core.lock().unwrap().select_best_proxy()
}

#[tauri::command]
fn connections(state: State<AppState>) -> Result<JsonValue, String> {
    let (running, controller) = {
        let core = state.core.lock().unwrap();
        (core.process.is_some(), core.core_controller())
    };
    Ok(controller.ui_connections_snapshot_or_empty(running))
}

fn split_rule_segments(rule: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in rule.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            current.push(ch);
            escaped = true;
            continue;
        }
        if let Some(quote_ch) = quote {
            current.push(ch);
            if ch == quote_ch {
                quote = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' => {
                quote = Some(ch);
                current.push(ch);
            }
            '(' | '[' | '{' => {
                depth += 1;
                current.push(ch);
            }
            ')' | ']' | '}' => {
                depth = depth.saturating_sub(1);
                current.push(ch);
            }
            ',' if depth == 0 => {
                segments.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() || rule.ends_with(',') {
        segments.push(current.trim().to_string());
    }
    segments
}

fn is_rule_option_segment(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "no-resolve" | "resolve" | "src" | "dst" | "tcp" | "udp"
    ) || normalized.starts_with("interval=")
        || normalized.starts_with("udp=")
        || normalized.starts_with("tcp=")
}

fn rule_category(kind: &str) -> &'static str {
    match kind {
        "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "DOMAIN-REGEX" | "GEOSITE" => "domain",
        "IP-CIDR" | "IP-CIDR6" | "IP-ASN" | "GEOIP" | "SRC-IP-CIDR" => "ip",
        "PROCESS-NAME" | "PROCESS-PATH" | "PROCESS-PATH-REGEX" => "process",
        "RULE-SET" => "provider",
        "NETWORK" | "DST-PORT" | "SRC-PORT" | "IN-PORT" | "IN-TYPE" => "network",
        "MATCH" => "match",
        "AND" | "OR" | "NOT" | "SUB-RULE" => "logical",
        _ => "other",
    }
}

fn parse_routing_rule_text(index: usize, rule: &str) -> JsonValue {
    let segments = split_rule_segments(rule);
    let sanitized = sanitize_sensitive_text(rule);
    if segments.is_empty() || segments[0].trim().is_empty() {
        return json!({
            "index": index,
            "raw": sanitized,
            "kind": "INVALID",
            "category": "invalid",
            "condition": "-",
            "target": "-",
            "options": [],
            "status": "invalid",
            "note": "empty rule"
        });
    }
    let kind = segments[0].trim().to_ascii_uppercase();
    let mut target_index = if segments.len() <= 1 {
        None
    } else if kind == "MATCH" {
        Some(1)
    } else {
        Some(segments.len() - 1)
    };
    while let Some(index) = target_index {
        if index > 1 && is_rule_option_segment(&segments[index]) {
            target_index = Some(index - 1);
        } else {
            break;
        }
    }
    let target_index = target_index.unwrap_or(segments.len().saturating_sub(1));
    let condition = if kind == "MATCH" {
        "all traffic".to_string()
    } else if target_index > 1 {
        segments[1..target_index].join(",")
    } else {
        segments.get(1).cloned().unwrap_or_else(|| "-".to_string())
    };
    let target = segments
        .get(target_index)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| "-".to_string());
    let options = if target_index + 1 < segments.len() {
        segments[target_index + 1..]
            .iter()
            .map(|value| sanitize_sensitive_text(value))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let status = if target == "-" { "invalid" } else { "readonly" };
    let note = if options.is_empty() {
        "profile rule"
    } else {
        "profile rule with options"
    };
    json!({
        "index": index,
        "raw": sanitized,
        "kind": kind,
        "category": rule_category(&kind),
        "condition": sanitize_sensitive_text(&condition),
        "target": sanitize_sensitive_text(&target),
        "options": options,
        "status": status,
        "note": note
    })
}

fn parse_routing_rule_value(index: usize, value: &YamlValue) -> JsonValue {
    if let Some(rule) = value.as_str() {
        return parse_routing_rule_text(index, rule);
    }
    let raw = serde_yaml::to_string(value).unwrap_or_else(|_| "unsupported yaml rule".to_string());
    json!({
        "index": index,
        "raw": sanitize_sensitive_text(raw.trim()),
        "kind": "YAML",
        "category": "structured",
        "condition": "-",
        "target": "-",
        "options": [],
        "status": "unsupported",
        "note": "structured YAML rule is read-only and not editable yet"
    })
}

fn routing_rule_builtin_targets() -> HashSet<String> {
    [
        "DIRECT",
        "REJECT",
        "REJECT-DROP",
        "PASS",
        "COMPATIBLE",
        "GLOBAL",
    ]
    .iter()
    .map(|value| (*value).to_string())
    .collect()
}

fn routing_rule_target_catalog(config: &YamlValue) -> HashSet<String> {
    let mut targets = routing_rule_builtin_targets();
    for group in yaml_sequence(config, "proxy-groups")
        .into_iter()
        .flat_map(|items| items.iter())
    {
        if let Some(name) = yaml_mapping_name(group) {
            targets.insert(name.to_string());
        }
    }
    for proxy in yaml_sequence(config, "proxies")
        .into_iter()
        .flat_map(|items| items.iter())
    {
        if let Some(name) = yaml_mapping_name(proxy) {
            targets.insert(name.to_string());
        }
    }
    targets
}

fn routing_user_rules_path(app_data: &Path) -> PathBuf {
    app_data.join("routing-user-rules.json")
}

fn read_routing_user_rules(app_data: &Path) -> JsonValue {
    fs::read_to_string(routing_user_rules_path(app_data))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

fn write_routing_user_rules(app_data: &Path, value: &JsonValue) -> Result<(), String> {
    let path = routing_user_rules_path(app_data);
    let raw = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    atomic_write_text_confined(&path, app_data, &raw)
}

fn routing_user_rule_set(app_data: &Path, profile_id: &str) -> HashSet<String> {
    read_routing_user_rules(app_data)
        .get(profile_id)
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(|text| text.trim().to_string()))
        .filter(|value| !value.is_empty())
        .collect()
}

fn add_routing_user_rules(
    app_data: &Path,
    profile_id: &str,
    rules: &[String],
) -> Result<(), String> {
    if rules.is_empty() {
        return Ok(());
    }
    let mut registry = read_routing_user_rules(app_data);
    if !registry.is_object() {
        registry = json!({});
    }
    let Some(map) = registry.as_object_mut() else {
        return Ok(());
    };
    let entry = map
        .entry(profile_id.to_string())
        .or_insert_with(|| json!([]));
    if !entry.is_array() {
        *entry = json!([]);
    }
    let Some(items) = entry.as_array_mut() else {
        return Ok(());
    };
    let mut seen = items
        .iter()
        .filter_map(|value| value.as_str())
        .map(str::to_string)
        .collect::<HashSet<_>>();
    for rule in rules {
        let trimmed = rule.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            items.push(json!(trimmed));
        }
    }
    write_routing_user_rules(app_data, &registry)
}

fn replace_routing_user_rule(
    app_data: &Path,
    profile_id: &str,
    old_rule: Option<&str>,
    new_rule: Option<&str>,
) -> Result<(), String> {
    let mut registry = read_routing_user_rules(app_data);
    if !registry.is_object() {
        registry = json!({});
    }
    let Some(map) = registry.as_object_mut() else {
        return Ok(());
    };
    let entry = map
        .entry(profile_id.to_string())
        .or_insert_with(|| json!([]));
    if !entry.is_array() {
        *entry = json!([]);
    }
    let Some(items) = entry.as_array_mut() else {
        return Ok(());
    };
    if let Some(old_rule) = old_rule {
        items.retain(|value| value.as_str().map(str::trim) != Some(old_rule.trim()));
    }
    if let Some(new_rule) = new_rule.map(str::trim).filter(|value| !value.is_empty()) {
        let exists = items
            .iter()
            .any(|value| value.as_str().map(str::trim) == Some(new_rule));
        if !exists {
            items.push(json!(new_rule));
        }
    }
    write_routing_user_rules(app_data, &registry)
}

fn routing_rule_target(rule: &str) -> Option<String> {
    let mut parts = rule.split(',').map(str::trim);
    let kind = parts.next()?.to_ascii_uppercase();
    if matches!(kind.as_str(), "MATCH" | "FINAL") {
        return parts.next().map(str::to_string);
    }
    parts.next()?;
    parts.next().map(str::to_string)
}

fn routing_rule_replace_target(rule: &str, old_target: &str, new_target: &str) -> Option<String> {
    let mut parts = rule
        .split(',')
        .map(|part| part.trim().to_string())
        .collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }
    let target_index = if matches!(parts[0].to_ascii_uppercase().as_str(), "MATCH" | "FINAL") {
        1
    } else {
        2
    };
    if parts.get(target_index).map(String::as_str) != Some(old_target) {
        return None;
    }
    parts[target_index] = new_target.to_string();
    Some(parts.join(","))
}

fn validate_routing_group_type(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "select" | "selector" => Ok("select"),
        "url-test" | "urltest" => Ok("url-test"),
        "fallback" => Ok("fallback"),
        "load-balance" | "loadbalance" => Ok("load-balance"),
        other => Err(format!("Unsupported strategy group type: {other}")),
    }
}

fn validate_routing_group_members(
    values: &[String],
    targets: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let mut members = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let member = validate_routing_rule_part("strategy group member", value, 180)?;
        if !routing_rule_target_exists(targets, &member) {
            return Err(format!("Strategy group member does not exist: {member}"));
        }
        if seen.insert(member.clone()) {
            members.push(member);
        }
    }
    if members.is_empty() {
        return Err("Strategy group needs at least one node or group".to_string());
    }
    Ok(members)
}

fn mark_registered_user_routing_rules(rules: &mut [JsonValue], registry: &HashSet<String>) {
    for item in rules {
        let raw = item
            .get("raw")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        if raw.is_empty() || !registry.contains(raw) {
            continue;
        }
        if let Some(map) = item.as_object_mut() {
            map.insert("source".to_string(), json!("user"));
            map.insert("editable".to_string(), json!(true));
        }
    }
}

fn mark_last_applied_routing_rules(rules: &mut [JsonValue], metadata: Option<&JsonValue>) {
    let applied = metadata
        .and_then(|value| value.get("appliedRules"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(|text| text.trim().to_string()))
        .collect::<HashSet<_>>();
    if applied.is_empty() {
        return;
    }
    mark_registered_user_routing_rules(rules, &applied);
}

fn mark_system_routing_rules(rules: &mut [JsonValue]) {
    for item in rules {
        let target = item
            .get("target")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let condition = item
            .get("condition")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let system_rule = target == AEGOS_OUTBOUND_IP_GROUP
            || condition.contains("api.ipify.org")
            || condition.contains("api6.ipify.org")
            || condition.contains("checkip.amazonaws.com")
            || condition.contains("ifconfig.me")
            || condition.contains("icanhazip.com")
            || condition.contains("ident.me");
        if !system_rule {
            continue;
        }
        if let Some(map) = item.as_object_mut() {
            map.insert("source".to_string(), json!("system"));
            map.insert("editable".to_string(), json!(false));
            map.insert(
                "explanation".to_string(),
                json!("Aegos internal rule used to query the current node outbound IP; it is hidden from normal routing decisions and cannot be edited."),
            );
        }
    }
}

fn routing_rule_target_exists(targets: &HashSet<String>, target: &str) -> bool {
    targets.contains(target) || targets.contains(&target.to_ascii_uppercase())
}

fn validate_routing_rule_part(label: &str, value: &str, max_len: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} cannot be empty."));
    }
    if trimmed.len() > max_len {
        return Err(format!("{label} is too long. Shorten it and apply again."));
    }
    if trimmed.contains('\r')
        || trimmed.contains('\n')
        || trimmed.contains('\0')
        || trimmed.contains(',')
    {
        return Err(format!("{label} contains unsupported characters."));
    }
    Ok(trimmed.to_string())
}

fn normalize_routing_draft_rule(
    draft: &RoutingDraftInput,
    targets: &HashSet<String>,
) -> Result<(String, JsonValue), String> {
    let kind = draft.kind.trim().to_ascii_uppercase();
    let allowed = [
        "DOMAIN",
        "DOMAIN-SUFFIX",
        "DOMAIN-KEYWORD",
        "PROCESS-NAME",
        "PROCESS-PATH",
        "GEOIP",
        "GEOSITE",
        "IP-CIDR",
    ];
    if !allowed.contains(&kind.as_str()) {
        return Err(format!("Unsupported routing rule type: {kind}"));
    }
    let condition = validate_routing_rule_part("鍒嗘祦鏉′欢", &draft.condition, 220)?;
    let target = validate_routing_rule_part("鍒嗘祦鐩爣", &draft.target, 140)?;
    if !routing_rule_target_exists(targets, &target) {
        return Err(format!("鍒嗘祦鐩爣涓嶅瓨鍦細{target}"));
    }
    let option = draft
        .option
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(option) = option {
        if option != "no-resolve" {
            return Err(format!("Unsupported routing rule option: {option}"));
        }
        if !matches!(kind.as_str(), "GEOIP" | "IP-CIDR") {
            return Err("no-resolve only applies to GEOIP or IP-CIDR rules.".to_string());
        }
    }
    let rule = if let Some(option) = option {
        format!("{kind},{condition},{target},{option}")
    } else {
        format!("{kind},{condition},{target}")
    };
    Ok((
        rule.clone(),
        json!({
            "kind": kind,
            "condition": sanitize_sensitive_text(&condition),
            "target": sanitize_sensitive_text(&target),
            "option": option,
            "label": draft.label.as_deref().map(sanitize_sensitive_text).unwrap_or_else(|| rule.clone()),
            "source": draft.source.as_deref().unwrap_or("draft"),
            "rule": sanitize_sensitive_text(&rule),
            "status": "applied"
        }),
    ))
}

fn validate_routing_rule_targets(
    rules: &mut [JsonValue],
    targets: &HashSet<String>,
) -> Vec<String> {
    let mut missing = HashSet::new();
    let builtin_targets = routing_rule_builtin_targets();
    for rule in rules {
        let target = rule
            .get("target")
            .and_then(|value| value.as_str())
            .unwrap_or("-")
            .to_string();
        let builtin = target != "-" && builtin_targets.contains(&target.to_ascii_uppercase());
        let known = target != "-" && routing_rule_target_exists(targets, &target);
        if let Some(map) = rule.as_object_mut() {
            map.insert("targetExists".to_string(), json!(known));
            map.insert(
                "targetKind".to_string(),
                json!(if builtin {
                    "builtin"
                } else if known {
                    "profile-target"
                } else if target == "-" {
                    "none"
                } else {
                    "missing"
                }),
            );
            if !known && target != "-" {
                map.insert("status".to_string(), json!("missing-target"));
                map.insert(
                    "note".to_string(),
                    json!("target is not present in active profile"),
                );
                missing.insert(target);
            }
        }
    }
    let mut missing = missing.into_iter().collect::<Vec<_>>();
    missing.sort();
    missing
}

fn set_routing_rule_order_issue(
    rule: &mut JsonValue,
    kind: &str,
    detail: &str,
    first_index: Option<u64>,
) -> Option<JsonValue> {
    let index = rule
        .get("index")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let issue = json!({
        "index": index,
        "kind": kind,
        "detail": detail,
        "firstIndex": first_index
    });
    if let Some(map) = rule.as_object_mut() {
        let current_status = map
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("readonly");
        if current_status == "readonly" {
            map.insert("status".to_string(), json!(kind));
        }
        map.insert("orderIssue".to_string(), issue.clone());
        Some(issue)
    } else {
        None
    }
}

fn detect_routing_rule_order_issues(rules: &mut [JsonValue]) -> Vec<JsonValue> {
    let mut seen: HashMap<String, (u64, String)> = HashMap::new();
    let mut first_match_index: Option<u64> = None;
    let mut issues = Vec::new();
    for rule in rules {
        let index = rule
            .get("index")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let kind = rule
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("-");
        let condition = rule
            .get("condition")
            .and_then(|value| value.as_str())
            .unwrap_or("-");
        let target = rule
            .get("target")
            .and_then(|value| value.as_str())
            .unwrap_or("-");
        if let Some(match_index) = first_match_index {
            if index > match_index {
                if let Some(issue) = set_routing_rule_order_issue(
                    rule,
                    "unreachable-after-match",
                    "rule is after MATCH and will not be reached",
                    Some(match_index),
                ) {
                    issues.push(issue);
                }
                continue;
            }
        }
        let key = format!("{kind}\u{1f}{condition}");
        if let Some((first_index, first_target)) = seen.get(&key) {
            let kind = if first_target == target {
                "duplicate-rule"
            } else {
                "conflicting-target"
            };
            let detail = if first_target == target {
                "same matcher and target already appeared earlier"
            } else {
                "same matcher points to a different target earlier"
            };
            if let Some(issue) =
                set_routing_rule_order_issue(rule, kind, detail, Some(*first_index))
            {
                issues.push(issue);
            }
            continue;
        }
        seen.insert(key, (index, target.to_string()));
        if kind == "MATCH" {
            first_match_index = Some(index);
        }
    }
    issues
}

fn routing_rules_for_profile(
    profile: Option<&Profile>,
) -> (Vec<JsonValue>, Vec<String>, Vec<JsonValue>, Option<String>) {
    let Some(profile) = profile else {
        return (
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Some("no active profile".to_string()),
        );
    };
    let path = Path::new(&profile.path);
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) => {
            return (
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Some(format!(
                    "profile config read failed {}: {err}",
                    path.display()
                )),
            );
        }
    };
    let config: YamlValue = match serde_yaml::from_str(&raw) {
        Ok(config) => config,
        Err(err) => {
            return (
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Some(format!("profile YAML parse failed: {err}")),
            )
        }
    };
    let mut rules = yaml_sequence(&config, "rules")
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, value)| parse_routing_rule_value(index + 1, value))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let targets = routing_rule_target_catalog(&config);
    let missing_targets = validate_routing_rule_targets(&mut rules, &targets);
    let order_issues = detect_routing_rule_order_issues(&mut rules);
    (rules, missing_targets, order_issues, None)
}

fn routing_rule_validation_summary_for_profile(profile: &Profile) -> JsonValue {
    let (rules, missing_targets, order_issues, error) = routing_rules_for_profile(Some(profile));
    let warning_count = missing_targets.len() + order_issues.len();
    json!({
        "profileId": profile.id,
        "profileName": profile.name,
        "ok": error.is_none() && warning_count == 0,
        "ruleCount": rules.len(),
        "missingRuleTargets": missing_targets,
        "ruleOrderIssues": order_issues,
        "warningCount": warning_count,
        "error": error
    })
}

fn routing_reload_contract_from_parts(
    profile: &Profile,
    rule_validation: JsonValue,
    runtime_preflight: Result<JsonValue, String>,
) -> JsonValue {
    let runtime_ok = runtime_preflight.is_ok();
    let runtime_error = runtime_preflight.as_ref().err().cloned();
    let warning_count = rule_validation
        .get("warningCount")
        .and_then(JsonValue::as_u64)
        .unwrap_or(0);
    json!({
        "profileId": profile.id,
        "profileName": profile.name,
        "readOnly": true,
        "writesConfig": false,
        "hotReloadAllowed": runtime_ok,
        "requiresRollbackPlan": true,
        "runtimePreflightOk": runtime_ok,
        "runtimePreflight": runtime_preflight.ok(),
        "runtimeError": runtime_error,
        "ruleValidation": rule_validation,
        "warningCount": warning_count,
        "steps": [
            "parse active profile rules",
            "validate rule targets and order",
            "render patched runtime config in memory",
            "run runtime preflight before any write",
            "write through confined atomic replacement only after preflight",
            "reload mihomo with previous config rollback available"
        ],
        "rollback": {
            "required": true,
            "strategy": "restore previous profile file/runtime digest and restart or hot reload previous runtime",
            "systemState": "preserve traffic takeover, system proxy preference, and current selected node map"
        }
    })
}

fn routing_rollback_plan_from_parts(
    profile: &Profile,
    profile_digest: Option<String>,
    runtime_profile_id: Option<String>,
    runtime_config_digest: Option<String>,
    runtime_file_digest: Option<String>,
    running: bool,
    traffic_takeover: bool,
    selected_proxy_map_size: usize,
) -> JsonValue {
    let rollback_ready = profile_digest.is_some() && runtime_file_digest.is_some();
    json!({
        "profileId": profile.id,
        "profileName": profile.name,
        "readOnly": true,
        "writesConfig": false,
        "rollbackReady": rollback_ready,
        "requiresAtomicRestore": true,
        "profileDigest": profile_digest,
        "runtimeProfileId": runtime_profile_id,
        "runtimeConfigDigest": runtime_config_digest,
        "runtimeFileDigest": runtime_file_digest,
        "coreRunning": running,
        "trafficTakeover": traffic_takeover,
        "selectedProxyMapSize": selected_proxy_map_size as u64,
        "pathPolicy": {
            "profileWrites": "confined to profile_dir",
            "runtimeWrites": "confined to core home_dir",
            "writer": "atomic_write_text_confined"
        },
        "restoreSequence": [
            "cancel or finish active routing mutation task",
            "preserve current system proxy and traffic takeover flags",
            "restore previous profile file with atomic replacement",
            "restore previous runtime file with atomic replacement",
            "restore selected proxy map and active profile id",
            "hot reload previous runtime or restart core if needed",
            "verify controller version and active profile after rollback"
        ]
    })
}

fn json_array_len(value: &JsonValue, key: &str) -> u64 {
    value
        .get(key)
        .and_then(JsonValue::as_array)
        .map(|items| items.len() as u64)
        .unwrap_or(0)
}

fn routing_diagnostics_report_from_parts(
    profile: &Profile,
    rule_validation: JsonValue,
    reload_preflight: JsonValue,
    rollback_plan: JsonValue,
) -> JsonValue {
    let warning_count = rule_validation
        .get("warningCount")
        .and_then(JsonValue::as_u64)
        .unwrap_or(0);
    let missing_target_count = json_array_len(&rule_validation, "missingRuleTargets");
    let order_issue_count = json_array_len(&rule_validation, "ruleOrderIssues");
    let runtime_ok = reload_preflight
        .get("runtimePreflightOk")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let rollback_ready = rollback_plan
        .get("rollbackReady")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let severity = if !runtime_ok
        || rule_validation
            .get("error")
            .is_some_and(|value| !value.is_null())
    {
        "error"
    } else if warning_count > 0 || !rollback_ready {
        "warning"
    } else {
        "ok"
    };
    json!({
        "profileId": profile.id,
        "profileName": profile.name,
        "readOnly": true,
        "writesConfig": false,
        "severity": severity,
        "summary": {
            "ruleWarnings": warning_count,
            "missingRuleTargets": missing_target_count,
            "ruleOrderIssues": order_issue_count,
            "runtimePreflightOk": runtime_ok,
            "rollbackReady": rollback_ready
        },
        "sections": [
            {
                "id": "rules",
                "title": "Rule validation",
                "severity": if warning_count > 0 { "warning" } else { "ok" },
                "data": rule_validation
            },
            {
                "id": "runtime-preflight",
                "title": "Runtime preflight",
                "severity": if runtime_ok { "ok" } else { "error" },
                "data": reload_preflight
            },
            {
                "id": "rollback",
                "title": "Rollback plan",
                "severity": if rollback_ready { "ok" } else { "warning" },
                "data": rollback_plan
            },
            {
                "id": "next-actions",
                "title": "Suggested actions",
                "severity": severity,
                "data": [
                    "fix missing rule targets before enabling edits",
                    "resolve rule order warnings before hot reload",
                    "require rollbackReady before any future config write",
                    "keep routing diagnostics read-only until acceptance gate passes"
                ]
            }
        ]
    })
}

fn routing_foundation_acceptance_contract(active_profile_id: Option<String>) -> JsonValue {
    json!({
        "lane": "3.2 routing foundation",
        "activeProfileId": active_profile_id,
        "readOnly": true,
        "writesConfig": false,
        "editableRoutingEnabled": false,
        "requiresAllAuditsPassing": true,
        "acceptance": [
            "rules are parsed into structured records",
            "rule targets are validated against groups, proxies, and built-ins",
            "rule order risks are detected before activation",
            "profile switch validates rules before changing active profile",
            "reload preflight is available before future writes",
            "rollback plan is available before future writes",
            "diagnostics report combines rule, runtime, and rollback status"
        ],
        "requiredAudits": [
            "audit:routing-rules",
            "audit:routing-targets",
            "audit:routing-order",
            "audit:routing-profile-switch",
            "audit:routing-reload-preflight",
            "audit:routing-rollback",
            "audit:routing-diagnostics",
            "audit:routing-foundation"
        ],
        "nextGate": "3.3 editable routing design may start only after this source checkpoint passes release, smoke, and performance audits"
    })
}

fn routing_assistant_gate_contract() -> JsonValue {
    json!({
        "lane": "3.3 routing assistant",
        "readOnly": true,
        "writesConfig": false,
        "startsAt": "3.3.1",
        "dependsOn": "3.2 routing foundation acceptance",
        "ordinaryUserGoal": "users can create website, app, region, and strategy routing without YAML",
        "wizardSteps": [
            { "version": "3.3.1", "name": "Website routing wizard", "writeEnabled": false },
            { "version": "3.3.2", "name": "App routing wizard", "writeEnabled": false },
            { "version": "3.3.3", "name": "Generate rule from connection", "writeEnabled": false },
            { "version": "3.3.4", "name": "Region and strategy target wizard", "writeEnabled": false },
            { "version": "3.3.5", "name": "Rule conflict prompts", "writeEnabled": false },
            { "version": "3.3.6", "name": "One-click undo", "writeEnabled": false },
            { "version": "3.3.7", "name": "Rule effectiveness verification", "writeEnabled": false },
            { "version": "3.3.8", "name": "Simple and advanced rule separation", "writeEnabled": false },
            { "version": "3.3.9", "name": "Routing assistant acceptance", "writeEnabled": false }
        ],
        "writeEnableGate": [
            "draft model exists",
            "preflight passes",
            "rollback plan is ready",
            "diagnostics can explain failure",
            "release and smoke audits pass"
        ]
    })
}

#[tauri::command]
fn routing_snapshot(state: State<AppState>) -> Result<JsonValue, String> {
    let (running, controller, mode, groups, active_profile, last_apply) = {
        let core = state.core.lock().unwrap();
        (
            core.process.is_some(),
            core.core_controller(),
            core.settings.mode.clone(),
            core.proxy_groups(),
            core.active_profile(),
            core.routing_apply_metadata(),
        )
    };
    let group_rows =
        core_runtime::routing_group_rows(&groups, &[AEGOS_OUTBOUND_IP_GROUP, "GLOBAL"]);
    let recent_rules = controller.routing_recent_rule_hits_snapshot_or_empty(running);
    let (mut static_rules, missing_rule_targets, rule_order_issues, rule_error) =
        routing_rules_for_profile(active_profile.as_ref());
    if let Some(profile) = active_profile.as_ref() {
        let registry = routing_user_rule_set(&state.app_data, &profile.id);
        mark_registered_user_routing_rules(&mut static_rules, &registry);
    }
    mark_last_applied_routing_rules(&mut static_rules, last_apply.as_ref());
    mark_system_routing_rules(&mut static_rules);
    if !static_rules.iter().any(|item| {
        item.get("source").and_then(JsonValue::as_str) == Some("system")
            && item.get("target").and_then(JsonValue::as_str) == Some(AEGOS_OUTBOUND_IP_GROUP)
    }) {
        static_rules.push(json!({
            "index": 0,
            "raw": "Aegos internal outbound IP rules",
            "kind": "SYSTEM",
            "category": "system",
            "condition": "Outbound IP query domains",
            "target": AEGOS_OUTBOUND_IP_GROUP,
            "options": [],
            "status": "readonly",
            "source": "system",
            "editable": false,
            "explanation": "Aegos internal rule used to query the current node outbound IP; it is generated at runtime and cannot be edited."
        }));
    }
    let (group_count, auto_group_count) = core_runtime::routing_group_counts(&group_rows);
    let recent_rule_hits = recent_rules
        .as_array()
        .map(|items| items.len())
        .unwrap_or(0);
    let rule_count = static_rules.len();
    let user_rule_count = static_rules
        .iter()
        .filter(|item| item.get("source").and_then(JsonValue::as_str) == Some("user"))
        .count();
    let system_rule_count = static_rules
        .iter()
        .filter(|item| item.get("source").and_then(JsonValue::as_str) == Some("system"))
        .count();
    let config_rule_count = rule_count.saturating_sub(user_rule_count + system_rule_count);
    let missing_rule_target_count = missing_rule_targets.len();
    let rule_order_issue_count = rule_order_issues.len();
    Ok(json!({
        "readOnly": true,
        "mode": mode,
        "groups": group_rows,
        "rules": static_rules,
        "ruleError": rule_error,
        "missingRuleTargets": missing_rule_targets,
        "ruleOrderIssues": rule_order_issues,
        "recentRules": recent_rules,
        "lastApply": last_apply,
        "summary": {
            "groupCount": group_count,
            "autoGroupCount": auto_group_count,
            "recentRuleHits": recent_rule_hits,
            "ruleCount": rule_count,
            "userRuleCount": user_rule_count,
            "systemRuleCount": system_rule_count,
            "configRuleCount": config_rule_count,
            "missingRuleTargets": missing_rule_target_count,
            "ruleOrderIssues": rule_order_issue_count
        }
    }))
}

#[tauri::command]
fn active_connection_count(state: State<AppState>) -> Result<JsonValue, String> {
    let (running, controller) = {
        let core = state.core.lock().unwrap();
        (core.process.is_some(), core.core_controller())
    };
    Ok(controller.home_active_connection_count_snapshot_or_idle(running))
}

#[tauri::command]
fn close_connection(state: State<AppState>, id: String) -> Result<bool, String> {
    let (running, controller) = {
        let core = state.core.lock().unwrap();
        (core.process.is_some(), core.core_controller())
    };
    if !running {
        return Ok(true);
    }
    controller.close_connection_for_ui(&id)?;
    Ok(true)
}

#[tauri::command]
fn close_connections(state: State<AppState>) -> Result<bool, String> {
    let (running, controller) = {
        let core = state.core.lock().unwrap();
        (core.process.is_some(), core.core_controller())
    };
    if !running {
        return Ok(true);
    }
    controller.close_all_connections_for_ui()?;
    Ok(true)
}

#[tauri::command]
fn add_profile_url(state: State<AppState>, url: String) -> Result<Profile, String> {
    add_profile_url_detached(state.core.clone(), state.operations.clone(), &url)
}

#[tauri::command]
fn update_profile(state: State<AppState>, id: String) -> Result<Profile, String> {
    update_profile_detached(state.core.clone(), state.operations.clone(), &id)
}

#[tauri::command]
fn set_active_profile(state: State<AppState>, id: String) -> Result<Profile, String> {
    let _operation = lock_operation_queue(&state.operations, "set_active_profile command")?;
    state.core.lock().unwrap().set_active_profile(&id)
}

#[tauri::command]
fn remove_profile(state: State<AppState>, id: String) -> Result<bool, String> {
    let _operation = lock_operation_queue(&state.operations, "remove_profile command")?;
    state.core.lock().unwrap().remove_profile(&id)
}

#[tauri::command]
fn save_manual_node(state: State<AppState>, node: JsonValue) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "save_manual_node command")?;
    state.core.lock().unwrap().save_manual_node(node)
}

#[tauri::command]
fn diagnostics(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(diagnostics_detached(state.core.clone()))
}

#[tauri::command]
fn clear_logs(state: State<AppState>) -> Result<bool, String> {
    state.logs.lock().unwrap().clear();
    Ok(true)
}

#[tauri::command]
fn export_logs(state: State<AppState>) -> Result<JsonValue, String> {
    export_logs_from_state(&state.logs, &state.app_data)
}

#[tauri::command]
fn export_diagnostics_report(state: State<AppState>) -> Result<JsonValue, String> {
    export_diagnostics_report_from_state(state.core.clone(), &state.app_data)
}

#[tauri::command]
fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|err| err.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: Window) -> Result<(), String> {
    if window.is_maximized().map_err(|err| err.to_string())? {
        window.unmaximize().map_err(|err| err.to_string())
    } else {
        window.maximize().map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn window_close(window: Window, state: State<AppState>) -> Result<(), String> {
    state.core.lock().unwrap().shutdown_for_exit();
    window.close().map_err(|err| err.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let core = CoreManager::new(&app.handle())?;
            let speed_test = core.speed_test.clone();
            let logs = core.logs.clone();
            let app_data = core.app_data.clone();
            app.manage(AppState {
                core: Arc::new(Mutex::new(core)),
                speed_test,
                logs,
                app_data,
                jobs: Arc::new(Mutex::new(HashMap::new())),
                operations: Arc::new(Mutex::new(())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_job,
            job_status,
            cancel_job,
            app_status,
            core_runtime_info,
            update_settings,
            relaunch_as_admin,
            proxy_groups,
            preview_profile_groups,
            profile_rule_validation,
            routing_reload_preflight,
            routing_rollback_plan,
            routing_diagnostics_report,
            routing_foundation_acceptance,
            routing_assistant_gate,
            apply_routing_drafts,
            undo_last_routing_apply,
            start_proxy_delay_test,
            test_single_proxy_delay,
            node_diagnostics,
            speed_test_status,
            cancel_proxy_delay_test,
            recover_network,
            refresh_outbound_ip,
            ipv6_dns_safety_snapshot,
            environment_readiness,
            select_best_proxy,
            connections,
            routing_snapshot,
            active_connection_count,
            close_connection,
            close_connections,
            add_profile_url,
            update_profile,
            set_active_profile,
            remove_profile,
            save_manual_node,
            diagnostics,
            clear_logs,
            export_logs,
            export_diagnostics_report,
            window_minimize,
            window_toggle_maximize,
            window_close
        ])
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                let state = window.state::<AppState>();
                state.core.lock().unwrap().shutdown_for_exit();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Aegos");
}
