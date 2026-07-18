#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config_deployment;
mod config_domain;
mod config_pipeline;
mod core_domain;
mod core_runtime;
mod diagnostics_runtime;
mod profile_compiler;
mod routing_domain;
mod routing_store;
mod speed_runtime;
mod speed_scheduler;
mod subscription_runtime;
mod system_takeover;
mod task_runtime;

#[cfg(test)]
use base64::{engine::general_purpose, Engine as _};
use config_domain::ManualNodeConfig;
use core_domain::{ProxyCatalog, TrafficSnapshot};
use diagnostics_runtime::{logs_export_document, LogEntry, LogStore};
use rand::random;
use reqwest::blocking::Client;
use routing_domain::{
    RoutingDraftInput, RoutingGroupAction, RoutingGroupEditInput, RoutingRuleAction,
    RoutingRuleEditInput, UnboundRuleResolutionInput,
};
use routing_store::{UserRuleRecord, UserRuleScope, UserRuleStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use serde_yaml::{Mapping, Value as YamlValue};
use sha2::{Digest, Sha256};
use speed_runtime::{
    fail_speed_test_if_current, mark_single_speed_test_preparing, mark_speed_test_preparing,
    reset_speed_test_state as reset_speed_test_runtime_state, speed_result_confidence,
    speed_test_progress_snapshot, speed_test_run_is_current,
    speed_test_snapshot as speed_test_runtime_snapshot, NodeHealth, SpeedTestState, SpeedTestStore,
};
use speed_scheduler::{run_probe_wave, ProbeOutcome, SchedulerPolicy};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{BufRead, BufReader, Write},
    net::{IpAddr, Ipv4Addr, TcpListener, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use subscription_runtime::ProfileSourceSummary;
use task_runtime::{
    finish_cancelled, finish_job, job_cancel_requested, job_status_snapshot, new_job_record,
    request_job_cancel, set_job_issue, set_job_state, JobStore,
};
use tauri::{AppHandle, Emitter, Manager, State, Window, WindowEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const AEGOS_DEFAULT_MIXED_PORT: u16 = 7891;
const AEGOS_DEFAULT_CONTROLLER_PORT: u16 = 19091;
const AEGOS_OUTBOUND_IP_GROUP: &str = "Aegos Landing IP";
const OUTBOUND_IP_RULE_PRIMARY_GROUPS: &[&str] = &["Final", "Proxy", "Proxies", "GLOBAL"];
const OUTBOUND_IP_GLOBAL_PRIMARY_GROUPS: &[&str] = &["GLOBAL", "Proxies", "Proxy", "Final"];
const AEGOS_SUBSCRIPTION_USER_AGENT: &str = concat!("Aegos/", env!("CARGO_PKG_VERSION"));
const FLCLASH_STYLE_TEST_URL: &str = "https://www.gstatic.com/generate_204";
const SPEED_TEST_EVENT: &str = "aegos-speed-test";
const RUNTIME_STATUS_EVENT: &str = "aegos-runtime-status";
const SPEED_GLOBAL_CONCURRENCY_INITIAL: usize = 48;
const SPEED_GLOBAL_CONCURRENCY_MIN: usize = 24;
const SPEED_GLOBAL_CONCURRENCY_MAX: usize = 64;
const SPEED_ADAPTIVE_WINDOW: usize = 8;
const SPEED_REFINE_CONCURRENCY_INITIAL: usize = 8;
const SPEED_REFINE_CONCURRENCY_MIN: usize = 4;
const SPEED_REFINE_CONCURRENCY_MAX: usize = 12;
const OUTBOUND_IP_RULE_DOMAINS: &[&str] = &[
    "api.ipify.org",
    "api64.ipify.org",
    "checkip.amazonaws.com",
    "ident.me",
    "ifconfig.me",
    "icanhazip.com",
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

#[derive(Clone, Copy, PartialEq, Eq)]
struct ProfileYamlFingerprint {
    bytes: u64,
    modified_nanos: u128,
}

#[derive(Clone)]
struct RoutingRulesProfileSnapshot {
    rules: Vec<JsonValue>,
    missing_targets: Vec<String>,
    order_issues: Vec<JsonValue>,
}

#[derive(Clone)]
struct CachedProfileYaml {
    fingerprint: ProfileYamlFingerprint,
    value: Arc<YamlValue>,
    routing_rules: Option<RoutingRulesProfileSnapshot>,
}

// Node and rules snapshots inspect the same subscription file. Keep one
// verified, read-only parse per on-disk version so opening Rules does not
// parse a large subscription a second time after Nodes already did so.
static PROFILE_YAML_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedProfileYaml>>> = OnceLock::new();

fn profile_yaml_fingerprint(path: &Path) -> Result<ProfileYamlFingerprint, String> {
    let metadata = fs::metadata(path).map_err(|err| format!("profile metadata read failed: {err}"))?;
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    Ok(ProfileYamlFingerprint {
        bytes: metadata.len(),
        modified_nanos,
    })
}

fn cached_profile_yaml(path: &Path) -> Result<Arc<YamlValue>, String> {
    let fingerprint = profile_yaml_fingerprint(path)?;
    let cache = PROFILE_YAML_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = cache.lock() {
        if let Some(entry) = entries.get(path) {
            if entry.fingerprint == fingerprint {
                return Ok(entry.value.clone());
            }
        }
    }
    let raw = fs::read_to_string(path).map_err(|err| format!("profile file read failed: {err}"))?;
    let value: Arc<YamlValue> = Arc::new(
        serde_yaml::from_str(&raw).map_err(|err| format!("profile YAML parse failed: {err}"))?,
    );
    if let Ok(mut entries) = cache.lock() {
        entries.insert(
            path.to_path_buf(),
            CachedProfileYaml {
                fingerprint,
                value: value.clone(),
                routing_rules: None,
            },
        );
    }
    Ok(value)
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
    manual_nodes: HashMap<String, HashMap<String, ManualNodeConfig>>,
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
struct SpeedTargetCatalog {
    key: String,
    profile_id: String,
    targets: Vec<SpeedTestTarget>,
    built_at_ms: u64,
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
            .get("title")
            .or_else(|| item.get("name"))
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
        let code = item
            .get("code")
            .and_then(JsonValue::as_str)
            .unwrap_or("AEG-UNK-000");
        let category = item
            .get("category")
            .and_then(JsonValue::as_str)
            .unwrap_or("connection");
        lines.push(format!(
            "[{}] [{}] [{}] {}: {}",
            severity,
            code,
            category,
            sanitize_sensitive_text(name),
            if ok { "ok" } else { "failed" }
        ));
        lines.push(format!("  detail: {}", sanitize_sensitive_text(detail)));
        if !hint.is_empty() {
            lines.push(format!("  action: {}", sanitize_sensitive_text(hint)));
        }
    }
    lines.push(String::new());
    lines.push("Recent evidence (redacted):".to_string());
    let evidence = report
        .get("evidenceLogs")
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default();
    if evidence.is_empty() {
        lines.push("- No recent evidence logs.".to_string());
    } else {
        for entry in evidence {
            let at = entry.get("at").and_then(JsonValue::as_str).unwrap_or("-");
            let level = entry
                .get("level")
                .and_then(JsonValue::as_str)
                .unwrap_or("info");
            let category = entry
                .get("category")
                .and_then(JsonValue::as_str)
                .unwrap_or("runtime");
            let line = entry.get("line").and_then(JsonValue::as_str).unwrap_or("-");
            lines.push(format!(
                "- {} [{}:{}] {}",
                at,
                level,
                category,
                sanitize_sensitive_text(line)
            ));
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
    let config_value = cached_profile_yaml(Path::new(&profile.path))
        .unwrap_or_else(|_| Arc::new(YamlValue::Mapping(Mapping::new())));
    let mut config = match config_value.as_ref().clone() {
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

fn apply_speed_test_delays_from_state(catalog: &mut ProxyCatalog, speed: &SpeedTestState) {
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
    for item in catalog.nodes_mut() {
        let name = if item.real_proxy_name.is_empty() {
            item.name.clone()
        } else {
            item.real_proxy_name.clone()
        };
        if let Some(delay) = speed.delays.get(&name).copied() {
            item.delay = delay;
            item.alive = delay >= 0;
        }
        if let Some(health) = speed.health.get(&name) {
            item.health_status = health.status.clone();
            item.health_confidence = speed_result_confidence(
                health.last_delay,
                health.failure_streak,
                health.last_success_at,
                health.last_tested_at,
                health.cooldown_until,
                now,
            );
            item.last_tested_at = health.last_tested_at;
            item.last_success_at = health.last_success_at;
            item.result_age_secs = if health.last_success_at > 0 {
                now.saturating_sub(health.last_success_at)
            } else if health.last_tested_at > 0 {
                now.saturating_sub(health.last_tested_at)
            } else {
                0
            };
            item.median_delay = health.median_delay;
            item.jitter = health.jitter;
            item.failure_streak = health.failure_streak;
            item.last_failure_reason = health.last_failure_reason.clone();
            item.health_score = health.score;
            item.cooldown_until = health.cooldown_until;
            item.recommended = recommended_name.as_deref() == Some(name.as_str())
                && health.last_delay > 0
                && health.last_delay < 100;
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
    let catalog =
        controller.proxy_catalog_snapshot_or_else(running, &[AEGOS_OUTBOUND_IP_GROUP], || {
            active_profile
                .as_ref()
                .map(|profile| {
                    profile_proxy_groups_for_profile_snapshot(profile, &selected_map, true)
                })
                .as_ref()
                .and_then(|groups| ProxyCatalog::from_product_json(groups).ok())
                .unwrap_or_default()
        });
    // While the core is running, Controller `now` values are the runtime truth.
    // Persisted preferences are only an offline fallback and must not overwrite
    // a node selected by an automatic or subscription-owned group.
    let runtime_selected_map = HashMap::new();
    let selected_map = if running {
        &runtime_selected_map
    } else {
        &selected_map
    };
    let mut catalog = core_runtime::shape_proxy_catalog_model(catalog, selected_map, &manual_names);
    apply_speed_test_delays_from_state(&mut catalog, &speed);
    catalog.into_product_json()
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
    speed_health_path: PathBuf,
    proxy_snapshot_path: PathBuf,
    settings: Settings,
    process: Option<Child>,
    runtime_profile_id: Option<String>,
    runtime_config_digest: Option<String>,
    traffic_takeover: bool,
    logs: LogStore,
    last_traffic: TrafficSnapshot,
    speed_test: SpeedTestStore,
    speed_target_catalog: Option<SpeedTargetCatalog>,
    startup_timings_ms: Vec<(String, u64)>,
    profile_metadata_errors: HashMap<String, String>,
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
    speed_prepare_running: Arc<AtomicBool>,
    logs: LogStore,
    app_data: PathBuf,
    jobs: JobStore,
    operations: Arc<Mutex<()>>,
}

#[derive(Clone)]
struct DiagnosticsSnapshot {
    settings: Settings,
    profile_metadata_errors: HashMap<String, String>,
    active_profile: Option<Profile>,
    core_path: PathBuf,
    runtime_info: JsonValue,
    proxy_snapshot_path: PathBuf,
    running: bool,
    traffic_takeover: bool,
    last_traffic: TrafficSnapshot,
    speed_test: SpeedTestState,
    lan_ip_cache: String,
    outbound_ip_cache: String,
    outbound_ip_checked_at: u64,
    reliability_failures: u64,
    recent_logs: Vec<LogEntry>,
    status_logs: Vec<LogEntry>,
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

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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
    atomic_replace_file(&temp_path, path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        format!("atomic replace failed {}: {err}", path.display())
    })
}

#[cfg(windows)]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source = OsStr::new(source)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = OsStr::new(destination)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

type SpeedHealthCache = HashMap<String, HashMap<String, NodeHealth>>;
static SPEED_HEALTH_CACHE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn load_speed_health_cache(path: &Path) -> SpeedHealthCache {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<SpeedHealthCache>(&raw).ok())
        .unwrap_or_default()
}

fn load_profile_speed_health(path: &Path, profile_id: &str) -> HashMap<String, NodeHealth> {
    load_speed_health_cache(path)
        .remove(profile_id)
        .unwrap_or_default()
}

fn persist_profile_speed_health(
    path: &Path,
    app_data: &Path,
    profile_id: &str,
    health: &HashMap<String, NodeHealth>,
) -> Result<(), String> {
    let _guard = SPEED_HEALTH_CACHE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Speed health cache lock is poisoned".to_string())?;
    let mut cache = load_speed_health_cache(path);
    cache.insert(profile_id.to_string(), health.clone());
    if cache.len() > 16 {
        let mut profiles = cache
            .iter()
            .map(|(id, items)| {
                let newest = items
                    .values()
                    .map(|item| item.last_tested_at)
                    .max()
                    .unwrap_or(0);
                (id.clone(), newest)
            })
            .collect::<Vec<_>>();
        profiles.sort_by_key(|(_, newest)| *newest);
        for (id, _) in profiles.into_iter().take(cache.len().saturating_sub(16)) {
            cache.remove(&id);
        }
    }
    let raw = serde_json::to_string(&cache)
        .map_err(|err| format!("Speed health cache encode failed: {err}"))?;
    atomic_write_text_confined(path, app_data, &raw)
}

fn remove_file_confined(path: &Path, root: &Path) -> Result<(), String> {
    ensure_path_within(path, root)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("remove file failed {}: {err}", path.display())),
    }
}

fn restore_result_label(result: Result<(), String>) -> String {
    result.err().unwrap_or_else(|| "completed".to_string())
}

fn combine_restore_results(
    first_label: &str,
    first: Result<(), String>,
    second_label: &str,
    second: Result<(), String>,
) -> Result<(), String> {
    match (first, second) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(first_err), Ok(())) => Err(format!("{first_label} failed: {first_err}")),
        (Ok(()), Err(second_err)) => Err(format!("{second_label} failed: {second_err}")),
        (Err(first_err), Err(second_err)) => Err(format!(
            "{first_label} failed: {first_err}; {second_label} also failed: {second_err}"
        )),
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

#[cfg(test)]
fn protocol_concurrency(protocol: &str) -> usize {
    match protocol_family(protocol) {
        "tuic" => 10,
        "hysteria" | "wireguard" => 12,
        "ss-obfs" => 16,
        "anytls" => 16,
        "reality" | "vmess" | "trojan" | "ss" => 48,
        _ => 32,
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
        "tuic" | "hysteria" | "wireguard" => 3800,
        "anytls" => 3200,
        "ss-obfs" => 3000,
        "reality" | "vmess" | "trojan" | "ss" => 2500,
        _ => 2800,
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

fn refining_node_health(
    previous: Option<&NodeHealth>,
    name: &str,
    protocol: &str,
    reason: &str,
    now: u64,
) -> NodeHealth {
    let mut health = previous.cloned().unwrap_or_default();
    health.name = name.to_string();
    health.protocol = protocol.to_string();
    health.last_delay = -1;
    health.last_tested_at = now;
    health.status = "refining".to_string();
    health.confidence = "testing".to_string();
    health.last_failure_reason = format!(
        "refining:{}",
        if reason.trim().is_empty() {
            "timeout"
        } else {
            reason.trim()
        }
    );
    health
}

fn speed_test_ordered_targets(
    targets: Vec<SpeedTestTarget>,
    health: &HashMap<String, NodeHealth>,
    priority_names: &[String],
    now: u64,
) -> VecDeque<SpeedTestTarget> {
    let priority = priority_names
        .iter()
        .enumerate()
        .map(|(index, name)| (name.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut ordered = targets;
    ordered.sort_by_key(|target| {
        let current = health.get(&target.name);
        let priority_rank = priority
            .get(target.name.as_str())
            .or_else(|| priority.get(target.select_name.as_str()))
            .copied()
            .unwrap_or(usize::MAX);
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
        (priority_rank, cooldown, family_rank, score)
    });
    VecDeque::from(ordered)
}

#[cfg(test)]
fn next_schedulable_target(
    pending: &mut VecDeque<SpeedTestTarget>,
    active_by_family: &HashMap<&'static str, usize>,
) -> Option<SpeedTestTarget> {
    let index = pending.iter().position(|target| {
        let family = protocol_family(&target.protocol);
        active_by_family.get(family).copied().unwrap_or(0) < protocol_concurrency(&target.protocol)
    })?;
    pending.remove(index)
}

#[cfg(test)]
fn adaptive_speed_concurrency(
    current: usize,
    completed: usize,
    failures: usize,
    elapsed_ms: u128,
) -> usize {
    if completed == 0 {
        return current;
    }
    let failure_percent = failures.saturating_mul(100) / completed;
    let average_ms = elapsed_ms / completed as u128;
    if failure_percent >= 50 {
        current.saturating_sub(4).max(SPEED_GLOBAL_CONCURRENCY_MIN)
    } else if failure_percent <= 20 && average_ms <= 1_800 {
        (current + 4).min(SPEED_GLOBAL_CONCURRENCY_MAX)
    } else {
        current
    }
}

fn speed_scheduler_policy(refining: bool) -> SchedulerPolicy {
    let (initial, min, max) = if refining {
        (
            SPEED_REFINE_CONCURRENCY_INITIAL,
            SPEED_REFINE_CONCURRENCY_MIN,
            SPEED_REFINE_CONCURRENCY_MAX,
        )
    } else {
        (
            SPEED_GLOBAL_CONCURRENCY_INITIAL,
            SPEED_GLOBAL_CONCURRENCY_MIN,
            SPEED_GLOBAL_CONCURRENCY_MAX,
        )
    };
    let divisor = if refining { 2 } else { 1 };
    SchedulerPolicy {
        initial_concurrency: initial,
        min_concurrency: min,
        max_concurrency: max,
        adaptive_window: SPEED_ADAPTIVE_WINDOW,
        family_limits: HashMap::from([
            ("tuic".to_string(), (10 / divisor).max(2)),
            ("hysteria".to_string(), (12 / divisor).max(2)),
            ("wireguard".to_string(), (12 / divisor).max(2)),
            ("anytls".to_string(), (16 / divisor).max(2)),
            ("ss-obfs".to_string(), (16 / divisor).max(2)),
            ("reality".to_string(), (48 / divisor).max(2)),
            ("vmess".to_string(), (48 / divisor).max(2)),
            ("trojan".to_string(), (48 / divisor).max(2)),
            ("ss".to_string(), (48 / divisor).max(2)),
            ("generic".to_string(), (32 / divisor).max(2)),
        ]),
    }
}

fn emit_speed_test_event(app: &AppHandle, payload: JsonValue) {
    let _ = app.emit(SPEED_TEST_EVENT, payload);
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
        .find(|target| config_domain::is_subscription_metadata_node_name(&target.name));
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

fn profile_file_summary(profile: &Profile) -> Result<ProfileSourceSummary, String> {
    let path = Path::new(&profile.path);
    if !path.exists() {
        return Err(format!("profile file missing: {}", profile.path));
    }
    let raw = fs::read_to_string(path).map_err(|err| format!("profile file read failed: {err}"))?;
    let config: YamlValue =
        serde_yaml::from_str(&raw).map_err(|err| format!("profile YAML parse failed: {err}"))?;
    subscription_runtime::summarize_source(&config, "profile-file", 0)
}

fn should_repair_profile_metadata(profile: &Profile) -> bool {
    profile.profile_type == "url"
        && !profile.path.trim().is_empty()
        && (profile.node_count == 0 || profile.proxy_group_count == 0)
}

fn public_profile(profile: &Profile, metadata_error: Option<&str>) -> JsonValue {
    let metadata_status = if metadata_error.is_some() {
        "stale"
    } else {
        "stored"
    };
    let metadata_error = metadata_error.map(sanitize_sensitive_text);
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
        "node_count": profile.node_count,
        "nodeCount": profile.node_count,
        "proxy_group_count": profile.proxy_group_count,
        "proxyGroupCount": profile.proxy_group_count,
        "updated_at": &profile.updated_at,
        "digest": &profile.digest,
        "metadataStatus": metadata_status,
        "metadataError": metadata_error
    })
}

fn is_fake_ip_address(value: &str) -> bool {
    let text = value.trim();
    text.starts_with("198.18.") || text.starts_with("198.19.")
}

fn normalize_manual_node(input: &JsonValue) -> Result<ManualNodeConfig, String> {
    let Some(map) = input.as_object() else {
        return Err("Manual node must be an object.".to_string());
    };
    let node_type = core_runtime::normalize_proxy_type(
        map.get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("ss")
            .trim(),
    );
    if !core_runtime::supports_proxy_type(&node_type) {
        return Err(format!(
            "Unsupported manual node protocol: {node_type}; {}",
            core_runtime::protocol_capability_summary(subscription_runtime::AEGOS_URI_PROTOCOLS)
        ));
    }
    ManualNodeConfig::from_input(input, node_type)
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

#[cfg(test)]
fn preflight_runtime_config(
    config: &YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<config_domain::RuntimeConfigReport, String> {
    core_runtime::preflight_runtime_config(
        config,
        core_runtime::RuntimeConfigPreflightInput {
            profile_id: &profile.id,
            profile_type: &profile.profile_type,
            profile_name: &profile.name,
            mixed_port: settings.mixed_port,
            controller_port: settings.controller_port,
            uri_protocols: subscription_runtime::AEGOS_URI_PROTOCOLS,
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

fn runtime_current_proxy_route(
    controller: &core_runtime::CoreController,
    mode: &str,
) -> Result<(ProxyCatalog, String), String> {
    let catalog = controller.proxy_catalog_snapshot(&[])?;
    let primary_groups = if mode.eq_ignore_ascii_case("global") {
        OUTBOUND_IP_GLOBAL_PRIMARY_GROUPS
    } else {
        OUTBOUND_IP_RULE_PRIMARY_GROUPS
    };
    let proxy = catalog
        .resolve_runtime_leaf(primary_groups)
        .ok_or_else(|| "Current runtime route does not resolve to a proxy node".to_string())?;
    Ok((catalog, proxy))
}

fn sync_outbound_ip_route(
    controller: &core_runtime::CoreController,
    mode: &str,
) -> Result<String, String> {
    let (catalog, proxy) = runtime_current_proxy_route(controller, mode)?;
    if !catalog.group_contains_leaf(AEGOS_OUTBOUND_IP_GROUP, &proxy) {
        return Err(format!(
            "Current runtime node '{proxy}' is not available in the outbound IP route"
        ));
    }
    controller
        .apply_auxiliary_proxy_selection(AEGOS_OUTBOUND_IP_GROUP, &proxy)
        .map_err(|err| format!("Outbound IP route sync failed: {err}"))?;
    Ok(proxy)
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
    fn confined_atomic_write_replaces_an_existing_file() {
        let root = std::env::temp_dir().join(format!("aegos-atomic-write-{}", hex_random(8)));
        let path = root.join("speed-health.json");
        ensure_dir(&root).expect("temporary root");

        atomic_write_text_confined(&path, &root, "first").expect("first atomic write");
        atomic_write_text_confined(&path, &root, "second").expect("replacement atomic write");

        assert_eq!(
            fs::read_to_string(&path).expect("replacement content"),
            "second"
        );
        assert_eq!(
            fs::read_dir(&root)
                .expect("temporary root listing")
                .filter_map(Result::ok)
                .count(),
            1
        );
        fs::remove_dir_all(&root).expect("temporary root cleanup");
    }

    #[test]
    fn combined_restore_error_keeps_both_failure_causes() {
        let error = combine_restore_results(
            "metadata restore",
            Err("settings disk full".to_string()),
            "runtime restore",
            Err("controller unavailable".to_string()),
        )
        .unwrap_err();

        assert!(error.contains("metadata restore failed: settings disk full"));
        assert!(error.contains("runtime restore also failed: controller unavailable"));
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
        let parsed = subscription_runtime::parse_uri_subscription(&encoded)
            .expect("tuic subscription should parse");
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
        let parsed = subscription_runtime::parse_uri_subscription(&text)
            .expect("modern URI subscription should parse");
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
            subscription_runtime::parse_uri_source("ssr://example-one\nwireguard://example-two")
                .expect_err("unsupported protocols should be classified");

        assert!(err.contains("Subscription diagnostics [unsupported-protocol]"));
        assert!(err.contains("ssr"));
        assert!(err.contains("wireguard"));
        assert!(err.contains("Logs or Diagnostics"));
    }

    #[test]
    fn subscription_diagnostics_classify_unsupported_format() {
        let err = subscription_runtime::parse_uri_source("plain text without proxy uris")
            .expect_err("plain text should be classified");

        assert!(err.contains("Subscription diagnostics [unsupported-format]"));
        assert!(err.contains("Clash YAML"));
    }

    #[test]
    fn subscription_diagnostics_classify_invalid_url_scheme() {
        let err = subscription_runtime::download_source_url(
            "ftp://example.com/sub",
            AEGOS_SUBSCRIPTION_USER_AGENT,
        )
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
            subscription_runtime::parse_uri_source(raw).expect("metadata-wrapped URI source");

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
        let source = subscription_runtime::parse_source_text(&encoded)
            .expect("base64 URI subscription should parse");

        assert_eq!(source.summary.format, "uri");
        assert_eq!(source.summary.proxies, 2);
        assert_eq!(source.summary.unsupported_lines, 0);
    }

    #[test]
    fn subscription_parser_accepts_bom_prefixed_clash_yaml() {
        let raw = "\u{feff}proxies:\n  - name: Node A\n    type: ss\n    server: example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: secret\nproxy-groups:\n  - name: Proxy\n    type: select\n    proxies:\n      - Node A\nrules:\n  - MATCH,Proxy\n";
        let source = subscription_runtime::parse_source_text(raw)
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
        assert_eq!(report.proxy_groups, 2);
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

        assert_eq!(node.protocol, "hysteria2");
        assert!(core_runtime::supports_proxy_type("anytls"));
        assert!(core_runtime::protocol_capability_summary(
            subscription_runtime::AEGOS_URI_PROTOCOLS
        )
        .contains("Aegos URI parser"));
    }

    #[test]
    fn sanitized_subscription_fixtures_parse_without_real_tokens() {
        let clash = include_str!("../fixtures/subscriptions/clash-basic.yaml");
        let mixed = include_str!("../fixtures/subscriptions/mixed-uri.txt");
        let mixed_b64 = general_purpose::STANDARD.encode(mixed);

        let clash_source =
            subscription_runtime::parse_source_text(clash).expect("sanitized Clash fixture");
        let mixed_source =
            subscription_runtime::parse_source_text(mixed).expect("sanitized mixed URI fixture");
        let mixed_b64_source = subscription_runtime::parse_source_text(&mixed_b64)
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
        let err = subscription_runtime::parse_source_text(unsupported)
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
        let patched =
            config_pipeline::patch_config(source, &settings, Some("test")).expect("patch");
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
    fn tun_candidate_has_route_interface_and_dns_takeover_contract() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: Node A
    type: ss
    server: node-a.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Proxies
    type: select
    proxies: [Node A]
rules: ["MATCH,Proxies"]
"#,
        )
        .expect("source");
        let mut settings = default_settings();
        settings.tun_enabled = true;
        settings.dns_hijack_enabled = true;
        let patched =
            config_pipeline::patch_config(source, &settings, Some("test")).expect("TUN candidate");
        let tun = patched.get(yaml_key("tun")).expect("tun section");
        assert_eq!(
            tun.get(yaml_key("enable")).and_then(YamlValue::as_bool),
            Some(true)
        );
        assert_eq!(
            tun.get(yaml_key("auto-route")).and_then(YamlValue::as_bool),
            Some(true)
        );
        assert_eq!(
            tun.get(yaml_key("auto-detect-interface"))
                .and_then(YamlValue::as_bool),
            Some(true)
        );
        assert_eq!(
            tun.get(yaml_key("device")).and_then(YamlValue::as_str),
            Some("Aegos")
        );
        assert!(tun
            .get(yaml_key("dns-hijack"))
            .and_then(YamlValue::as_sequence)
            .is_some_and(|items| items.iter().any(|item| item.as_str() == Some("any:53"))));
        assert!(config_pipeline::runtime_dns_safety_report(&patched).is_ok());
    }

    #[test]
    fn windows_takeover_scripts_preserve_external_network_policy() {
        let enable_proxy = build_proxy_script(true, 7891);
        assert!(enable_proxy.contains("Remove-ItemProperty -Path $path -Name AutoConfigURL"));
        assert!(enable_proxy.contains("-Name AutoDetect -Type DWord -Value 0"));

        let disable_proxy = build_proxy_script(false, 7891);
        assert!(disable_proxy.contains("ProxyEnable -Type DWord -Value 0"));
        assert!(!disable_proxy.contains("Remove-ItemProperty -Path $path -Name AutoConfigURL"));
        assert!(!disable_proxy.contains("-Name ProxyOverride"));

        let cleanup = build_kill_switch_script(
            false,
            &std::env::temp_dir(),
            &std::env::current_exe().unwrap_or_default(),
        );
        assert!(cleanup.contains(core_runtime::FIREWALL_DISCONNECT_PROTECTION_GROUP));
        assert!(cleanup.contains(core_runtime::FIREWALL_SPEED_TEST_GROUP));
        assert!(cleanup.contains("Aegos firewall rules were not fully removed"));
        assert!(!cleanup.contains("DefaultOutboundAction Allow"));
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
        let patched =
            config_pipeline::patch_config(source, &settings, Some("test")).expect("patch");
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
        let patched = config_pipeline::patch_config(source, &default_settings(), Some("test"))
            .expect("patch");
        let group_names = yaml_sequence(&patched, "proxy-groups")
            .expect("groups")
            .iter()
            .filter_map(yaml_mapping_name)
            .collect::<Vec<_>>();
        assert!(group_names.iter().any(|name| *name == "Proxies"));
        assert!(group_names.iter().any(|name| *name == "自动选择"));
        let auto_group = yaml_sequence(&patched, "proxy-groups")
            .expect("groups")
            .iter()
            .find(|group| yaml_mapping_name(group) == Some("自动选择"))
            .expect("auto group");
        assert_eq!(
            auto_group.get(yaml_key("lazy")).and_then(YamlValue::as_bool),
            Some(true)
        );
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
    fn patch_config_migrates_and_deduplicates_legacy_auto_groups() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: Node A
    type: ss
    server: a.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
  - name: Node B
    type: ss
    server: b.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Proxies
    type: select
    proxies: [Node A, Node B]
  - name: 鑷姩閫夋嫨
    type: url-test
    proxies: [Node A]
  - name: 自动选择
    type: url-test
    proxies: [Node B]
rules:
  - MATCH,Proxies
"#,
        )
        .expect("source");
        let patched = config_pipeline::patch_config(source, &default_settings(), Some("test"))
            .expect("patch");
        let auto_groups = yaml_sequence(&patched, "proxy-groups")
            .expect("groups")
            .iter()
            .filter_map(yaml_mapping_name)
            .filter(|name| core_runtime::is_aegos_auto_select_group_name(name))
            .collect::<Vec<_>>();
        assert_eq!(auto_groups, vec!["自动选择"]);
        let auto_group = yaml_sequence(&patched, "proxy-groups")
            .expect("groups")
            .iter()
            .find(|group| yaml_mapping_name(group) == Some("自动选择"))
            .expect("normalized auto group");
        assert_eq!(
            auto_group.get(yaml_key("lazy")).and_then(YamlValue::as_bool),
            Some(true)
        );
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
        groups = core_runtime::shape_proxy_catalog_model(
            ProxyCatalog::from_product_json(&groups).expect("proxy catalog"),
            &HashMap::new(),
            &HashSet::new(),
        )
        .into_product_json();
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
    fn proxy_catalog_speed_enrichment_preserves_one_product_contract() {
        let mut catalog = core_runtime::shape_proxy_catalog_model(
            ProxyCatalog::from_product_json(&json!([{
                "name": "Proxies",
                "type": "Selector",
                "now": "HK 01",
                "items": [{ "name": "HK 01", "type": "ss", "server": "hk.example.com" }]
            }]))
            .expect("proxy catalog"),
            &HashMap::new(),
            &HashSet::new(),
        );
        let now = now_secs();
        let mut speed = SpeedTestState::default();
        speed.delays.insert("HK 01".to_string(), 42);
        speed.health.insert(
            "HK 01".to_string(),
            NodeHealth {
                name: "HK 01".to_string(),
                protocol: "ss".to_string(),
                last_delay: 42,
                median_delay: 45,
                jitter: 3,
                last_success_at: now,
                last_tested_at: now,
                status: "available".to_string(),
                score: 48,
                ..NodeHealth::default()
            },
        );
        speed.recommended = Some(json!({ "realProxyName": "HK 01" }));

        apply_speed_test_delays_from_state(&mut catalog, &speed);
        let product = catalog.into_product_json();
        let item = product.pointer("/0/items/0").expect("product node");
        assert_eq!(item.get("delay").and_then(JsonValue::as_i64), Some(42));
        assert_eq!(
            item.get("healthStatus").and_then(JsonValue::as_str),
            Some("available")
        );
        assert_eq!(
            item.get("medianDelay").and_then(JsonValue::as_i64),
            Some(45)
        );
        assert_eq!(
            item.get("recommended").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            item.get("server").and_then(JsonValue::as_str),
            Some("hk.example.com")
        );
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
                "now": "Node A",
                "items": [
                    { "name": "Node A", "type": "ss" },
                    { "name": "Auto", "type": "Group", "realProxyName": "Node B" }
                ]
            }
        ]);

        let ok = core_runtime::validate_proxy_selection_from_groups(&groups, "GLOBAL", "Node A")
            .expect("existing node should pass");
        assert_eq!(ok.real_proxy_name, "Node A");
        assert_eq!(ok.previous_proxy, "Node A");

        let by_real =
            core_runtime::validate_proxy_selection_from_groups(&groups, "GLOBAL", "Node B")
                .expect("real proxy alias should pass");
        assert_eq!(by_real.real_proxy_name, "Node B");

        let missing_group =
            core_runtime::validate_proxy_selection_from_groups(&groups, "Missing", "Node A")
                .expect_err("missing group should fail");
        assert!(missing_group.contains("group 'Missing' was not found"));

        let missing_proxy =
            core_runtime::validate_proxy_selection_from_groups(&groups, "GLOBAL", "Missing")
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
            config_pipeline::patch_config(source.clone(), &settings, None).expect("first patch");
        let second = config_pipeline::patch_config(source, &settings, None).expect("second patch");
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
        let changed = config_pipeline::patch_config(first, &settings, None).expect("changed patch");
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
        let patched =
            config_pipeline::patch_config(source, &settings, Some("test")).expect("patch");
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
        assert!(lookup_proxies.iter().any(|item| item.as_str() == Some("DIRECT")));
    }

    #[test]
    fn outbound_ip_route_entry_is_mode_aware() {
        let catalog = ProxyCatalog::from_product_json(&json!([
            {
                "name": "GLOBAL",
                "type": "Selector",
                "now": "DIRECT",
                "items": [{ "name": "DIRECT", "type": "Direct" }]
            },
            {
                "name": "Final",
                "type": "Selector",
                "now": "Proxies",
                "items": [{ "name": "Proxies", "type": "Group", "group": true }]
            },
            {
                "name": "Proxies",
                "type": "Selector",
                "now": "Node A",
                "items": [{ "name": "Node A", "type": "ss" }]
            }
        ]))
        .expect("catalog");
        assert_eq!(
            catalog.resolve_runtime_leaf(OUTBOUND_IP_RULE_PRIMARY_GROUPS),
            Some("Node A".to_string())
        );
        assert_eq!(
            catalog.resolve_runtime_leaf(OUTBOUND_IP_GLOBAL_PRIMARY_GROUPS),
            Some("DIRECT".to_string())
        );
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
        let line = "update failed https://train.example/api/linkon?token=fixture-token-redacted&protocol=vless password: secret uuid=00000000-0000-4000-8000-000000000000 bearer abc.def trojan://pass@example.com:443 path C:\\Users\\Example\\AppData\\Roaming\\com.codex.aegos\\settings.json lan 192.168.31.8 cgnat 100.64.1.2 public 8.8.8.8";
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
        assert!(!sanitized.contains("C:\\Users\\Example"));
        assert!(!sanitized.contains("192.168.31.8"));
        assert!(!sanitized.contains("100.64.1.2"));
    }

    #[test]
    fn support_report_keeps_aegos_codes_and_redacts_evidence() {
        let report = json!({
            "appVersion": "test",
            "generatedAt": "now",
            "status": {
                "coreReady": true,
                "trafficTakeover": true,
                "mode": "rule"
            },
            "summary": {
                "errors": 1,
                "warnings": 0,
                "failed": 1,
                "nextActions": ["重新导入订阅"]
            },
            "checks": [{
                "name": "subscription",
                "title": "订阅授权失败",
                "code": "AEG-SUB-003",
                "category": "subscription",
                "ok": false,
                "severity": "error",
                "detail": "订阅令牌无效。",
                "hint": "重新生成订阅链接。"
            }],
            "evidenceLogs": [{
                "at": "now",
                "level": "error",
                "category": "diagnostic",
                "line": "https://train.example/api?token=top-secret password: hidden path C:\\Users\\Example\\secret.txt lan 192.168.1.8"
            }]
        });

        let text = diagnostics_report_text(&report);
        assert!(text.contains("AEG-SUB-003"));
        assert!(text.contains("[redacted]"));
        assert!(text.contains("[local-path]"));
        assert!(text.contains("[private-ip]"));
        assert!(!text.contains("top-secret"));
        assert!(!text.contains("password: hidden"));
        assert!(!text.contains("C:\\Users\\Example"));
        assert!(!text.contains("192.168.1.8"));
    }

    #[test]
    fn diagnostic_repair_allowlist_rejects_unknown_system_actions() {
        for action in [
            "system-proxy",
            "recommended-ports",
            "cleanup-firewall",
            "restart-core",
            "recover-network",
        ] {
            assert!(is_supported_diagnostic_repair_action(action));
        }
        assert!(!is_supported_diagnostic_repair_action("powershell"));
        assert!(!is_supported_diagnostic_repair_action("delete-firewall"));
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
    fn speed_test_queue_prioritizes_visible_targets_without_protocol_barriers() {
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
        let priority = vec!["TUIC".to_string()];
        let queue = speed_test_ordered_targets(targets, &HashMap::new(), &priority, 1);
        assert_eq!(queue.front().unwrap().name, "TUIC");
        assert!(queue.iter().any(|item| item.name == "Trojan"));
    }

    #[test]
    fn protocol_scheduler_handles_reality_hysteria2_and_tuic_explicitly() {
        assert_eq!(protocol_family("vless-reality"), "reality");
        assert_eq!(protocol_family("hysteria2"), "hysteria");
        assert_eq!(protocol_family("hy2"), "hysteria");
        assert_eq!(protocol_family("anytls"), "anytls");
        assert_eq!(protocol_family("ss-obfs"), "ss-obfs");
        assert_eq!(protocol_concurrency("vless-reality"), 48);
        assert_eq!(protocol_concurrency("hysteria2"), 12);
        assert_eq!(protocol_concurrency("anytls"), 16);
        assert_eq!(protocol_concurrency("tuic"), 10);
        assert_eq!(protocol_concurrency("ss-obfs"), 16);
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
        assert_eq!(fast_tuic_probes[0].timeout_ms, 3800);
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
        assert_eq!(trojan_fast_probes[0].timeout_ms, 2500);
        let ss_obfs_fast_probes = delay_probe_plan("ss-obfs", DelayProbeDepth::Fast);
        assert_eq!(
            ss_obfs_fast_probes[0].url,
            "https://www.gstatic.com/generate_204"
        );
        assert_eq!(ss_obfs_fast_probes[0].timeout_ms, 3000);

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
        let queue = speed_test_ordered_targets(targets, &HashMap::new(), &[], 1);
        assert_eq!(queue.front().unwrap().name, "Reality");
        let phase_names = queue
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        assert!(phase_names.contains(&"Hysteria2"));
        assert!(phase_names.contains(&"TUIC"));
        assert!(phase_names.contains(&"SS Obfs"));
    }

    #[test]
    fn speed_scheduler_adapts_without_exceeding_safe_bounds() {
        assert_eq!(adaptive_speed_concurrency(24, 8, 0, 4_000), 28);
        assert_eq!(adaptive_speed_concurrency(24, 8, 5, 20_000), 24);
        assert_eq!(
            adaptive_speed_concurrency(SPEED_GLOBAL_CONCURRENCY_MAX, 8, 0, 2_000),
            SPEED_GLOBAL_CONCURRENCY_MAX
        );
        assert_eq!(
            adaptive_speed_concurrency(SPEED_GLOBAL_CONCURRENCY_MIN, 8, 8, 40_000),
            SPEED_GLOBAL_CONCURRENCY_MIN
        );
    }

    #[test]
    fn saturated_quic_family_does_not_block_ready_stream_targets() {
        let mut pending = VecDeque::from(vec![
            SpeedTestTarget {
                name: "TUIC next".to_string(),
                select_name: "TUIC next".to_string(),
                group_name: "Proxies".to_string(),
                protocol: "tuic".to_string(),
                server: "tuic.example.com".to_string(),
            },
            SpeedTestTarget {
                name: "Trojan next".to_string(),
                select_name: "Trojan next".to_string(),
                group_name: "Proxies".to_string(),
                protocol: "trojan".to_string(),
                server: "trojan.example.com".to_string(),
            },
        ]);
        let active = HashMap::from([("tuic", protocol_concurrency("tuic"))]);
        let next = next_schedulable_target(&mut pending, &active).expect("stream target");
        assert_eq!(next.name, "Trojan next");
        assert_eq!(pending.front().unwrap().name, "TUIC next");
    }

    #[test]
    fn ss_uri_preserves_obfs_plugin_options() {
        let node = subscription_runtime::parse_ss_uri(
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

    #[test]
    fn legacy_user_rules_migrate_to_the_canonical_store() {
        let root = std::env::temp_dir().join(format!("aegos-rule-migration-{}", hex_random(8)));
        fs::create_dir_all(&root).expect("temp root");
        write_routing_user_rules(
            &root,
            &json!({
                "profile-one": {
                    "active": ["DOMAIN-SUFFIX,example.com,Proxies"],
                    "disabled": ["PROCESS-NAME,Telegram.exe,Proxies"]
                }
            }),
        )
        .expect("legacy registry");
        let store = read_aegos_user_rule_store(&root);
        assert_eq!(store.rules.len(), 2);
        assert!(store.rules.iter().all(|rule| {
            rule.scope.profile_id() == Some("profile-one") && rule.source == "legacy"
        }));
        assert!(aegos_user_rule_store_path(&root).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn runtime_overlay_skips_missing_targets_without_modifying_subscription_source() {
        let root = std::env::temp_dir().join(format!("aegos-rule-overlay-{}", hex_random(8)));
        fs::create_dir_all(&root).expect("temp root");
        let profile = Profile {
            id: "profile-one".to_string(),
            name: "Test".to_string(),
            profile_type: "remote".to_string(),
            path: root.join("profile.yaml").to_string_lossy().to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: String::new(),
            digest: String::new(),
        };
        let source_raw = r#"
proxies:
  - name: Node A
    type: ss
    server: node.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Proxies
    type: select
    proxies: [Node A]
rules:
  - MATCH,Proxies
"#;
        fs::write(&profile.path, source_raw).expect("profile source");
        let make_rule = |id: &str, condition: &str, target: &str, priority: u32| UserRuleRecord {
            id: id.to_string(),
            scope: UserRuleScope::Global,
            kind: "DOMAIN-SUFFIX".to_string(),
            condition: condition.to_string(),
            target: target.to_string(),
            option: None,
            enabled: true,
            priority,
            label: String::new(),
            source: "website".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        write_aegos_user_rule_store(
            &root,
            &UserRuleStore {
                version: 1,
                rules: vec![
                    make_rule("valid", "example.com", "Proxies", 1),
                    make_rule("missing", "missing.example", "Removed Group", 2),
                ],
            },
        )
        .expect("rule store");
        let mut runtime: YamlValue = serde_yaml::from_str(source_raw).expect("runtime source");
        apply_aegos_user_rule_overlay(&root, &profile, &mut runtime).expect("overlay");
        let rules = yaml_sequence(&runtime, "rules").expect("runtime rules");
        assert!(rules.iter().any(|rule| rule.as_str() == Some("DOMAIN-SUFFIX,example.com,Proxies")));
        assert!(!rules.iter().any(|rule| rule.as_str().is_some_and(|raw| raw.contains("missing.example"))));
        assert_eq!(fs::read_to_string(&profile.path).expect("source remains"), source_raw);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_rule_store_transaction_restores_previous_store_on_startup() {
        let root = std::env::temp_dir().join(format!("aegos-rule-transaction-{}", hex_random(8)));
        fs::create_dir_all(&root).expect("temp root");
        let previous = UserRuleStore::default();
        let candidate = UserRuleStore {
            version: 1,
            rules: vec![UserRuleRecord {
                id: "candidate".to_string(),
                scope: UserRuleScope::Global,
                kind: "DOMAIN-SUFFIX".to_string(),
                condition: "example.com".to_string(),
                target: "Proxies".to_string(),
                option: None,
                enabled: true,
                priority: 1,
                label: String::new(),
                source: "website".to_string(),
                created_at: String::new(),
                updated_at: String::new(),
            }],
        };
        stage_routing_store_transaction(&root, "test", "profile", &previous, &candidate)
            .expect("stage");
        assert_eq!(read_aegos_user_rule_store(&root).rules.len(), 1);
        assert_eq!(
            read_routing_deployment_report(&root).get("status").and_then(JsonValue::as_str),
            Some("promoted")
        );
        assert!(recover_interrupted_routing_store_transaction(&root).expect("recover"));
        assert!(read_aegos_user_rule_store(&root).rules.is_empty());
        assert!(!routing_store_rollback_path(&root).exists());
        assert_eq!(
            read_routing_deployment_report(&root).get("status").and_then(JsonValue::as_str),
            Some("recovered-after-interruption")
        );
        let _ = fs::remove_dir_all(root);
    }
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
    if config_domain::is_subscription_metadata_node_name(name) {
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

static IS_PROCESS_ELEVATED: OnceLock<bool> = OnceLock::new();

fn is_process_elevated() -> bool {
    *IS_PROCESS_ELEVATED.get_or_init(|| {
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

fn cached_process_elevated() -> Option<bool> {
    IS_PROCESS_ELEVATED.get().copied()
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
  auto_config_url = [string]$item.AutoConfigURL
  auto_detect = [bool]$item.AutoDetect
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
    let auto_config_url = plan.auto_config_url_literal;
    let auto_detect = plan.auto_detect_value;
    run_powershell(&format!(
        r#"
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value {enable}
Set-ItemProperty -Path $path -Name ProxyServer -Type String -Value {server}
Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value {override_value}
if ({auto_config_url} -eq '') {{
  Remove-ItemProperty -Path $path -Name AutoConfigURL -ErrorAction SilentlyContinue
}} else {{
  Set-ItemProperty -Path $path -Name AutoConfigURL -Type String -Value {auto_config_url}
}}
Set-ItemProperty -Path $path -Name AutoDetect -Type DWord -Value {auto_detect}
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
    let auto_detect = plan.auto_detect_value;
    let takeover_auxiliary = if enable {
        format!(
            "Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value {proxy_override}\nRemove-ItemProperty -Path $path -Name AutoConfigURL -ErrorAction SilentlyContinue\nSet-ItemProperty -Path $path -Name AutoDetect -Type DWord -Value {auto_detect}"
        )
    } else {
        String::new()
    };
    format!(
        r#"
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value {flag}
{set_server}
{takeover_auxiliary}
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
    let speed_plan = core_runtime::CoreFirewallPolicyPlan::speed_test();
    let speed_group = speed_plan.group_name;
    let speed_marker = speed_plan.state_path(user_data);
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
$speedGroup = '{}'
$speedRulePrefix = "$speedGroup Allow"
$speedMarkerPath = '{}'
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
}}
Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName "$speedRulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if (Test-Path -LiteralPath $speedMarkerPath) {{ Remove-Item -LiteralPath $speedMarkerPath -Force }}
$rules = @(
  Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName "$speedRulePrefix *" -ErrorAction SilentlyContinue
)
if ($rules.Count -gt 0) {{ throw 'Aegos firewall rules were not fully removed' }}
if (Test-Path -LiteralPath $snapshotPath) {{ throw 'Disconnect protection profile snapshot was not removed' }}
if (Test-Path -LiteralPath $speedMarkerPath) {{ throw 'Speed test firewall marker was not removed' }}
"#,
            core_runtime::powershell_single_quote_escape(snapshot.to_string_lossy()),
            core_runtime::powershell_single_quote_escape(&group),
            core_runtime::powershell_single_quote_escape(&speed_group),
            core_runtime::powershell_single_quote_escape(speed_marker.to_string_lossy())
        )
    }
}

fn takeover_failure_message(
    transaction: system_takeover::SystemTakeoverTransaction,
    reason: impl Into<String>,
    rollback: Result<(), String>,
) -> String {
    let reason = reason.into();
    let (rolled_back, message) = match rollback {
        Ok(()) => (
            true,
            format!("{reason}; previous Windows network state was restored"),
        ),
        Err(err) => (
            false,
            format!("{reason}; automatic restore also failed: {err}"),
        ),
    };
    match transaction.fail(&message, rolled_back) {
        Ok(_) => message,
        Err(err) => format!("{message}; takeover journal update failed: {err}"),
    }
}

fn windows_tun_evidence() -> Result<JsonValue, String> {
    let output = run_powershell(
        r#"
$pattern = '(?i)^aegos$'
$adapters = @(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match $pattern } |
  Select-Object Name,InterfaceDescription,Status,ifIndex)
$routes = @()
foreach ($adapter in $adapters) {
  $routes += @(Get-NetRoute -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0','0.0.0.0/1','128.0.0.0/1','::/0','::/1','8000::/1') } |
    Select-Object DestinationPrefix,InterfaceIndex,RouteMetric)
}
[pscustomobject]@{
  adapter_count = $adapters.Count
  active_adapter_count = @($adapters | Where-Object { $_.Status -eq 'Up' }).Count
  route_count = $routes.Count
  adapters = $adapters
  routes = $routes
} | ConvertTo-Json -Depth 5 -Compress
"#,
    )?;
    serde_json::from_str(&output).map_err(|err| format!("TUN evidence parse failed: {err}"))
}

fn stop_stale_managed_core(core_path: &Path) -> Result<(), String> {
    let core_literal = core_runtime::powershell_single_quoted_literal(
        core_runtime::normalize_windows_program_path_text(&core_path.to_string_lossy()),
    );
    run_powershell(&format!(
        r#"
$target = {core_literal}
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {{ $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($target)) }})
foreach ($process in $processes) {{ Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }}
Start-Sleep -Milliseconds 250
$remaining = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {{ $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($target)) }})
if ($remaining.Count -gt 0) {{ throw 'The interrupted Aegos network engine is still running' }}
"#
    ))?;
    Ok(())
}

fn windows_network_conflict_report(
    mixed_port: u16,
    controller_port: u16,
    core_path: &Path,
    tun_enabled: bool,
) -> JsonValue {
    let core_literal = core_runtime::powershell_single_quoted_literal(
        core_runtime::normalize_windows_program_path_text(&core_path.to_string_lossy()),
    );
    let script = format!(
        r#"
$selfPid = {self_pid}
$corePath = {core_literal}
$ports = @({mixed_port},{controller_port},7890,7891) | Select-Object -Unique
$proxyPattern = '(?i)^(flclash|clash|clash-verge|clash-verge-service|mihomo|sing-box|v2rayn|nekoray|hiddify|wireguard|openvpn|tailscale|zerotier)'
$adapterPattern = '(?i)(flclash|clash|meta|vpn|tun|tap|wintun|wireguard|tailscale|zerotier|sing-box)'
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {{
    $_.ProcessId -ne $selfPid -and $_.Name -match $proxyPattern -and
    (-not $_.ExecutablePath -or -not $corePath -or ([IO.Path]::GetFullPath($_.ExecutablePath) -ine [IO.Path]::GetFullPath($corePath)))
  }} | Select-Object ProcessId,Name,ExecutablePath)
$listeners = @()
foreach ($port in $ports) {{
  foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {{
    if ($listener.OwningProcess -eq $selfPid) {{ continue }}
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($owner -and $owner.ExecutablePath -and $corePath -and ([IO.Path]::GetFullPath($owner.ExecutablePath) -ieq [IO.Path]::GetFullPath($corePath))) {{ continue }}
    $listeners += [pscustomobject]@{{ port=$port; pid=$listener.OwningProcess; process=if($owner){{$owner.Name}}else{{'unknown'}}; path=if($owner){{$owner.ExecutablePath}}else{{''}} }}
  }}
}}
$adapters = @(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue |
  Where-Object {{ $_.Status -eq 'Up' -and "$($_.Name) $($_.InterfaceDescription)" -match $adapterPattern }} |
  Select-Object Name,InterfaceDescription,ifIndex,Status)
$routes = @()
foreach ($adapter in $adapters) {{
  foreach ($route in @(Get-NetRoute -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue |
    Where-Object {{ $_.DestinationPrefix -in @('0.0.0.0/0','0.0.0.0/1','128.0.0.0/1','::/0','::/1','8000::/1') }})) {{
    $routes += [pscustomobject]@{{ adapter=$adapter.Name; destination=$route.DestinationPrefix; metric=$route.RouteMetric }}
  }}
}}
[pscustomobject]@{{ processes=$processes; listeners=$listeners; adapters=$adapters; routes=$routes }} |
  ConvertTo-Json -Depth 5 -Compress
"#,
        self_pid = std::process::id(),
    );
    let raw = match run_powershell(&script) {
        Ok(output) => match serde_json::from_str::<JsonValue>(&output) {
            Ok(value) => value,
            Err(err) => {
                return json!({
                    "ok": false,
                    "level": "warning",
                    "count": 0,
                    "summary": format!("Network conflict scan output could not be parsed: {err}"),
                    "action": "Use Diagnostics to retry the read-only conflict scan.",
                    "findings": []
                })
            }
        },
        Err(err) => {
            return json!({
                "ok": false,
                "level": "warning",
                "count": 0,
                "summary": format!("Network conflict scan could not run: {err}"),
                "action": "Aegos will not change other apps. Close other proxy/VPN apps manually if connection or TUN fails.",
                "findings": []
            })
        }
    };
    let mut findings = Vec::new();
    for process in raw
        .get("processes")
        .and_then(JsonValue::as_array)
        .into_iter()
        .flatten()
    {
        let name = process
            .get("Name")
            .and_then(JsonValue::as_str)
            .unwrap_or("proxy/VPN app");
        let pid = process
            .get("ProcessId")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        findings.push(json!({
            "kind": "process",
            "title": format!("{name} is running"),
            "detail": format!("Another proxy or VPN process is active (PID {pid})."),
            "action": "Close it before enabling TUN if routes, DNS, or speed tests behave inconsistently."
        }));
    }
    for listener in raw
        .get("listeners")
        .and_then(JsonValue::as_array)
        .into_iter()
        .flatten()
    {
        let port = listener
            .get("port")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        let process = listener
            .get("process")
            .and_then(JsonValue::as_str)
            .unwrap_or("unknown process");
        findings.push(json!({
            "kind": "port",
            "title": format!("Port {port} is occupied"),
            "detail": format!("{process} is listening on a port used or reserved by Aegos."),
            "action": "Close the owning app or choose a different Aegos proxy/controller port."
        }));
    }
    for adapter in raw
        .get("adapters")
        .and_then(JsonValue::as_array)
        .into_iter()
        .flatten()
    {
        let name = adapter
            .get("Name")
            .and_then(JsonValue::as_str)
            .unwrap_or("virtual adapter");
        let aegos_tun = tun_enabled && name.eq_ignore_ascii_case("Aegos");
        if !aegos_tun {
            findings.push(json!({
                "kind": "adapter",
                "title": format!("Virtual network adapter '{name}' is active"),
                "detail": "An active VPN/TUN/TAP adapter can compete for default routes or DNS.",
                "action": "Disable the other VPN/TUN adapter temporarily if Aegos TUN validation fails."
            }));
        }
    }
    let count = findings.len();
    json!({
        "ok": count == 0,
        "level": if count == 0 { "ok" } else { "warning" },
        "count": count,
        "summary": if count == 0 {
            "No competing proxy process, occupied Aegos port, or external active VPN adapter was detected.".to_string()
        } else {
            format!("Detected {count} possible proxy/VPN conflict(s); Aegos did not change them.")
        },
        "action": if count == 0 {
            "No action needed."
        } else {
            "Review the findings and close only the conflicting app or adapter before retrying."
        },
        "findings": findings,
        "routes": raw.get("routes").cloned().unwrap_or_else(|| json!([]))
    })
}

fn direct_connectivity_probe() -> Result<String, String> {
    let client = Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(1800))
        .timeout(Duration::from_millis(3200))
        .user_agent("Aegos/3 tun-verification")
        .build()
        .map_err(|err| format!("TUN connectivity client failed: {err}"))?;
    let endpoints = [
        "https://www.msftconnecttest.com/connecttest.txt",
        "https://cp.cloudflare.com/generate_204",
    ];
    let mut last_error = String::new();
    for endpoint in endpoints {
        match client
            .get(endpoint)
            .send()
            .and_then(|res| res.error_for_status())
        {
            Ok(_) => return Ok(endpoint.to_string()),
            Err(err) => last_error = err.to_string(),
        }
    }
    Err(format!(
        "TUN direct connectivity verification failed: {last_error}"
    ))
}

impl CoreManager {
    fn new(app: &AppHandle) -> Result<Self, String> {
        let startup_started = Instant::now();
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
        let speed_health_path = app_data.join("speed-health.json");
        let proxy_snapshot_path = app_data.join("system-proxy-snapshot.json");
        ensure_dir(&home_dir)?;
        ensure_dir(&profile_dir)?;
        let deployment_recovery_started = Instant::now();
        let recovered_deployments =
            config_deployment::recover_interrupted_deployments(&app_data, &profile_dir);
        let recovered_routing_store = recover_interrupted_routing_store_transaction(&app_data)?;
        let deployment_recovery_ms = deployment_recovery_started.elapsed().as_millis() as u64;
        let settings = load_settings(&settings_path);
        let initial_speed_health =
            load_profile_speed_health(&speed_health_path, &settings.active_profile_id);
        let mut manager = Self {
            app_data,
            home_dir,
            profile_dir,
            core_path,
            core_sha256: String::new(),
            settings_path,
            speed_health_path,
            proxy_snapshot_path,
            settings,
            process: None,
            runtime_profile_id: None,
            runtime_config_digest: None,
            traffic_takeover: false,
            logs: Arc::new(Mutex::new(Vec::new())),
            last_traffic: TrafficSnapshot::default(),
            speed_test: Arc::new(Mutex::new(SpeedTestState {
                health: initial_speed_health,
                ..SpeedTestState::default()
            })),
            speed_target_catalog: None,
            startup_timings_ms: vec![("deployment-recovery".to_string(), deployment_recovery_ms)],
            profile_metadata_errors: HashMap::new(),
            lan_ip_cache: "-".to_string(),
            lan_ip_checked_at: 0,
            outbound_ip_cache: "-".to_string(),
            outbound_ip_checked_at: 0,
            outbound_ip_query_generation: 0,
            reliability_failures: 0,
        };
        let step_started = Instant::now();
        manager.recover_interrupted_system_takeover();
        manager.startup_timings_ms.push(("takeover-recovery".to_string(), step_started.elapsed().as_millis() as u64));
        let step_started = Instant::now();
        manager.ensure_direct_profile()?;
        manager.startup_timings_ms.push(("direct-profile".to_string(), step_started.elapsed().as_millis() as u64));
        let step_started = Instant::now();
        manager.repair_profile_metadata();
        manager.startup_timings_ms.push(("profile-metadata".to_string(), step_started.elapsed().as_millis() as u64));
        let step_started = Instant::now();
        manager.save_settings()?;
        manager.startup_timings_ms.push(("settings-save".to_string(), step_started.elapsed().as_millis() as u64));
        manager.startup_timings_ms.push(("total".to_string(), startup_started.elapsed().as_millis() as u64));
        for operation in recovered_deployments {
            manager.add_log(
                format!(
                    "A previous {operation} deployment did not finish runtime verification and its previous configuration was restored."
                ),
                "warn",
            );
        }
        if recovered_routing_store {
            manager.add_log(
                "A previous rule deployment was interrupted. The previous user-rule store was restored before startup.",
                "warning",
            );
        }
        Ok(manager)
    }

    fn recover_takeover_component(&mut self, component: &str) -> Result<String, String> {
        let result = match component {
            "system-proxy" => {
                if let Some(snapshot) = self.load_system_proxy_snapshot() {
                    self.restore_system_proxy_snapshot_verified(&snapshot)?;
                    self.clear_system_proxy_snapshot();
                } else {
                    run_powershell(&build_proxy_script(false, self.settings.mixed_port))?;
                    self.verify_system_proxy_points_to_aegos(false)?;
                }
                self.settings.system_proxy = false;
                self.traffic_takeover = false;
                "Interrupted system proxy takeover was restored and verified.".to_string()
            }
            "firewall" => {
                run_powershell(&build_kill_switch_script(
                    false,
                    &self.app_data,
                    &self.core_path,
                ))?;
                self.settings.kill_switch_enabled = false;
                "Interrupted firewall takeover was restored; Aegos rules and state files were removed."
                    .to_string()
            }
            "tun" => {
                stop_stale_managed_core(&self.core_path)?;
                let evidence = windows_tun_evidence()?;
                let active = evidence
                    .get("active_adapter_count")
                    .and_then(JsonValue::as_u64)
                    .unwrap_or(0);
                let routes = evidence
                    .get("route_count")
                    .and_then(JsonValue::as_u64)
                    .unwrap_or(0);
                if active > 0 && routes > 0 {
                    return Err("A TUN adapter and takeover routes remain after stopping the interrupted Aegos engine".to_string());
                }
                self.settings.tun_enabled = false;
                self.traffic_takeover = false;
                "Interrupted TUN engine was stopped and no active Aegos TUN takeover routes remain."
                    .to_string()
            }
            _ => {
                return Err(format!(
                    "Unknown interrupted system takeover component '{component}' requires manual review"
                ))
            }
        };
        system_takeover::set_component_active(&self.app_data, component, false)?;
        self.save_settings()?;
        Ok(result)
    }

    fn recover_interrupted_system_takeover(&mut self) {
        let pending = system_takeover::interrupted_transactions(&self.app_data);
        for (path, journal) in pending {
            let result = self.recover_takeover_component(&journal.component);
            let (ok, detail) = match result {
                Ok(detail) => (true, detail),
                Err(err) => (false, format!("Startup network recovery failed: {err}")),
            };
            if ok {
                let _ = self.save_settings();
            }
            if let Err(err) = system_takeover::mark_recovered(&path, journal, &detail, ok) {
                self.add_log(
                    format!("{detail}; recovery journal update failed: {err}"),
                    "error",
                );
            } else {
                self.add_log(&detail, if ok { "warn" } else { "error" });
            }
        }
        let active = system_takeover::active_takeover_state(&self.app_data);
        for (component, enabled) in [
            ("system-proxy", active.system_proxy),
            ("firewall", active.firewall),
            ("tun", active.tun),
        ] {
            if !enabled {
                continue;
            }
            let mut transaction = match system_takeover::SystemTakeoverTransaction::begin(
                &self.app_data,
                "Recover unclean Aegos shutdown",
                component,
                false,
            ) {
                Ok(transaction) => transaction,
                Err(err) => {
                    self.add_log(format!("Startup recovery journal failed: {err}"), "error");
                    continue;
                }
            };
            let result = self.recover_takeover_component(component);
            match result {
                Ok(detail) => {
                    let _ = transaction.step("startup-recovery", "restore", "ok", &detail);
                    let _ = transaction
                        .complete("Unclean shutdown takeover state was restored and verified.");
                    self.add_log(detail, "warn");
                }
                Err(err) => {
                    let detail =
                        format!("Startup recovery after an unclean shutdown failed: {err}");
                    let _ = transaction.fail(&detail, false);
                    self.add_log(detail, "error");
                }
            }
        }
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

    fn stage_settings_deployment(
        &self,
        operation: &str,
    ) -> Result<config_deployment::ConfigDeploymentTransaction, String> {
        let candidate = serde_json::to_string_pretty(&self.settings)
            .map_err(|err| format!("{operation} settings serialization failed: {err}"))?;
        let candidate = config_deployment::ConfigDeploymentCandidate::new(
            &self.app_data,
            &self.settings_path,
            operation,
            "settings",
            candidate,
        )?;
        config_deployment::ConfigDeploymentTransaction::stage(&self.app_data, candidate)
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
        let mut info = core_runtime::CoreRuntimeContract::default()
            .identity_json(&self.core_runtime_paths(), &self.core_sha256);
        if let Some(map) = info.as_object_mut() {
            map.insert("startupTimingsMs".to_string(), json!(self.startup_timings_ms));
        }
        info
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

    fn restore_system_proxy_snapshot_verified(
        &self,
        snapshot: &core_runtime::SystemProxySnapshot,
    ) -> Result<(), String> {
        write_windows_proxy_snapshot(snapshot)?;
        let current = read_windows_proxy_snapshot()?;
        core_runtime::verify_system_proxy_restore(&current, snapshot)
    }

    fn verify_tun_state(
        &self,
        expected_enabled: bool,
        require_runtime: bool,
    ) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "TUN verification failed: no active profile".to_string())?;
        let rendered = self.render_runtime_profile(&profile)?;
        let candidate =
            profile_compiler::verify_tun_candidate(&rendered.runtime_yaml, expected_enabled)?;
        if !require_runtime {
            return Ok(json!({
                "candidate": candidate,
                "runtimeChecked": false,
                "detail": "TUN candidate configuration passed; Windows takeover is deferred until connection."
            }));
        }
        if self.process.is_none() || !self.core_controller().runtime_reuse_ready() {
            return Err(
                "TUN runtime verification failed: network engine/controller is not ready"
                    .to_string(),
            );
        }
        let evidence = windows_tun_evidence()?;
        let active_adapters = evidence
            .get("active_adapter_count")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        let routes = evidence
            .get("route_count")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        if expected_enabled && (active_adapters == 0 || routes == 0) {
            return Err(format!(
                "TUN runtime verification failed: Windows reported {active_adapters} active Aegos TUN adapter(s) and {routes} takeover route(s)"
            ));
        }
        if !expected_enabled && active_adapters > 0 && routes > 0 {
            return Err("TUN disable verification failed: an active Aegos TUN adapter still owns takeover routes".to_string());
        }
        let connectivity = if expected_enabled {
            Some(direct_connectivity_probe()?)
        } else {
            None
        };
        Ok(json!({
            "candidate": candidate,
            "runtimeChecked": true,
            "controllerReady": true,
            "windows": evidence,
            "connectivityEndpoint": connectivity
        }))
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
        self.profile_metadata_errors.clear();
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
                Err(err) => {
                    self.profile_metadata_errors
                        .insert(profile.id.clone(), err.clone());
                    failed.push(format!("{}: {err}", profile.name));
                }
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

    fn restore_settings_snapshot(
        &mut self,
        previous_settings: Settings,
        restart_previous_runtime: bool,
    ) -> Result<(), String> {
        let mut rollback_errors = Vec::new();
        if restart_previous_runtime && self.process.is_some() {
            if let Err(err) = self.stop() {
                rollback_errors.push(format!("stop current runtime failed: {err}"));
            }
            thread::sleep(Duration::from_millis(
                core_runtime::RUNTIME_RESTART_SETTLE_MS,
            ));
        }
        self.settings = previous_settings;
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
            Ok(())
        } else {
            Err(rollback_errors.join("; "))
        }
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
        match self.restore_settings_snapshot(previous_settings, restart_previous_runtime) {
            Ok(()) => format!("{reason}; settings rolled back"),
            Err(rollback_err) => {
                format!("{reason}; settings rollback had errors: {rollback_err}")
            }
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
        if let Some(metadata) = fs::read_to_string(routing_store_undo_path(&self.app_data))
            .ok()
            .and_then(|raw| serde_json::from_str::<JsonValue>(&raw).ok())
        {
            return Some(metadata);
        }
        let (_, backup_meta_path) = self.routing_apply_backup_paths();
        fs::read_to_string(&backup_meta_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
    }

    fn apply_user_rule_store_drafts(
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
            return Err("The built-in direct profile cannot be edited; import a subscription first.".to_string());
        }
        let raw = fs::read_to_string(&profile.path)
            .map_err(|err| format!("Routing apply failed: profile read failed: {err}"))?;
        let source: YamlValue = serde_yaml::from_str(&raw)
            .map_err(|err| format!("Routing apply failed: active profile YAML parse failed: {err}"))?;
        let targets = routing_rule_target_catalog(&source);
        let mut store = read_aegos_user_rule_store(&self.app_data);
        let previous_store = store.clone();
        let mut applied = Vec::new();
        for draft in drafts {
            let scope = if draft.scope.as_deref() == Some("global") {
                UserRuleScope::Global
            } else {
                UserRuleScope::Profile { profile_id: profile.id.clone() }
            };
            let (raw_rule, detail) = normalize_routing_draft_rule(&draft, &targets)?;
            let matcher_kind = detail.get("kind").and_then(JsonValue::as_str).unwrap_or_default();
            let matcher_condition = detail.get("condition").and_then(JsonValue::as_str).unwrap_or_default();
            let duplicate = store.rules.iter().any(|rule| {
                rule.scope == scope
                    && rule.kind.eq_ignore_ascii_case(matcher_kind)
                    && rule.condition.eq_ignore_ascii_case(matcher_condition)
            });
            if duplicate {
                return Err(format!("当前作用范围内已有“{matcher_condition}”规则，请编辑原规则，不要重复添加。"));
            }
            let now = now_iso();
            let option = detail
                .get("option")
                .and_then(JsonValue::as_str)
                .map(str::to_string);
            store.rules.push(UserRuleRecord {
                id: format!("usr-{:016x}", random::<u64>()),
                scope,
                kind: detail.get("kind").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                condition: detail.get("condition").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                target: detail.get("target").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                option,
                enabled: true,
                priority: (store.rules.len() as u32).saturating_add(1),
                label: detail.get("label").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                source: draft.source.as_deref().unwrap_or("user").to_string(),
                created_at: now.clone(),
                updated_at: now,
            });
            applied.push(raw_rule);
        }
        store = store.normalized();
        stage_routing_store_transaction(
            &self.app_data,
            "apply-drafts",
            &profile.id,
            &previous_store,
            &store,
        )?;
        let deployment = (|| -> Result<JsonValue, String> {
            let plan = self.render_runtime_profile(&profile)?;
            let was_running = self.process.is_some();
            let reload = if was_running {
                self.hot_reload_runtime_plan(&profile, &plan)?
            } else {
                json!({ "ok": true, "skipped": true, "reason": "core is not running" })
            };
            Ok(json!({
                "runtimePreflight": plan.validation_json(),
                "deploymentValidation": {
                    "candidateValidated": true,
                    "atomicPromotion": true,
                    "hotReloadRan": was_running,
                    "controllerReady": true,
                    "runtimeIdentity": !was_running || self.runtime_profile_id.as_deref() == Some(profile.id.as_str()),
                    "rollbackReady": true,
                    "verifiedAt": now_iso(),
                    "hotReload": reload
                }
            }))
        })();
        let deployment = match deployment {
            Ok(value) => value,
            Err(err) => {
                let restore_runtime = if self.process.is_some() {
                    self.hot_reload_profile(&profile).map(|_| ())
                } else {
                    Ok(())
                };
                let restore_store = rollback_routing_store_transaction(
                    &self.app_data,
                    "apply-drafts",
                    &profile.id,
                    &previous_store,
                    &err,
                    restore_runtime.is_ok(),
                );
                return Err(match (restore_store, restore_runtime) {
                    (Ok(()), Ok(())) => format!("Routing rule apply failed and the previous rule set was restored: {err}"),
                    (store_err, runtime_err) => format!(
                        "Routing rule apply failed: {err}; rule-store rollback: {}; runtime rollback: {}",
                        store_err.err().map(|value| value.to_string()).unwrap_or_else(|| "ok".to_string()),
                        runtime_err.err().map(|value| value.to_string()).unwrap_or_else(|| "ok".to_string())
                    )
                });
            }
        };
        finish_routing_store_transaction(
            &self.app_data,
            "apply-drafts",
            &profile.id,
            json!({ "profileName": profile.name, "ruleCount": applied.len() }),
        )?;
        write_routing_store_undo(&self.app_data, &profile, &previous_store, applied.len())?;
        self.add_log(
            format!("Aegos user rules applied: {} rule(s) for profile {}", applied.len(), profile.name),
            "info",
        );
        Ok(json!({
            "ok": true,
            "profileId": profile.id,
            "profileName": profile.name,
            "appliedCount": applied.len(),
            "appliedRules": applied,
            "ruleScope": "profile",
            "rollbackAvailable": true,
            "runtimePreflight": deployment.get("runtimePreflight").cloned().unwrap_or_else(|| json!({})),
            "deploymentValidation": deployment.get("deploymentValidation").cloned().unwrap_or_else(|| json!({})),
            "nextStep": "Rules were saved in Aegos and overlaid on the active subscription at runtime."
        }))
    }

    fn apply_user_rule_store_edit(&mut self, edit: RoutingRuleEditInput) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "No active profile; routing rules cannot be changed.".to_string())?;
        if profile.profile_type == "builtin" {
            return Err("The built-in direct profile cannot be edited; import a subscription first.".to_string());
        }
        let action = RoutingRuleAction::parse(&edit.action)?;
        let rule_id = edit.rule_id.as_deref().unwrap_or_default().trim();
        let raw = edit.raw.as_deref().unwrap_or_default().trim();
        let mut store = read_aegos_user_rule_store(&self.app_data);
        let previous_store = store.clone();
        let is_current_scope = |rule: &UserRuleRecord| {
            if !rule_id.is_empty() {
                return rule.id == rule_id && rule.scope.applies_to(&profile.id);
            }
            rule.scope.applies_to(&profile.id) && rule.raw().trim() == raw
        };
        let position = store.rules.iter().position(is_current_scope);
        if action.requires_existing_user_rule() && position.is_none() {
            return Err("Only Aegos user rules can be managed here.".to_string());
        }
        let source_raw = fs::read_to_string(&profile.path)
            .map_err(|err| format!("Routing rule edit failed: profile read failed: {err}"))?;
        let source: YamlValue = serde_yaml::from_str(&source_raw)
            .map_err(|err| format!("Routing rule edit failed: profile YAML parse failed: {err}"))?;
        let targets = routing_rule_target_catalog(&source);
        match action {
            RoutingRuleAction::Add => {
                let (_next_raw, detail) = normalize_routing_draft_rule(&edit.draft(), &targets)?;
                let next_scope = if edit.scope.as_deref() == Some("global") {
                    UserRuleScope::Global
                } else {
                    UserRuleScope::Profile { profile_id: profile.id.clone() }
                };
                if store.rules.iter().any(|rule| {
                    rule.scope == next_scope
                        && rule.kind.eq_ignore_ascii_case(detail.get("kind").and_then(JsonValue::as_str).unwrap_or_default())
                        && rule.condition.eq_ignore_ascii_case(detail.get("condition").and_then(JsonValue::as_str).unwrap_or_default())
                }) {
                    return Err("当前作用范围内已有相同匹配条件，请编辑原规则。".to_string());
                }
                let now = now_iso();
                store.rules.push(UserRuleRecord {
                    id: format!("usr-{:016x}", random::<u64>()),
                    scope: next_scope,
                    kind: detail.get("kind").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                    condition: detail.get("condition").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                    target: detail.get("target").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                    option: detail.get("option").and_then(JsonValue::as_str).map(str::to_string),
                    enabled: true,
                    priority: (store.rules.len() as u32).saturating_add(1),
                    label: detail.get("label").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                    source: edit.draft().source.unwrap_or_else(|| "user".to_string()),
                    created_at: now.clone(),
                    updated_at: now,
                });
            }
            RoutingRuleAction::Edit => {
                let (_next_raw, detail) = normalize_routing_draft_rule(&edit.draft(), &targets)?;
                let next_scope = if edit.scope.as_deref() == Some("global") {
                    UserRuleScope::Global
                } else {
                    UserRuleScope::Profile { profile_id: profile.id.clone() }
                };
                if store.rules.iter().enumerate().any(|(index, rule)| index != position.unwrap_or(usize::MAX)
                    && rule.scope == next_scope
                    && rule.kind.eq_ignore_ascii_case(detail.get("kind").and_then(JsonValue::as_str).unwrap_or_default())
                    && rule.condition.eq_ignore_ascii_case(detail.get("condition").and_then(JsonValue::as_str).unwrap_or_default())) {
                    return Err("当前作用范围内已有相同匹配条件，请编辑原规则。".to_string());
                }
                let rule = &mut store.rules[position.expect("checked above")];
                rule.kind = detail.get("kind").and_then(JsonValue::as_str).unwrap_or_default().to_string();
                rule.condition = detail.get("condition").and_then(JsonValue::as_str).unwrap_or_default().to_string();
                rule.target = detail.get("target").and_then(JsonValue::as_str).unwrap_or_default().to_string();
                rule.option = detail.get("option").and_then(JsonValue::as_str).map(str::to_string);
                rule.label = detail.get("label").and_then(JsonValue::as_str).unwrap_or_default().to_string();
                rule.source = edit.draft().source.unwrap_or_else(|| "user".to_string());
                rule.scope = next_scope;
                rule.updated_at = now_iso();
            }
            RoutingRuleAction::Delete => {
                store.rules.remove(position.expect("checked above"));
            }
            RoutingRuleAction::Enable | RoutingRuleAction::Disable => {
                let rule = &mut store.rules[position.expect("checked above")];
                rule.enabled = action == RoutingRuleAction::Enable;
                rule.updated_at = now_iso();
            }
            RoutingRuleAction::Up | RoutingRuleAction::Down => {
                let index = position.expect("checked above");
                let mut scoped = store.rules.iter().enumerate()
                    .filter(|(_, rule)| rule.enabled && rule.scope.applies_to(&profile.id))
                    .map(|(index, rule)| (index, rule.priority))
                    .collect::<Vec<_>>();
                scoped.sort_by_key(|(_, priority)| *priority);
                let current = scoped.iter().position(|(candidate, _)| *candidate == index)
                    .ok_or_else(|| "User rule order target was not found.".to_string())?;
                let neighbor = if action == RoutingRuleAction::Up {
                    current.checked_sub(1)
                } else if current + 1 < scoped.len() {
                    Some(current + 1)
                } else {
                    None
                };
                if let Some(neighbor) = neighbor {
                    let other_index = scoped[neighbor].0;
                    let current_priority = store.rules[index].priority;
                    store.rules[index].priority = store.rules[other_index].priority;
                    store.rules[other_index].priority = current_priority;
                    store.rules[index].updated_at = now_iso();
                    store.rules[other_index].updated_at = now_iso();
                }
            }
        }
        store = store.normalized();
        stage_routing_store_transaction(
            &self.app_data,
            "edit-rule",
            &profile.id,
            &previous_store,
            &store,
        )?;
        let deployment = self.render_runtime_profile(&profile).and_then(|plan| {
            let was_running = self.process.is_some();
            let reload = if was_running {
                self.hot_reload_runtime_plan(&profile, &plan)?
            } else {
                json!({ "ok": true, "skipped": true, "reason": "core is not running" })
            };
            Ok(json!({ "runtimePreflight": plan.validation_json(), "hotReload": reload, "hotReloadRan": was_running }))
        });
        if let Err(err) = deployment {
            let restore_runtime = if self.process.is_some() { self.hot_reload_profile(&profile).map(|_| ()) } else { Ok(()) };
            let restore_store = rollback_routing_store_transaction(
                &self.app_data,
                "edit-rule",
                &profile.id,
                &previous_store,
                &err,
                restore_runtime.is_ok(),
            );
            return Err(format!(
                "Routing rule change failed and rollback was attempted: {err}; store: {}; runtime: {}",
                restore_store.err().unwrap_or_else(|| "ok".to_string()),
                restore_runtime.err().unwrap_or_else(|| "ok".to_string())
            ));
        }
        finish_routing_store_transaction(
            &self.app_data,
            "edit-rule",
            &profile.id,
            json!({ "action": action.as_str() }),
        )?;
        Ok(json!({
            "ok": true,
            "profileId": profile.id,
            "action": action.as_str(),
            "changed": true,
            "deploymentValidation": { "candidateValidated": true, "atomicPromotion": true, "rollbackReady": true, "verifiedAt": now_iso() }
        }))
    }

    fn resolve_unbound_user_rule(
        &mut self,
        input: UnboundRuleResolutionInput,
    ) -> Result<JsonValue, String> {
        let rule_id = input.rule_id.trim();
        if rule_id.is_empty() {
            return Err("缺少要处理的规则编号。".to_string());
        }
        let action = input.action.trim().to_ascii_lowercase();
        if !matches!(action.as_str(), "rebind" | "global" | "delete") {
            return Err("不支持的解绑规则操作。".to_string());
        }
        let mut store = read_aegos_user_rule_store(&self.app_data);
        let previous_store = store.clone();
        let position = store
            .rules
            .iter()
            .position(|rule| rule.id == rule_id)
            .ok_or_else(|| "这条规则已不存在，请刷新后重试。".to_string())?;
        let known_profiles = self
            .settings
            .profiles
            .iter()
            .map(|profile| profile.id.as_str())
            .collect::<HashSet<_>>();
        let is_unbound = store.rules[position]
            .scope
            .profile_id()
            .is_some_and(|profile_id| !known_profiles.contains(profile_id));
        if !is_unbound {
            return Err("这条规则仍绑定有效订阅，无需重新绑定。".to_string());
        }

        let mut runtime_profile = None;
        let previous_scope = store.rules[position].scope.clone();
        let previous_target = store.rules[position].target.clone();
        if action == "delete" {
            store.rules.remove(position);
        } else {
            let profile = self
                .active_profile()
                .ok_or_else(|| "请先启用一个订阅，再重新绑定规则。".to_string())?;
            if profile.profile_type == "builtin" {
                return Err("当前是内置直连配置，请先启用一个订阅。".to_string());
            }
            let raw = fs::read_to_string(&profile.path)
                .map_err(|err| format!("读取当前订阅失败：{err}"))?;
            let source: YamlValue = serde_yaml::from_str(&raw)
                .map_err(|err| format!("当前订阅格式无效：{err}"))?;
            let targets = routing_rule_target_catalog(&source);
            let next_target = input
                .target
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(previous_target.as_str());
            if !routing_domain::target_exists(&targets, next_target) {
                return Err(format!("当前订阅里没有“{next_target}”，请选择一个可用线路或节点。"));
            }
            let next_scope = if action == "global" {
                UserRuleScope::Global
            } else {
                UserRuleScope::Profile {
                    profile_id: profile.id.clone(),
                }
            };
            let next_raw = {
                let rule = &store.rules[position];
                let mut candidate = rule.clone();
                candidate.scope = next_scope.clone();
                candidate.target = next_target.to_string();
                candidate.raw()
            };
            if store.rules.iter().enumerate().any(|(index, rule)| {
                index != position && rule.scope == next_scope && rule.raw() == next_raw
            }) {
                return Err("当前范围内已有相同规则，请删除重复项或选择其他线路。".to_string());
            }
            let rule = &mut store.rules[position];
            rule.scope = next_scope;
            rule.target = next_target.to_string();
            rule.updated_at = now_iso();
            runtime_profile = Some(profile);
        }

        store = store.normalized();
        let transaction_profile_id = runtime_profile
            .as_ref()
            .map(|profile| profile.id.as_str())
            .unwrap_or("");
        stage_routing_store_transaction(
            &self.app_data,
            "resolve-unbound-rule",
            transaction_profile_id,
            &previous_store,
            &store,
        )?;
        if let Some(profile) = runtime_profile.as_ref() {
            let deployment = self.render_runtime_profile(profile).and_then(|plan| {
                if self.process.is_some() {
                    self.hot_reload_runtime_plan(profile, &plan)?;
                }
                Ok(plan.validation_json())
            });
            if let Err(err) = deployment {
                let runtime_restore = if self.process.is_some() {
                    self.hot_reload_profile(profile).map(|_| ())
                } else {
                    Ok(())
                };
                let store_restore = rollback_routing_store_transaction(
                    &self.app_data,
                    "resolve-unbound-rule",
                    &profile.id,
                    &previous_store,
                    &err,
                    runtime_restore.is_ok(),
                );
                return Err(format!(
                    "规则重新绑定失败，已尝试恢复原状态：{err}；规则存储恢复：{}；运行配置恢复：{}",
                    restore_result_label(store_restore),
                    restore_result_label(runtime_restore)
                ));
            }
        }
        finish_routing_store_transaction(
            &self.app_data,
            "resolve-unbound-rule",
            transaction_profile_id,
            json!({ "ruleId": rule_id, "action": action }),
        )?;
        self.add_log(
            format!(
                "Unbound routing rule resolved: id {}, action {}, scope {:?} -> {:?}, target {} -> {}",
                sanitize_sensitive_text(rule_id),
                action,
                previous_scope,
                store.rules.iter().find(|rule| rule.id == rule_id).map(|rule| &rule.scope),
                sanitize_sensitive_text(&previous_target),
                sanitize_sensitive_text(
                    store.rules.iter().find(|rule| rule.id == rule_id).map(|rule| rule.target.as_str()).unwrap_or("deleted")
                )
            ),
            "info",
        );
        Ok(json!({
            "ok": true,
            "ruleId": rule_id,
            "action": action,
            "changed": true,
            "runtimeUpdated": runtime_profile.is_some(),
            "rollbackReady": true
        }))
    }

    fn undo_last_routing_apply(&mut self) -> Result<JsonValue, String> {
        let user_store_undo = routing_store_undo_path(&self.app_data);
        if user_store_undo.exists() {
            let metadata: JsonValue = fs::read_to_string(&user_store_undo)
                .map_err(|err| format!("读取规则撤销记录失败：{err}"))
                .and_then(|raw| serde_json::from_str(&raw).map_err(|err| format!("规则撤销记录损坏：{err}")))?;
            let profile_id = metadata
                .get("profileId")
                .and_then(JsonValue::as_str)
                .ok_or_else(|| "规则撤销记录缺少订阅编号。".to_string())?;
            if self.settings.active_profile_id != profile_id {
                return Err("请先切回创建这些规则时使用的订阅，再执行撤销。".to_string());
            }
            let profile = self
                .settings
                .profiles
                .iter()
                .find(|profile| profile.id == profile_id)
                .cloned()
                .ok_or_else(|| "原订阅已删除，无法直接撤销；请在待绑定规则中处理。".to_string())?;
            let previous_store: UserRuleStore = serde_json::from_value(
                metadata.get("store").cloned().ok_or_else(|| "规则撤销记录缺少存储快照。".to_string())?,
            )
            .map_err(|err| format!("规则撤销快照无效：{err}"))?;
            let current_store = read_aegos_user_rule_store(&self.app_data);
            stage_routing_store_transaction(
                &self.app_data,
                "undo-rule-apply",
                &profile.id,
                &current_store,
                &previous_store,
            )?;
            let deployment = self.render_runtime_profile(&profile).and_then(|plan| {
                if self.process.is_some() {
                    self.hot_reload_runtime_plan(&profile, &plan)?;
                }
                Ok(plan.validation_json())
            });
            let runtime_preflight = match deployment {
                Ok(report) => report,
                Err(err) => {
                    let runtime_restore = if self.process.is_some() {
                        self.hot_reload_profile(&profile).map(|_| ())
                    } else {
                        Ok(())
                    };
                    let store_restore = rollback_routing_store_transaction(
                        &self.app_data,
                        "undo-rule-apply",
                        &profile.id,
                        &current_store,
                        &err,
                        runtime_restore.is_ok(),
                    );
                    return Err(format!(
                        "撤销失败，当前规则已恢复：{err}；规则恢复：{}；运行状态恢复：{}",
                        restore_result_label(store_restore),
                        restore_result_label(runtime_restore)
                    ));
                }
            };
            finish_routing_store_transaction(
                &self.app_data,
                "undo-rule-apply",
                &profile.id,
                json!({ "restoredRuleCount": previous_store.rules.len() }),
            )?;
            remove_file_confined(&user_store_undo, &self.app_data)?;
            self.add_log(
                format!("Latest Aegos user-rule apply undone for profile {}", sanitize_sensitive_text(&profile.name)),
                "info",
            );
            return Ok(json!({
                "ok": true,
                "profileId": profile.id,
                "profileName": profile.name,
                "runtimePreflight": runtime_preflight,
                "rollbackAvailable": false,
                "nextStep": "最近一次批量添加的用户规则已撤销。"
            }));
        }
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
        let deployment = self.deploy_profile_config(&profile, &restored_config, "Routing undo")?;
        let runtime_preflight = deployment
            .get("runtimePreflight")
            .cloned()
            .unwrap_or_else(|| json!({}));
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
            "deploymentValidation": deployment.get("deploymentValidation").cloned().unwrap_or_else(|| json!({})),
            "deploymentReport": deployment.get("deploymentReport").cloned().unwrap_or_else(|| json!({})),
            "rollbackAvailable": false,
            "nextStep": "Latest routing apply has been undone."
        }))
    }

    fn deploy_profile_config(
        &mut self,
        profile: &Profile,
        source: &YamlValue,
        label: &str,
    ) -> Result<JsonValue, String> {
        let settings = self.settings.clone();
        let source_plan = profile_compiler::compile_profile_source(source.clone(), profile, &settings)
            .map_err(|err| format!("{label} preflight failed: {err}"))?;
        let mut runtime_source = source.clone();
        apply_aegos_user_rule_overlay(&self.app_data, profile, &mut runtime_source)
            .map_err(|err| format!("{label} user-rule overlay failed: {err}"))?;
        let runtime_plan = profile_compiler::compile_profile_source(runtime_source, profile, &settings)
            .map_err(|err| format!("{label} runtime preflight failed: {err}"))?;
        let runtime_preflight = runtime_plan.validation_json();
        let next_raw = source_plan.source_yaml.clone();
        let profile_path = PathBuf::from(&profile.path);
        let candidate =
            source_plan.source_deployment_candidate(&self.profile_dir, &profile_path, label)?;
        let mut deployment =
            config_deployment::ConfigDeploymentTransaction::stage(&self.app_data, candidate)?;
        deployment.promote()?;
        let was_running = self.process.is_some();
        let reload = if was_running {
            self.hot_reload_runtime_plan(profile, &runtime_plan)
        } else {
            Ok(json!({ "ok": true, "skipped": true, "reason": "core is not running" }))
        };
        let controller_ready = !was_running || reload.is_ok();
        let runtime_identity_ok = !was_running
            || (self.runtime_profile_id.as_deref() == Some(profile.id.as_str())
                && self.runtime_config_digest.is_some());
        let reload_report = match reload {
            Ok(value) if controller_ready && runtime_identity_ok => value,
            Ok(_) => {
                let reason = "runtime identity or controller readiness verification failed";
                let rollback_runtime = deployment.rollback_with_runtime(reason, || {
                    if was_running {
                        self.hot_reload_profile(profile).map(|_| ())
                    } else {
                        Ok(())
                    }
                });
                return Err(match rollback_runtime {
                    Ok(_) => format!("{label} verification failed and configuration was rolled back: {reason}"),
                    Err(rollback_err) => format!("{label} verification failed: {reason}; rollback also failed: {rollback_err}"),
                });
            }
            Err(err) => {
                let rollback_runtime = deployment.rollback_with_runtime(
                    format!("runtime apply failed: {err}"),
                    || {
                        if was_running {
                            self.hot_reload_profile(profile).map(|_| ())
                        } else {
                            Ok(())
                        }
                    },
                );
                return Err(match rollback_runtime {
                    Ok(_) => format!(
                        "{label} hot reload failed and configuration was rolled back: {err}"
                    ),
                    Err(rollback_err) => format!(
                        "{label} hot reload failed: {err}; rollback also failed: {rollback_err}"
                    ),
                });
            }
        };
        let deployment_report = deployment.complete_verified(
            if was_running {
                "Candidate promoted, Mihomo reloaded, controller and runtime identity verified."
            } else {
                "Candidate promoted and validated; runtime verification will occur when the core starts."
            },
            || {
                if was_running {
                    self.hot_reload_profile(profile).map(|_| ())
                } else {
                    Ok(())
                }
            },
        )?;
        Ok(json!({
            "ok": true,
            "profileId": profile.id,
            "profileName": profile.name,
            "sourceCatalog": source_plan.source_catalog().summary_json(),
            "runtimeCatalog": runtime_plan.runtime_catalog().summary_json(),
            "runtimePreflight": runtime_preflight,
            "digest": sha256_text(&next_raw)
            ,"deploymentReport": deployment_report,
            "deploymentValidation": {
                "candidateValidated": true,
                "atomicPromotion": true,
                "hotReloadRan": was_running,
                "controllerReady": controller_ready,
                "runtimeIdentity": runtime_identity_ok,
                "rollbackReady": true,
                "hotReload": reload_report,
                "verifiedAt": now_iso()
            }
        }))
    }

    fn commit_profile_routing_config(
        &mut self,
        profile: &Profile,
        source: &YamlValue,
        label: &str,
    ) -> Result<JsonValue, String> {
        self.deploy_profile_config(profile, source, label)
    }

    fn restore_routing_transaction(
        &mut self,
        profile: &Profile,
        previous_source: &YamlValue,
        previous_selected_map: &HashMap<String, String>,
        previous_registry: &JsonValue,
        config_changed: bool,
        cause: &str,
    ) -> String {
        self.settings.selected_proxy_map = previous_selected_map.clone();
        let settings_restore = self.save_settings();
        let registry_restore = write_routing_user_rules(&self.app_data, previous_registry);
        let config_restore = if config_changed {
            self.commit_profile_routing_config(
                profile,
                previous_source,
                "Routing transaction rollback",
            )
            .map(|_| ())
        } else {
            Ok(())
        };
        format!(
            "{cause}; preference restore: {}; user-rule registry restore: {}; configuration restore: {}",
            restore_result_label(settings_restore),
            restore_result_label(registry_restore),
            restore_result_label(config_restore)
        )
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
        let (profile, _previous_raw, mut source) =
            self.active_editable_profile_and_config("Routing group edit")?;
        let previous_source = source.clone();
        let previous_selected_map = self.settings.selected_proxy_map.clone();
        let mut next_selected_map = previous_selected_map.clone();
        let previous_registry = read_routing_user_rules(&self.app_data);
        let previous_user_store = read_aegos_user_rule_store(&self.app_data);
        let mut next_user_store = previous_user_store.clone();
        let (active_user_rules, disabled_user_rules) =
            routing_user_rule_lists(&self.app_data, &profile.id);
        let mut next_active_user_rules = active_user_rules.clone();
        let mut next_disabled_user_rules = disabled_user_rules.clone();
        let action = RoutingGroupAction::parse(&edit.action)?;
        let action_name = action.as_str();
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
        let validated_name = if action == RoutingGroupAction::Add {
            routing_domain::validate_name(&new_name)?
        } else {
            routing_domain::validate_name(&name)?
        };
        let validated_new_name = routing_domain::validate_name(&new_name)?;
        if config_pipeline::is_internal_proxy_group_name(&validated_name)
            || config_pipeline::is_internal_proxy_group_name(&validated_new_name)
        {
            return Err("Routing group edit failed: internal groups cannot be edited".to_string());
        }
        if action == RoutingGroupAction::Delete && validated_name.eq_ignore_ascii_case("Proxies") {
            return Err(
                "Routing group edit failed: Proxies is the main group and cannot be deleted"
                    .to_string(),
            );
        }
        if action == RoutingGroupAction::Delete {
            let blocking_rules = yaml_sequence(&source, "rules")
                .into_iter()
                .flat_map(|items| items.iter())
                .filter_map(YamlValue::as_str)
                .filter(|rule| {
                    routing_domain::rule_target(rule).as_deref() == Some(validated_name.as_str())
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
            match action {
                RoutingGroupAction::Add => {
                    if groups
                        .iter()
                        .any(|group| yaml_mapping_name(group) == Some(validated_new_name.as_str()))
                    {
                        return Err(format!(
                            "Routing group edit failed: group already exists: {validated_new_name}"
                        ));
                    }
                    let members = routing_domain::validate_group_members(
                        &edit.items.unwrap_or_default(),
                        &targets_before,
                    )?;
                    let group_type = routing_domain::validate_group_type(
                        edit.group_type.as_deref().unwrap_or("select"),
                    )?;
                    let mut group = Mapping::new();
                    set_yaml(&mut group, "name", yaml_str(validated_new_name.clone()));
                    set_yaml(&mut group, "type", yaml_str(group_type));
                    set_yaml(&mut group, "proxies", yaml_string_values(&members));
                    groups.push(YamlValue::Mapping(group));
                }
                RoutingGroupAction::Edit => {
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
                    let members = routing_domain::validate_group_members(
                        &edit.items.unwrap_or_default(),
                        &targets_before,
                    )?;
                    let group_type = routing_domain::validate_group_type(
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
                RoutingGroupAction::Delete => {
                    let Some(index) = group_index else {
                        return Err(format!(
                            "Routing group edit failed: group not found: {validated_name}"
                        ));
                    };
                    groups.remove(index);
                }
            }
        }
        if renamed {
            for rule in next_user_store.rules.iter_mut().filter(|rule| {
                rule.scope.profile_id() == Some(profile.id.as_str())
                    && rule.target == validated_name
            }) {
                rule.target = validated_new_name.clone();
                rule.updated_at = now_iso();
            }
            if let Some(rules) = config
                .get_mut(yaml_key("rules"))
                .and_then(YamlValue::as_sequence_mut)
            {
                for rule in rules {
                    if let Some(raw) = rule.as_str() {
                        if let Some(next) = routing_domain::replace_rule_target(
                            raw,
                            &validated_name,
                            &validated_new_name,
                        ) {
                            *rule = yaml_str(next);
                        }
                    }
                }
            }
            if let Some(value) = next_selected_map.remove(&validated_name) {
                next_selected_map.insert(validated_new_name.clone(), value);
            }
            next_active_user_rules = routing_domain::replace_targets(
                &active_user_rules,
                &validated_name,
                &validated_new_name,
            );
            next_disabled_user_rules = routing_domain::replace_targets(
                &disabled_user_rules,
                &validated_name,
                &validated_new_name,
            );
        }
        if action == RoutingGroupAction::Delete {
            if let Some(rules) = config
                .get_mut(yaml_key("rules"))
                .and_then(YamlValue::as_sequence_mut)
            {
                for rule in rules {
                    if let Some(raw) = rule.as_str() {
                        if let Some(next) =
                            routing_domain::replace_rule_target(raw, &validated_name, "Proxies")
                        {
                            *rule = yaml_str(next);
                        }
                    }
                }
            }
            next_selected_map.remove(&validated_name);
            next_active_user_rules =
                routing_domain::replace_targets(&active_user_rules, &validated_name, "Proxies");
            next_disabled_user_rules =
                routing_domain::replace_targets(&disabled_user_rules, &validated_name, "Proxies");
        }
        let user_store_changed = next_user_store.rules != previous_user_store.rules;
        if user_store_changed {
            stage_routing_store_transaction(
                &self.app_data,
                "edit-routing-group",
                &profile.id,
                &previous_user_store,
                &next_user_store,
            )?;
        }
        let mut result = match self.commit_profile_routing_config(&profile, &source, "Routing group edit") {
            Ok(result) => result,
            Err(err) => {
                if user_store_changed {
                    let _ = rollback_routing_store_transaction(
                        &self.app_data,
                        "edit-routing-group",
                        &profile.id,
                        &previous_user_store,
                        &err,
                        true,
                    );
                }
                return Err(err);
            }
        };
        if next_selected_map != previous_selected_map {
            self.settings.selected_proxy_map = next_selected_map;
            if let Err(settings_err) = self.save_settings() {
                let detail = self.restore_routing_transaction(
                    &profile,
                    &previous_source,
                    &previous_selected_map,
                    &previous_registry,
                    true,
                    &format!("Routing group edit could not save node preferences: {settings_err}"),
                );
                if user_store_changed {
                    let _ = rollback_routing_store_transaction(
                        &self.app_data,
                        "edit-routing-group",
                        &profile.id,
                        &previous_user_store,
                        &settings_err.to_string(),
                        true,
                    );
                }
                return Err(detail);
            }
        }
        if next_active_user_rules != active_user_rules
            || next_disabled_user_rules != disabled_user_rules
        {
            if let Err(registry_err) = write_routing_user_rule_lists(
                &self.app_data,
                &profile.id,
                &next_active_user_rules,
                &next_disabled_user_rules,
            ) {
                let detail = self.restore_routing_transaction(
                    &profile,
                    &previous_source,
                    &previous_selected_map,
                    &previous_registry,
                    true,
                    &format!(
                        "Routing group edit could not update user-rule ownership: {registry_err}"
                    ),
                );
                if user_store_changed {
                    let _ = rollback_routing_store_transaction(
                        &self.app_data,
                        "edit-routing-group",
                        &profile.id,
                        &previous_user_store,
                        &registry_err.to_string(),
                        true,
                    );
                }
                return Err(detail);
            }
        }
        if user_store_changed {
            finish_routing_store_transaction(
                &self.app_data,
                "edit-routing-group",
                &profile.id,
                json!({ "action": action_name, "group": validated_new_name }),
            )?;
        }
        if let Some(map) = result.as_object_mut() {
            map.insert("action".to_string(), json!(action_name));
            map.insert("group".to_string(), json!(validated_new_name));
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
            .map(|rendered| rendered.validation_json())
    }

    fn render_runtime_profile(
        &self,
        profile: &Profile,
    ) -> Result<profile_compiler::RuntimeDeploymentPlan, String> {
        self.render_runtime_profile_with_settings(profile, &self.settings)
    }

    fn render_runtime_profile_with_settings(
        &self,
        profile: &Profile,
        settings: &Settings,
    ) -> Result<profile_compiler::RuntimeDeploymentPlan, String> {
        let raw = fs::read_to_string(&profile.path)
            .map_err(|err| format!("profile config read failed {}: {err}", profile.path))?;
        let mut source: YamlValue = serde_yaml::from_str(&raw)
            .map_err(|err| format!("profile YAML parse failed {}: {err}", profile.path))?;
        apply_aegos_user_rule_overlay(&self.app_data, profile, &mut source)?;
        profile_compiler::compile_profile_source(source, profile, settings)
    }

    fn launch_runtime_yaml(
        &self,
        rendered: &profile_compiler::RuntimeDeploymentPlan,
    ) -> Result<core_runtime::CoreRuntimeProfile, String> {
        core_runtime::render_runtime_profile_yaml(
            &rendered.runtime_yaml,
            detect_windows_primary_interface_name(),
        )
    }

    fn write_runtime_deployment_plan(
        &mut self,
        plan: &profile_compiler::RuntimeDeploymentPlan,
        label: &str,
    ) -> Result<String, String> {
        let runtime_profile = self.launch_runtime_yaml(plan)?;
        let runtime_write =
            core_runtime::write_runtime_profile(&self.core_runtime_paths(), &runtime_profile)?;
        self.add_log(
            format!(
                "{label}: {} proxies, {} groups, source {}, planned runtime {}, written runtime {}{}, file {}",
                plan.runtime_catalog().summary().proxy_count,
                plan.runtime_catalog().summary().proxy_group_count,
                core_runtime::digest_prefix(&plan.source_digest),
                core_runtime::digest_prefix(&plan.runtime_digest),
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

    fn patch_profile_file(&mut self, profile: &Profile) -> Result<String, String> {
        let plan = self.render_runtime_profile(profile)?;
        self.write_runtime_deployment_plan(&plan, "Config preflight passed; source preserved")
    }

    fn runtime_profile_path(&self) -> PathBuf {
        self.home_dir.join("aegos-runtime-profile.yaml")
    }

    fn hot_reload_profile(&mut self, profile: &Profile) -> Result<JsonValue, String> {
        let plan = self.render_runtime_profile(profile)?;
        self.hot_reload_runtime_plan(profile, &plan)
    }

    fn hot_reload_runtime_plan(
        &mut self,
        profile: &Profile,
        plan: &profile_compiler::RuntimeDeploymentPlan,
    ) -> Result<JsonValue, String> {
        let config_digest =
            self.write_runtime_deployment_plan(plan, "Runtime deployment plan prepared")?;
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
        let apply_started = Instant::now();
        let result = apply_transaction.apply(&self.core_controller())?;
        let apply_elapsed_ms = apply_started.elapsed().as_millis();
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
            format!(
                "{}; verified in {apply_elapsed_ms} ms with one post-apply version probe",
                core_runtime::hot_reload_success_message(
                    &profile.name,
                    &result.digest,
                    Some(&result.runtime_version.version),
                )
            ),
            "info",
        );
        let mut receipt = result.receipt_json();
        if let Some(map) = receipt.as_object_mut() {
            map.insert("applyElapsedMs".to_string(), json!(apply_elapsed_ms));
            map.insert("versionProbeCount".to_string(), json!(1));
            map.insert(
                "readinessEvidence".to_string(),
                json!("config-apply-version"),
            );
        }
        Ok(receipt)
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
                rendered.validation.proxies,
                rendered.validation.proxy_groups,
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
        if !self.settings.tun_enabled {
            return self.start_with_takeover(true);
        }
        let mut transaction = system_takeover::SystemTakeoverTransaction::begin(
            &self.app_data,
            "Start TUN takeover",
            "tun",
            true,
        )?;
        transaction.step(
            "tun",
            "launch",
            "pending",
            "The network engine is starting with a validated TUN candidate configuration.",
        )?;
        match self.start_with_takeover(true) {
            Ok(result) => match self.verify_tun_state(true, true) {
                Ok(report) => {
                    if let Err(err) =
                        system_takeover::set_component_active(&self.app_data, "tun", true)
                    {
                        let _ = self.stop();
                        let message = format!(
                            "TUN started but crash-recovery state could not be persisted: {err}"
                        );
                        let _ = transaction.fail(&message, true);
                        return Err(message);
                    }
                    transaction.step(
                        "tun",
                        "verify",
                        "ok",
                        format!("TUN runtime verification passed: {report}"),
                    )?;
                    transaction.complete_verified(
                        "TUN controller, Windows adapter/routes, DNS safety and connectivity were verified.",
                        || {
                            let stop_result = self.stop().map(|_| ());
                            let active_state_result = system_takeover::set_component_active(
                                &self.app_data,
                                "tun",
                                false,
                            )
                            .map(|_| ());
                            combine_restore_results(
                                "TUN runtime stop",
                                stop_result,
                                "TUN recovery state cleanup",
                                active_state_result,
                            )
                        },
                    )?;
                    Ok(result)
                }
                Err(err) => {
                    let rollback = self.stop().map(|_| ());
                    let message = takeover_failure_message(transaction, err, rollback);
                    let _ = system_takeover::set_component_active(&self.app_data, "tun", false);
                    Err(message)
                }
            },
            Err(err) => {
                self.terminate_core_process(core_runtime::TERMINATE_FAILED_STARTUP_MESSAGE);
                let _ = system_takeover::set_component_active(&self.app_data, "tun", false);
                let _ = transaction.fail(&err, true);
                Err(err)
            }
        }
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
            .ok_or_else(|| "当前没有可用订阅，无法启动测速运行环境".to_string())?;
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
        let active = system_takeover::active_takeover_state(&self.app_data);
        if self.settings.kill_switch_enabled || active.firewall {
            if let Err(err) = self.set_kill_switch(false) {
                self.add_log(
                    format!("Disconnect protection restore failed during exit: {err}"),
                    "error",
                );
            }
        }
        self.terminate_core_process(core_runtime::TERMINATE_EXIT_MESSAGE);
        if let Err(err) = system_takeover::set_component_active(&self.app_data, "tun", false) {
            self.add_log(
                format!("TUN clean-exit marker update failed: {err}"),
                "error",
            );
        }
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

    fn status_observation(
        &mut self,
    ) -> (bool, core_runtime::CoreController, TrafficSnapshot, bool) {
        if let Some(reason) = self.reap_exited_core() {
            self.add_log(reason, "warn");
        }
        let running = self.process.is_some();
        let refresh_lan_ip = now_secs().saturating_sub(self.lan_ip_checked_at) >= 45;
        if refresh_lan_ip {
            // Mark the attempt before releasing the lock so a slow Windows
            // network query cannot create a thread per status heartbeat.
            self.lan_ip_checked_at = now_secs();
        }
        (
            running,
            self.core_controller(),
            self.last_traffic.clone(),
            refresh_lan_ip,
        )
    }

    fn status_from_observed_traffic(
        &mut self,
        observed_running: bool,
        observed_traffic: TrafficSnapshot,
        is_admin: bool,
    ) -> JsonValue {
        let running = self.process.is_some();
        let traffic = if running == observed_running {
            observed_traffic
        } else {
            self.core_controller()
                .status_traffic_snapshot_or_idle(false, &self.last_traffic)
        };
        self.last_traffic = traffic.clone();
        let lan_ip = self.lan_ip_cache.clone();
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
            is_admin,
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
        self.settings
            .profiles
            .iter()
            .map(|profile| {
                public_profile(
                    profile,
                    self.profile_metadata_errors
                        .get(&profile.id)
                        .map(String::as_str),
                )
            })
            .collect()
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
        let previous_settings = self.settings.clone();
        let previous_takeover = self.traffic_takeover;
        let previous_os = read_windows_proxy_snapshot()?;
        let restore_snapshot = self.load_system_proxy_snapshot();
        let mut transaction = system_takeover::SystemTakeoverTransaction::begin(
            &self.app_data,
            if enable {
                "Enable Windows system proxy"
            } else {
                "Restore Windows system proxy"
            },
            "system-proxy",
            enable,
        )?;
        let operation = (|| -> Result<(), String> {
            if enable {
                self.capture_proxy_snapshot_before_takeover()?;
                transaction.step(
                    "system-proxy",
                    "snapshot",
                    "ok",
                    "Manual proxy, bypass list, PAC URL and auto-detect state were captured.",
                )?;
                run_powershell(&build_proxy_script(true, self.settings.mixed_port))?;
                transaction.step(
                    "system-proxy",
                    "apply",
                    "ok",
                    "Aegos manual proxy was applied and competing PAC/auto-detect takeover was paused.",
                )?;
                self.verify_system_proxy_points_to_aegos(true)?;
            } else if let Some(snapshot) = restore_snapshot.as_ref() {
                self.restore_system_proxy_snapshot_verified(snapshot)?;
                transaction.step(
                    "system-proxy",
                    "restore",
                    "ok",
                    "The complete pre-Aegos proxy state was restored and verified.",
                )?;
            } else {
                run_powershell(&build_proxy_script(false, self.settings.mixed_port))?;
                self.verify_system_proxy_points_to_aegos(false)?;
                transaction.step(
                    "system-proxy",
                    "disable",
                    "ok",
                    "No saved snapshot existed; only Aegos manual proxy takeover was disabled.",
                )?;
            }
            self.settings.system_proxy = enable;
            self.traffic_takeover = self.process.is_some()
                && (enable || (self.traffic_takeover && self.settings.tun_enabled));
            self.save_settings()?;
            transaction.step(
                "settings",
                "persist",
                "ok",
                "Applied state was persisted after Windows verification.",
            )?;
            system_takeover::set_component_active(&self.app_data, "system-proxy", enable)?;
            Ok(())
        })();
        if let Err(reason) = operation {
            self.settings = previous_settings;
            self.traffic_takeover = previous_takeover;
            let rollback = self
                .restore_system_proxy_snapshot_verified(&previous_os)
                .and_then(|_| self.save_settings())
                .and_then(|_| {
                    system_takeover::set_component_active(
                        &self.app_data,
                        "system-proxy",
                        core_runtime::system_proxy_snapshot_points_to_aegos(
                            &previous_os,
                            self.settings.mixed_port,
                        ),
                    )
                    .map(|_| ())
                });
            return Err(takeover_failure_message(transaction, reason, rollback));
        }
        transaction.complete_verified(
            if enable {
                "Windows system proxy points to Aegos and the original complete proxy state remains recoverable."
            } else {
                "Windows system proxy no longer points to Aegos and the original complete proxy state was restored."
            },
            || {
                self.settings = previous_settings.clone();
                self.traffic_takeover = previous_takeover;
                let previous_active = core_runtime::system_proxy_snapshot_points_to_aegos(
                    &previous_os,
                    self.settings.mixed_port,
                );
                let restore = self
                    .restore_system_proxy_snapshot_verified(&previous_os)
                    .and_then(|_| self.save_settings())
                    .and_then(|_| {
                        system_takeover::set_component_active(
                            &self.app_data,
                            "system-proxy",
                            previous_active,
                        )
                        .map(|_| ())
                    });
                if restore.is_ok() && !previous_active {
                    self.clear_system_proxy_snapshot();
                }
                restore
            },
        )?;
        if !enable {
            self.clear_system_proxy_snapshot();
        }
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
        let previous_settings = self.settings.clone();
        let mut transaction = system_takeover::SystemTakeoverTransaction::begin(
            &self.app_data,
            if enable {
                "Enable disconnect protection"
            } else {
                "Disable disconnect protection"
            },
            "firewall",
            enable,
        )?;
        let operation = (|| -> Result<(), String> {
            run_powershell(&build_kill_switch_script(
                enable,
                &self.app_data,
                &self.core_path,
            ))?;
            transaction.step(
                "firewall",
                if enable { "apply" } else { "restore" },
                "ok",
                if enable {
                    "Windows firewall defaults were snapshotted; Aegos allow rules and outbound blocking were verified."
                } else {
                    "Saved firewall defaults were restored; all Aegos protection and speed-test rules were removed and verified."
                },
            )?;
            self.settings.kill_switch_enabled = enable;
            self.save_settings()?;
            transaction.step(
                "settings",
                "persist",
                "ok",
                "Disconnect protection state was persisted after firewall verification.",
            )?;
            system_takeover::set_component_active(&self.app_data, "firewall", enable)?;
            Ok(())
        })();
        if let Err(reason) = operation {
            self.settings = previous_settings;
            let rollback = run_powershell(&build_kill_switch_script(
                self.settings.kill_switch_enabled,
                &self.app_data,
                &self.core_path,
            ))
            .map(|_| ())
            .and_then(|_| self.save_settings())
            .and_then(|_| {
                system_takeover::set_component_active(
                    &self.app_data,
                    "firewall",
                    self.settings.kill_switch_enabled,
                )
                .map(|_| ())
            });
            return Err(takeover_failure_message(transaction, reason, rollback));
        }
        transaction.complete_verified(
            if enable {
                "Disconnect protection is active and firewall enforcement was verified."
            } else {
                "Disconnect protection is inactive and no Aegos firewall artifacts remain."
            },
            || {
                self.settings = previous_settings.clone();
                run_powershell(&build_kill_switch_script(
                    self.settings.kill_switch_enabled,
                    &self.app_data,
                    &self.core_path,
                ))
                .map(|_| ())
                .and_then(|_| self.save_settings())
                .and_then(|_| {
                    system_takeover::set_component_active(
                        &self.app_data,
                        "firewall",
                        self.settings.kill_switch_enabled,
                    )
                    .map(|_| ())
                })
            },
        )?;
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

    fn repair_recommended_ports(&mut self) -> Result<JsonValue, String> {
        let mixed_port = find_free_port(
            AEGOS_DEFAULT_MIXED_PORT,
            AEGOS_DEFAULT_MIXED_PORT,
            core_runtime::RESERVED_MIXED_PORTS,
        )?;
        let controller_port = find_free_port(
            AEGOS_DEFAULT_CONTROLLER_PORT,
            AEGOS_DEFAULT_CONTROLLER_PORT,
            &[mixed_port],
        )?;
        let previous = self.settings.clone();
        let was_running = self.process.is_some();
        self.settings.mixed_port = mixed_port;
        self.settings.controller_port = controller_port;
        if let Err(err) = self.validate_port_settings() {
            self.settings = previous;
            return Err(err);
        }
        if let Err(err) = self.save_settings() {
            self.settings = previous;
            return Err(format!(
                "Recommended port settings could not be saved: {err}"
            ));
        }
        if was_running {
            if let Err(err) = self.restart_core_preserving_proxy(350) {
                return Err(self.rollback_settings_after_failure(previous, true, err));
            }
        }
        Ok(json!({
            "ok": true,
            "action": "recommended-ports",
            "mixedPort": mixed_port,
            "controllerPort": controller_port,
            "runtimeRestarted": was_running
        }))
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
        let tun_change = key == "tunEnabled"
            && value.as_bool().unwrap_or(false) != previous_settings.tun_enabled;
        let desired_tun = value.as_bool().unwrap_or(previous_settings.tun_enabled);
        let mut tun_transaction = if tun_change {
            Some(system_takeover::SystemTakeoverTransaction::begin(
                &self.app_data,
                if desired_tun {
                    "Enable TUN takeover"
                } else {
                    "Disable TUN takeover"
                },
                "tun",
                desired_tun,
            )?)
        } else {
            None
        };
        let operation = (|| -> Result<JsonValue, String> {
            self.validate_setting_update_candidate(key, &value)?;
            let restart = match self.apply_setting_value(key, &value) {
                Ok(restart) => restart,
                Err(err) => {
                    return Err(self.rollback_settings_after_failure(
                        previous_settings.clone(),
                        false,
                        err,
                    ));
                }
            };
            if let Some(transaction) = tun_transaction.as_mut() {
                transaction.step(
                    "tun",
                    "prepare",
                    "ok",
                    "TUN candidate settings passed permission and value checks.",
                )?;
            }
            if let Err(err) = self.validate_port_settings() {
                return Err(self.rollback_settings_after_failure(
                    previous_settings.clone(),
                    false,
                    err,
                ));
            }
            if let Err(err) = self.save_settings() {
                self.settings = previous_settings.clone();
                return Err(format!("Settings save failed: {err}"));
            }
            if let Err(err) = self.ensure_direct_profile() {
                return Err(self.rollback_settings_after_failure(
                    previous_settings.clone(),
                    false,
                    err,
                ));
            }
            if let Err(err) = self.restart_after_settings_if_needed(was_running, restart) {
                return Err(self.rollback_settings_after_failure(
                    previous_settings.clone(),
                    was_running,
                    err,
                ));
            }
            if tun_change {
                let report = match self.verify_tun_state(desired_tun, was_running) {
                    Ok(report) => report,
                    Err(err) => {
                        return Err(self.rollback_settings_after_failure(
                            previous_settings.clone(),
                            was_running,
                            err,
                        ));
                    }
                };
                if let Some(transaction) = tun_transaction.as_mut() {
                    transaction.step(
                        "tun",
                        "verify",
                        "ok",
                        format!("TUN candidate/runtime verification passed: {report}"),
                    )?;
                }
                system_takeover::set_component_active(
                    &self.app_data,
                    "tun",
                    desired_tun && was_running,
                )?;
            }
            Ok(self.public_settings())
        })();
        match operation {
            Ok(result) => {
                if let Some(transaction) = tun_transaction {
                    transaction.complete_verified(
                        if was_running {
                            "TUN configuration, controller, Windows route/adapter evidence and connectivity were verified."
                        } else {
                            "TUN candidate configuration was verified; Windows takeover remains deferred until connection."
                        },
                        || {
                            let settings_restore = self.restore_settings_snapshot(
                                previous_settings.clone(),
                                was_running,
                            );
                            let active_state_restore = system_takeover::set_component_active(
                                &self.app_data,
                                "tun",
                                previous_settings.tun_enabled && was_running,
                            )
                            .map(|_| ());
                            combine_restore_results(
                                "settings/runtime restore",
                                settings_restore,
                                "TUN recovery state restore",
                                active_state_restore,
                            )
                        },
                    )?;
                }
                Ok(result)
            }
            Err(err) => {
                if let Some(transaction) = tun_transaction {
                    let rollback_ok = self.settings.tun_enabled == previous_settings.tun_enabled
                        && (!was_running
                            || self
                                .verify_tun_state(previous_settings.tun_enabled, true)
                                .is_ok());
                    let _ = transaction.fail(&err, rollback_ok);
                }
                let _ = system_takeover::set_component_active(
                    &self.app_data,
                    "tun",
                    previous_settings.tun_enabled && was_running,
                );
                Err(err)
            }
        }
    }

    fn update_settings(&mut self, updates: JsonValue) -> Result<JsonValue, String> {
        let map = updates
            .as_object()
            .ok_or_else(|| "Settings update must be an object".to_string())?;
        let previous_settings = self.settings.clone();
        let was_running = self.process.is_some();
        let desired_tun = map
            .get("tunEnabled")
            .and_then(JsonValue::as_bool)
            .unwrap_or(previous_settings.tun_enabled);
        let tun_change = desired_tun != previous_settings.tun_enabled;
        let kill_change = map
            .get("killSwitchEnabled")
            .and_then(JsonValue::as_bool)
            .is_some_and(|value| value != previous_settings.kill_switch_enabled);
        let mut tun_transaction = if tun_change {
            Some(system_takeover::SystemTakeoverTransaction::begin(
                &self.app_data,
                if desired_tun {
                    "Enable TUN takeover"
                } else {
                    "Disable TUN takeover"
                },
                "tun",
                desired_tun,
            )?)
        } else {
            None
        };
        let operation = (|| -> Result<JsonValue, String> {
            let mut restart = false;
            self.validate_settings_update_candidate(map)?;
            for (key, value) in map {
                restart |= match self.apply_setting_value(key, value) {
                    Ok(item_restart) => item_restart,
                    Err(err) => {
                        return Err(self.rollback_settings_after_failure(
                            previous_settings.clone(),
                            false,
                            err,
                        ));
                    }
                };
            }
            if let Err(err) = self.validate_port_settings() {
                return Err(self.rollback_settings_after_failure(
                    previous_settings.clone(),
                    false,
                    err,
                ));
            }
            if let Err(err) = self.save_settings() {
                self.settings = previous_settings.clone();
                return Err(format!("Settings save failed: {err}"));
            }
            if let Err(err) = self.ensure_direct_profile() {
                return Err(self.rollback_settings_after_failure(
                    previous_settings.clone(),
                    false,
                    err,
                ));
            }
            if let Err(err) = self.restart_after_settings_if_needed(was_running, restart) {
                return Err(self.rollback_settings_after_failure(
                    previous_settings.clone(),
                    was_running,
                    err,
                ));
            }
            if tun_change {
                let report = match self.verify_tun_state(desired_tun, was_running) {
                    Ok(report) => report,
                    Err(err) => {
                        return Err(self.rollback_settings_after_failure(
                            previous_settings.clone(),
                            was_running,
                            err,
                        ));
                    }
                };
                if let Some(transaction) = tun_transaction.as_mut() {
                    transaction.step(
                        "tun",
                        "verify",
                        "ok",
                        format!("TUN batch candidate/runtime verification passed: {report}"),
                    )?;
                }
                system_takeover::set_component_active(
                    &self.app_data,
                    "tun",
                    desired_tun && was_running,
                )?;
            }
            Ok(self.public_settings())
        })();
        match operation {
            Ok(result) => {
                if let Some(transaction) = tun_transaction {
                    transaction.complete_verified(
                        if was_running {
                            "Batch settings applied; TUN runtime and Windows takeover were verified."
                        } else {
                            "Batch settings applied; TUN candidate is valid and takeover is deferred until connection."
                        },
                        || {
                            let firewall_restore = if kill_change {
                                run_powershell(&build_kill_switch_script(
                                    previous_settings.kill_switch_enabled,
                                    &self.app_data,
                                    &self.core_path,
                                ))
                                .map(|_| ())
                                .and_then(|_| {
                                    system_takeover::set_component_active(
                                        &self.app_data,
                                        "firewall",
                                        previous_settings.kill_switch_enabled,
                                    )
                                    .map(|_| ())
                                })
                            } else {
                                Ok(())
                            };
                            let settings_restore = self.restore_settings_snapshot(
                                previous_settings.clone(),
                                was_running,
                            );
                            let tun_state_restore = system_takeover::set_component_active(
                                &self.app_data,
                                "tun",
                                previous_settings.tun_enabled && was_running,
                            )
                            .map(|_| ());
                            let system_restore = combine_restore_results(
                                "firewall restore",
                                firewall_restore,
                                "settings/runtime restore",
                                settings_restore,
                            );
                            combine_restore_results(
                                "batch system restore",
                                system_restore,
                                "TUN recovery state restore",
                                tun_state_restore,
                            )
                        },
                    )?;
                }
                Ok(result)
            }
            Err(err) => {
                if kill_change {
                    let _ = run_powershell(&build_kill_switch_script(
                        previous_settings.kill_switch_enabled,
                        &self.app_data,
                        &self.core_path,
                    ));
                    self.settings.kill_switch_enabled = previous_settings.kill_switch_enabled;
                    let _ = self.save_settings();
                }
                if let Some(transaction) = tun_transaction {
                    let rollback_ok = self.settings.tun_enabled == previous_settings.tun_enabled
                        && (!was_running
                            || self
                                .verify_tun_state(previous_settings.tun_enabled, true)
                                .is_ok());
                    let _ = transaction.fail(&err, rollback_ok);
                }
                let _ = system_takeover::set_component_active(
                    &self.app_data,
                    "tun",
                    previous_settings.tun_enabled && was_running,
                );
                Err(err)
            }
        }
    }

    fn set_mode(&mut self, mode: &str) -> Result<String, String> {
        if !["rule", "global", "direct"].contains(&mode) {
            return Err("Unsupported mode".to_string());
        }
        let previous_mode = self.settings.mode.clone();
        let controller = self.core_controller();
        if let Some(result) = controller.apply_mode_if_running(self.process.is_some(), mode) {
            result.map_err(|err| format!("Mode switch was not applied: {err}"))?;
        }
        self.settings.mode = mode.to_string();
        if let Err(save_error) = self.save_settings() {
            self.settings.mode = previous_mode.clone();
            let rollback_error = controller
                .apply_mode_if_running(self.process.is_some(), &previous_mode)
                .and_then(Result::err);
            return Err(match rollback_error {
                Some(rollback_error) => format!(
                    "Mode preference save failed: {save_error}; runtime rollback also failed: {rollback_error}"
                ),
                None => format!(
                    "Mode preference save failed: {save_error}; previous runtime mode was restored"
                ),
            });
        }
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
                            if config_domain::is_subscription_metadata_node_name(name) {
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

    fn speed_target_catalog_key(&self, profile: &Profile) -> String {
        let metadata = fs::metadata(&profile.path).ok();
        let length = metadata.as_ref().map(|item| item.len()).unwrap_or(0);
        let modified_ms = metadata
            .and_then(|item| item.modified().ok())
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        format!(
            "{}:{}:{}:{}:{}",
            profile.id,
            profile.path,
            length,
            modified_ms,
            self.runtime_config_digest.as_deref().unwrap_or("")
        )
    }

    fn speed_targets(&mut self) -> Result<Vec<SpeedTestTarget>, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "No active profile is available for speed testing".to_string())?;
        let key = self.speed_target_catalog_key(&profile);
        if let Some(catalog) = &self.speed_target_catalog {
            if catalog.key == key && catalog.profile_id == profile.id {
                return Ok(catalog.targets.clone());
            }
        }
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        speed_test_preflight(&targets)?;
        self.speed_target_catalog = Some(SpeedTargetCatalog {
            key,
            profile_id: profile.id,
            targets: targets.clone(),
            built_at_ms: now_millis(),
        });
        Ok(targets)
    }

    fn prepare_speed_measurement_runtime(&mut self) -> Result<JsonValue, String> {
        let started = Instant::now();
        // This command runs after startup as an idle optimization. Starting or
        // recovering the data plane here used to contend with status and page
        // snapshots. A real speed-test still prepares the controller on demand.
        if self.process.is_some() {
            return Ok(json!({
                "ok": true,
                "deferred": true,
                "reason": "runtime-active",
                "profileId": self.settings.active_profile_id,
                "targetCount": self.speed_target_catalog.as_ref().map(|item| item.targets.len()).unwrap_or(0),
                "prepareMs": started.elapsed().as_millis() as u64,
                "trafficTakeover": self.traffic_takeover
            }));
        }
        let targets = self.speed_targets()?;
        let catalog = self.speed_target_catalog.as_ref();
        Ok(json!({
            "ok": true,
            "deferred": false,
            "profileId": self.settings.active_profile_id,
            "targetCount": targets.len(),
            "catalogBuiltAtMs": catalog.map(|item| item.built_at_ms).unwrap_or(0),
            "prepareMs": started.elapsed().as_millis() as u64,
            "trafficTakeover": self.traffic_takeover
        }))
    }

    fn current_outbound_ip_proxy_name(&self, groups: &JsonValue) -> Option<String> {
        let primary_groups = if self.settings.mode.eq_ignore_ascii_case("global") {
            OUTBOUND_IP_GLOBAL_PRIMARY_GROUPS
        } else {
            OUTBOUND_IP_RULE_PRIMARY_GROUPS
        };
        ProxyCatalog::from_product_json(groups)
            .ok()?
            .resolve_runtime_leaf(primary_groups)
    }

    fn sync_outbound_ip_group_selection(&mut self) -> Result<Option<String>, String> {
        if self.process.is_none() {
            return Ok(None);
        }
        match sync_outbound_ip_route(&self.core_controller(), &self.settings.mode) {
            Ok(proxy) => Ok(Some(proxy)),
            Err(err) => {
                self.add_log(format!("Outbound IP lookup group sync failed: {err}"), "warn");
                Err(err)
            }
        }
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
        app: AppHandle,
        priority_names: Vec<String>,
    ) -> Result<JsonValue, String> {
        let prepare_started = Instant::now();
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
        let targets = self.speed_targets().map_err(|err| {
            if let Some(run_id) = expected_run_id {
                fail_speed_test_if_current(&self.speed_test, run_id, err.clone(), now_secs());
            }
            err
        })?;
        let total = targets.len();
        if total == 0 {
            return Ok(self.speed_test_snapshot());
        }

        let controller = self.core_controller();
        let speed_test = self.speed_test.clone();
        let previous_health = speed_test.lock().unwrap().health.clone();
        let pending = speed_test_ordered_targets(
            targets.clone(),
            &previous_health,
            &priority_names,
            now_secs(),
        )
        .into_iter()
        .collect::<Vec<_>>();
        let profile_id = self.settings.active_profile_id.clone();
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
            speed.run_id = run_id;
            speed.running = true;
            speed.phase = "fast".to_string();
            speed.revision = speed.revision.saturating_add(1);
            speed.started_at = now;
            speed.updated_at = now;
            speed.prepared_at_ms = now_millis();
            speed.first_result_at_ms = 0;
            speed.fast_completed_at_ms = 0;
            speed.completed_at_ms = 0;
            speed.total = total;
            speed.completed = 0;
            speed.ok = 0;
            speed.failed = 0;
            speed.refine_total = 0;
            speed.refine_completed = 0;
            speed.delays.clear();
            speed.health = previous_health;
            speed.low_latency.clear();
            speed.recommended = None;
            speed.error = None;
        }

        emit_speed_test_event(
            &app,
            json!({
                "kind": "prepared",
                "runId": run_id,
                "profileId": profile_id.clone(),
                "prepareMs": prepare_started.elapsed().as_millis() as u64,
                "status": self.speed_test_snapshot()
            }),
        );

        self.add_log(
            format!(
                "Speed test prepared: {total} nodes in {} ms",
                prepare_started.elapsed().as_millis()
            ),
            "info",
        );
        let speed_health_path = self.speed_health_path.clone();
        let speed_health_root = self.app_data.clone();
        thread::spawn(move || {
            let client = match Client::builder()
                .no_proxy()
                .pool_max_idle_per_host(SPEED_GLOBAL_CONCURRENCY_MAX)
                .tcp_nodelay(true)
                .timeout(Duration::from_millis(6500))
                .build()
            {
                Ok(client) => client,
                Err(err) => {
                    fail_speed_test_if_current(&speed_test, run_id, err.to_string(), now_secs());
                    emit_speed_test_event(
                        &app,
                        json!({
                            "kind": "error",
                            "profileId": profile_id,
                            "status": speed_test_runtime_snapshot(&speed_test, now_secs())
                        }),
                    );
                    return;
                }
            };
            let client = Arc::new(client);
            let fast_controller = controller.clone();
            let fast_client = client.clone();
            let fast_probe = Arc::new(move |target: &SpeedTestTarget| {
                test_proxy_delay_fast(
                    &fast_client,
                    &fast_controller,
                    &target.name,
                    &target.protocol,
                )
            });
            let continue_store = speed_test.clone();
            let event_store = speed_test.clone();
            let event_app = app.clone();
            let event_profile = profile_id.clone();
            let mut refine_targets = Vec::<SpeedTestTarget>::new();
            let fast_report = run_probe_wave(
                pending,
                speed_scheduler_policy(false),
                fast_probe,
                |target| protocol_family(&target.protocol).to_string(),
                move || speed_test_run_is_current(&continue_store, run_id),
                |outcome: ProbeOutcome<SpeedTestTarget, DelayTestResult>| {
                    let ProbeOutcome {
                        target,
                        result,
                        worker_id,
                        queue_ms,
                        probe_ms,
                    } = outcome;
                    let now = now_secs();
                    let event_state = {
                        let mut speed = event_store.lock().unwrap();
                        if !speed.running || speed.run_id != run_id {
                            None
                        } else {
                            if speed.first_result_at_ms == 0 {
                                speed.first_result_at_ms = now_millis();
                            }
                            speed.completed += 1;
                            let health = if result.delay > 0 {
                                speed.ok += 1;
                                update_node_health(
                                    speed.health.get(&target.name),
                                    &target.name,
                                    &target.protocol,
                                    result.delay,
                                    &result.failure_reason,
                                    now,
                                )
                            } else {
                                speed.failed += 1;
                                refine_targets.push(target.clone());
                                refining_node_health(
                                    speed.health.get(&target.name),
                                    &target.name,
                                    &target.protocol,
                                    &result.failure_reason,
                                    now,
                                )
                            };
                            speed.delays.insert(target.name.clone(), result.delay);
                            speed.health.insert(target.name.clone(), health.clone());
                            speed.revision = speed.revision.saturating_add(1);
                            speed.updated_at = now;
                            Some((
                                health,
                                speed.completed,
                                speed.total,
                                speed.ok,
                                speed.failed,
                                speed
                                    .first_result_at_ms
                                    .saturating_sub(speed.accepted_at_ms),
                            ))
                        }
                    };
                    let Some((health, completed, total, ok, failed, first_result_ms)) = event_state
                    else {
                        return false;
                    };
                    emit_speed_test_event(
                        &event_app,
                        json!({
                            "kind": "result",
                            "phase": "fast",
                            "runId": run_id,
                            "profileId": event_profile.clone(),
                            "name": target.name,
                            "selectName": target.select_name,
                            "protocol": target.protocol,
                            "delay": result.delay,
                            "failureReason": health.last_failure_reason.clone(),
                            "probeMs": probe_ms,
                            "queueMs": queue_ms,
                            "workerId": worker_id,
                            "firstResultMs": first_result_ms,
                            "completed": completed,
                            "total": total,
                            "ok": ok,
                            "failed": failed,
                            "health": health
                        }),
                    );
                    result.delay > 0
                },
            );

            if fast_report.cancelled {
                if speed_test_run_is_current(&speed_test, run_id) {
                    fail_speed_test_if_current(
                        &speed_test,
                        run_id,
                        "speed scheduler interrupted before the fast pass completed".to_string(),
                        now_secs(),
                    );
                    emit_speed_test_event(
                        &app,
                        json!({
                            "kind": "error",
                            "runId": run_id,
                            "profileId": profile_id.clone(),
                            "status": speed_test_runtime_snapshot(&speed_test, now_secs())
                        }),
                    );
                }
                return;
            }
            if !speed_test_run_is_current(&speed_test, run_id) {
                return;
            }

            let has_refine = !refine_targets.is_empty();
            {
                let now = now_secs();
                let mut speed = speed_test.lock().unwrap();
                if speed.run_id != run_id || !speed.running {
                    return;
                }
                speed.fast_completed_at_ms = now_millis();
                speed.phase = if has_refine {
                    "refining".to_string()
                } else {
                    "complete".to_string()
                };
                speed.refine_total = refine_targets.len();
                speed.low_latency = low_latency_names(&speed.health, now);
                speed.recommended = speed_recommendation(&targets, &speed.health, now);
                speed.revision = speed.revision.saturating_add(1);
                speed.updated_at = now;
                if !has_refine {
                    speed.running = false;
                    speed.completed_at_ms = now_millis();
                }
            }
            emit_speed_test_event(
                &app,
                json!({
                    "kind": "fast-complete",
                    "runId": run_id,
                    "profileId": profile_id.clone(),
                    "scheduler": fast_report,
                    "status": speed_test_runtime_snapshot(&speed_test, now_secs())
                }),
            );

            if has_refine {
                let refine_controller = controller.clone();
                let refine_client = client.clone();
                let refine_probe = Arc::new(move |target: &SpeedTestTarget| {
                    test_proxy_delay_plan(
                        &refine_client,
                        &refine_controller,
                        &target.name,
                        &target.protocol,
                        DelayProbeDepth::Full,
                    )
                });
                let continue_store = speed_test.clone();
                let event_store = speed_test.clone();
                let event_app = app.clone();
                let event_profile = profile_id.clone();
                let refine_report = run_probe_wave(
                    refine_targets,
                    speed_scheduler_policy(true),
                    refine_probe,
                    |target| protocol_family(&target.protocol).to_string(),
                    move || speed_test_run_is_current(&continue_store, run_id),
                    |outcome: ProbeOutcome<SpeedTestTarget, DelayTestResult>| {
                        let ProbeOutcome {
                            target,
                            result,
                            worker_id,
                            queue_ms,
                            probe_ms,
                        } = outcome;
                        let now = now_secs();
                        let event_state = {
                            let mut speed = event_store.lock().unwrap();
                            if !speed.running || speed.run_id != run_id {
                                None
                            } else {
                                if result.delay > 0 {
                                    speed.ok += 1;
                                    speed.failed = speed.failed.saturating_sub(1);
                                }
                                let health = update_node_health(
                                    speed.health.get(&target.name),
                                    &target.name,
                                    &target.protocol,
                                    result.delay,
                                    &result.failure_reason,
                                    now,
                                );
                                speed.delays.insert(target.name.clone(), result.delay);
                                speed.health.insert(target.name.clone(), health.clone());
                                speed.refine_completed += 1;
                                speed.revision = speed.revision.saturating_add(1);
                                speed.updated_at = now;
                                Some((
                                    health,
                                    speed.ok,
                                    speed.failed,
                                    speed.refine_completed,
                                    speed.refine_total,
                                ))
                            }
                        };
                        let Some((health, ok, failed, refine_completed, refine_total)) =
                            event_state
                        else {
                            return false;
                        };
                        emit_speed_test_event(
                            &event_app,
                            json!({
                                "kind": "refined",
                                "phase": "refining",
                                "runId": run_id,
                                "profileId": event_profile.clone(),
                                "name": target.name,
                                "selectName": target.select_name,
                                "protocol": target.protocol,
                                "delay": result.delay,
                                "failureReason": result.failure_reason,
                                "probeMs": probe_ms,
                                "queueMs": queue_ms,
                                "workerId": worker_id,
                                "completed": total,
                                "total": total,
                                "ok": ok,
                                "failed": failed,
                                "refineCompleted": refine_completed,
                                "refineTotal": refine_total,
                                "health": health
                            }),
                        );
                        result.delay > 0
                    },
                );
                if refine_report.cancelled {
                    if speed_test_run_is_current(&speed_test, run_id) {
                        fail_speed_test_if_current(
                            &speed_test,
                            run_id,
                            "speed scheduler interrupted during background refinement".to_string(),
                            now_secs(),
                        );
                        emit_speed_test_event(
                            &app,
                            json!({
                                "kind": "error",
                                "runId": run_id,
                                "profileId": profile_id.clone(),
                                "status": speed_test_runtime_snapshot(&speed_test, now_secs())
                            }),
                        );
                    }
                    return;
                }
                if !speed_test_run_is_current(&speed_test, run_id) {
                    return;
                }
                {
                    let now = now_secs();
                    let mut speed = speed_test.lock().unwrap();
                    if speed.run_id == run_id {
                        speed.running = false;
                        speed.phase = "complete".to_string();
                        speed.completed_at_ms = now_millis();
                        speed.low_latency = low_latency_names(&speed.health, now);
                        speed.recommended = speed_recommendation(&targets, &speed.health, now);
                        speed.revision = speed.revision.saturating_add(1);
                        speed.updated_at = now;
                    }
                }
            }
            emit_speed_test_event(
                &app,
                json!({
                    "kind": "complete",
                    "runId": run_id,
                    "profileId": profile_id.clone(),
                    "status": speed_test_runtime_snapshot(&speed_test, now_secs())
                }),
            );
            let health = speed_test.lock().unwrap().health.clone();
            let _ = persist_profile_speed_health(
                &speed_health_path,
                &speed_health_root,
                &profile_id,
                &health,
            );
        });
        Ok(self.speed_test_snapshot())
    }

    fn test_single_proxy_delay_for_run(
        &mut self,
        name: String,
        expected_run_id: Option<u64>,
        app: AppHandle,
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
        let targets = match self.speed_targets() {
            Ok(targets) => targets,
            Err(err) => {
                if let Some(run_id) = expected_run_id {
                    fail_speed_test_if_current(&self.speed_test, run_id, err.clone(), now_secs());
                }
                return Err(err);
            }
        };
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
        let speed_health_path = self.speed_health_path.clone();
        let speed_health_root = self.app_data.clone();
        let speed_health_profile = self.settings.active_profile_id.clone();
        let event_profile = self.settings.active_profile_id.clone();
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
            speed.phase = "fast".to_string();
            speed.revision = speed.revision.saturating_add(1);
            speed.started_at = now_secs();
            speed.prepared_at_ms = now_millis();
            speed.first_result_at_ms = 0;
            speed.fast_completed_at_ms = 0;
            speed.completed_at_ms = 0;
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
            let client = match Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(6500))
                .build()
            {
                Ok(client) => client,
                Err(err) => {
                    fail_speed_test_if_current(&speed_test, run_id, err.to_string(), now_secs());
                    emit_speed_test_event(
                        &app,
                        json!({
                            "kind": "error",
                            "runId": run_id,
                            "profileId": event_profile,
                            "status": speed_test_runtime_snapshot(&speed_test, now_secs())
                        }),
                    );
                    return;
                }
            };
            let result =
                test_proxy_delay_with_retry(&client, &controller, &target.name, &target.protocol);
            let now = now_secs();
            let event_state = {
                let mut speed = speed_test.lock().unwrap();
                if speed.run_id != run_id {
                    None
                } else {
                    speed.first_result_at_ms = now_millis();
                    speed.fast_completed_at_ms = speed.first_result_at_ms;
                    speed.completed_at_ms = speed.first_result_at_ms;
                    let health = update_node_health(
                        speed.health.get(&target.name),
                        &target.name,
                        &target.protocol,
                        result.delay,
                        &result.failure_reason,
                        now,
                    );
                    speed.delays.insert(target.name.clone(), result.delay);
                    speed.health.insert(target.name.clone(), health.clone());
                    speed.completed = 1;
                    if result.delay > 0 {
                        speed.ok = 1;
                        speed.failed = 0;
                    } else {
                        speed.ok = 0;
                        speed.failed = 1;
                    }
                    speed.running = false;
                    speed.phase = "complete".to_string();
                    speed.error = if result.delay > 0 {
                        None
                    } else {
                        Some(result.failure_reason.clone())
                    };
                    speed.low_latency = low_latency_names(&speed.health, now);
                    speed.recommended =
                        speed_recommendation(&targets_for_recommendation, &speed.health, now);
                    speed.revision = speed.revision.saturating_add(1);
                    speed.updated_at = now;
                    Some((health, speed.ok, speed.failed))
                }
            };
            let Some((health, ok, failed)) = event_state else {
                return;
            };
            emit_speed_test_event(
                &app,
                json!({
                    "kind": "result",
                    "phase": "single",
                    "runId": run_id,
                    "profileId": event_profile.clone(),
                    "name": target.name,
                    "selectName": target.select_name,
                    "protocol": target.protocol,
                    "delay": result.delay,
                    "failureReason": result.failure_reason,
                    "completed": 1,
                    "total": 1,
                    "ok": ok,
                    "failed": failed,
                    "health": health
                }),
            );
            emit_speed_test_event(
                &app,
                json!({
                    "kind": "complete",
                    "runId": run_id,
                    "profileId": event_profile,
                    "status": speed_test_runtime_snapshot(&speed_test, now_secs())
                }),
            );
            let health = speed_test.lock().unwrap().health.clone();
            let _ = persist_profile_speed_health(
                &speed_health_path,
                &speed_health_root,
                &speed_health_profile,
                &health,
            );
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
        let preflight = core_runtime::validate_proxy_selection_from_groups(&groups, group, proxy)?;
        self.add_log(
            format!(
                "Node switch preflight passed: {} -> {} ({})",
                preflight.group, preflight.proxy, preflight.group_type
            ),
            "info",
        );
        let running = self.process.is_some();
        let controller = self.core_controller();
        if running {
            if let Err(apply_error) = controller.apply_proxy_selection_with_cleanup(group, proxy) {
                let rollback_error = if !preflight.previous_proxy.trim().is_empty()
                    && preflight.previous_proxy != proxy
                {
                    controller
                        .apply_proxy_selection_with_cleanup(group, &preflight.previous_proxy)
                        .err()
                } else {
                    None
                };
                return Err(match rollback_error {
                    Some(rollback_error) => format!(
                        "{}; previous runtime node rollback also failed: {}",
                        core_runtime::classified_error("Node switch", apply_error),
                        rollback_error
                    ),
                    None => core_runtime::classified_error("Node switch", apply_error),
                });
            }
        }
        let previous_preference = self
            .settings
            .selected_proxy_map
            .insert(group.to_string(), proxy.to_string());
        if let Err(save_error) = self.save_settings() {
            match previous_preference {
                Some(value) => {
                    self.settings
                        .selected_proxy_map
                        .insert(group.to_string(), value);
                }
                None => {
                    self.settings.selected_proxy_map.remove(group);
                }
            }
            let rollback_error = if running && !preflight.previous_proxy.trim().is_empty() {
                controller
                    .apply_proxy_selection_with_cleanup(group, &preflight.previous_proxy)
                    .err()
            } else {
                None
            };
            return Err(match rollback_error {
                Some(rollback_error) => format!(
                    "Node preference save failed: {save_error}; runtime rollback also failed: {rollback_error}"
                ),
                None => format!(
                    "Node preference save failed: {save_error}; previous selection was restored"
                ),
            });
        }
        if running {
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
            let previous_health = self.speed_test.lock().unwrap().health.clone();
            let _ = persist_profile_speed_health(
                &self.speed_health_path,
                &self.app_data,
                &previous_profile_id,
                &previous_health,
            );
            self.reset_speed_test_state("profile switched; previous speed test cancelled", true);
            self.speed_target_catalog = None;
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
        if previous_profile_id != id {
            self.speed_test.lock().unwrap().health =
                load_profile_speed_health(&self.speed_health_path, id);
        }
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
                self.speed_test.lock().unwrap().health =
                    load_profile_speed_health(&self.speed_health_path, &previous_profile_id);
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
        let removed_profile = self
            .settings
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
            .ok_or_else(|| "订阅已不存在。".to_string())?;
        let previous_settings = self.settings.clone();
        let previous_legacy_registry = read_routing_user_rules(&self.app_data);
        let was_running = self.process.is_some();
        let was_active = self.settings.active_profile_id == id;
        let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
            self.settings.system_proxy,
            self.traffic_takeover,
            core_runtime::RUNTIME_RESTART_SETTLE_MS,
        );
        // Migrate first, then remove only the old YAML-coupled ownership
        // record. The canonical Aegos store keeps profile-scoped rules as
        // inactive records so a user can rebind them after changing airport.
        let _ = read_aegos_user_rule_store(&self.app_data);
        remove_legacy_routing_user_rules_for_profile(&self.app_data, id)?;
        if was_running && was_active {
            if let Err(err) = self.stop() {
                let _ = write_routing_user_rules(&self.app_data, &previous_legacy_registry);
                return Err(format!("删除订阅前无法安全停止当前连接：{err}"));
            }
        }
        self.settings.profiles.retain(|p| p.id != id);
        if was_active {
            self.settings.active_profile_id = "direct".to_string();
        }
        if let Err(err) = self.save_settings() {
            self.settings = previous_settings;
            let _ = write_routing_user_rules(&self.app_data, &previous_legacy_registry);
            if was_running && was_active {
                let _ = self.start();
            }
            return Err(format!("删除订阅失败，原状态已恢复：{err}"));
        }
        if was_running && was_active {
            if let Err(err) = self.start_from_restart_plan(rollback_plan) {
                self.settings = previous_settings;
                let settings_restore = self.save_settings();
                let registry_restore = write_routing_user_rules(&self.app_data, &previous_legacy_registry);
                let runtime_restore = self.start();
                return Err(format!(
                    "删除订阅后无法恢复网络，已回滚原订阅：{err}；设置恢复：{}；规则登记恢复：{}；连接恢复：{}",
                    restore_result_label(settings_restore),
                    restore_result_label(registry_restore),
                    restore_result_label(runtime_restore.map(|_| ()))
                ));
            }
        }
        if let Err(err) = remove_file_confined(Path::new(&removed_profile.path), &self.profile_dir) {
            self.add_log(
                format!("Profile removed, but stale profile file cleanup failed: {err}"),
                "warning",
            );
        }
        self.profile_metadata_errors.remove(id);
        Ok(true)
    }

    fn save_manual_node(&mut self, input: JsonValue) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "Import or enable a profile before adding a fixed node.".to_string())?;
        let node = normalize_manual_node(&input)?;
        let name = node
            .product_json()
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "固定节点缺少名称".to_string())?
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
        let mut deployment = match self.stage_settings_deployment("Fixed node save") {
            Ok(deployment) => deployment,
            Err(err) => {
                self.settings = previous_settings;
                return Err(format!("Fixed node candidate preparation failed: {err}"));
            }
        };
        if let Err(err) = deployment.promote() {
            self.settings = previous_settings;
            return Err(format!("Fixed node candidate promotion failed: {err}"));
        }
        let runtime_was_active =
            self.process.is_some() && self.settings.active_profile_id == profile.id;
        if runtime_was_active {
            if let Err(err) = self.hot_reload_profile(&profile) {
                self.settings = previous_settings.clone();
                let rollback_runtime = deployment
                    .rollback_with_runtime("fixed node runtime reload failed", || {
                        self.hot_reload_profile(&profile).map(|_| ())
                    });
                let message =
                    match rollback_runtime {
                        Ok(_) => format!("Fixed node hot reload failed after save; settings and runtime were rolled back: {err}"),
                        Err(rollback_err) => format!("Fixed node hot reload failed: {err}; rollback also failed: {rollback_err}"),
                    };
                self.add_log(&message, "error");
                return Err(message);
            }
        }
        let _ = deployment.complete_verified(
            "Fixed node settings promoted and active runtime verification completed.",
            || {
                self.settings = previous_settings.clone();
                if runtime_was_active {
                    self.hot_reload_profile(&profile).map(|_| ())
                } else {
                    Ok(())
                }
            },
        )?;
        self.add_log(
            format!("Manual fixed node saved: {} / {}", profile.name, name),
            "info",
        );
        let product_node = node.product_json();
        Ok(json!({
            "node": product_node,
            "profileId": profile.id,
            "settings": self.public_settings()
        }))
    }
}

fn refresh_lan_ip_detached(app: AppHandle, core: Arc<Mutex<CoreManager>>) {
    thread::spawn(move || {
        let lan_ip = primary_lan_ip();
        if let Ok(mut core) = core.lock() {
            core.lan_ip_cache = lan_ip.clone();
            core.lan_ip_checked_at = now_secs();
        }
        let _ = app.emit(RUNTIME_STATUS_EVENT, json!({ "lanIp": lan_ip }));
    });
}

fn refresh_elevation_detached(app: AppHandle) {
    thread::spawn(move || {
        // PowerShell cold start competes with the WebView2 first navigation.
        // The initial snapshot uses the conservative non-admin state, then
        // this authoritative value is published once the shell is idle.
        thread::sleep(Duration::from_millis(1800));
        let is_admin = is_process_elevated();
        let _ = app.emit(RUNTIME_STATUS_EVENT, json!({ "isAdmin": is_admin }));
    });
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
        .cloned();
    let Some(target) = target else {
        let issue =
            diagnostics_runtime::issue_from_failure("node", "node-not-found", "node not found");
        return Ok(json!({
            "node": { "proxy": name },
            "health": JsonValue::Null,
            "logs": [],
            "lastFailure": JsonValue::Null,
            "issue": issue,
            "suggestions": [],
            "generatedAt": now_secs()
        }));
    };
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
    let failure_reason = health
        .as_ref()
        .map(|item| item.last_failure_reason.trim().to_string())
        .filter(|item| !item.is_empty())
        .or_else(|| {
            last_failure
                .as_ref()
                .and_then(|item| item.get("line"))
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        });
    let issue = failure_reason.as_ref().map(|reason| {
        let classification = core_runtime::classify_failure_reason(reason);
        json!(diagnostics_runtime::issue_from_failure(
            "node",
            classification,
            reason
        ))
    });
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
        "issue": issue,
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
        profile_metadata_errors: core.profile_metadata_errors.clone(),
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
            .map(|profile| {
                public_profile(
                    profile,
                    snapshot
                        .profile_metadata_errors
                        .get(&profile.id)
                        .map(String::as_str),
                )
            })
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
    let runtime_plan = snapshot
        .active_profile
        .as_ref()
        .ok_or_else(|| "no active profile".to_string())
        .and_then(|profile| profile_compiler::compile_profile_file(profile, &snapshot.settings));
    let profile_preflight = runtime_plan.as_ref().map(|runtime| {
        format!(
            "{} proxies, {} groups, {} rules",
            runtime.validation.proxies, runtime.validation.proxy_groups, runtime.validation.rules
        )
    });
    let profile_preflight_ok = profile_preflight.is_ok();
    let profile_preflight_detail = profile_preflight.unwrap_or_else(|err| err.clone());
    let runtime_dns_safety = runtime_plan
        .as_ref()
        .map_err(Clone::clone)
        .and_then(|plan| {
            config_pipeline::runtime_dns_safety_report(plan.runtime_catalog().config())
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
    let conflict_report = windows_network_conflict_report(
        snapshot.settings.mixed_port,
        snapshot.settings.controller_port,
        &snapshot.core_path,
        snapshot.settings.tun_enabled,
    );
    let conflict_ok = conflict_report
        .get("ok")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let conflict_summary = conflict_report
        .get("summary")
        .and_then(JsonValue::as_str)
        .unwrap_or("Network conflict scan unavailable")
        .to_string();
    let conflict_action = conflict_report
        .get("action")
        .and_then(JsonValue::as_str)
        .unwrap_or("Close other proxy or VPN software before retrying TUN.")
        .to_string();
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
            "Proxy and VPN conflicts",
            conflict_ok,
            conflict_summary,
            "warning",
            "network",
            &conflict_action,
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
    ]
    .into_iter()
    .map(diagnostics_runtime::enrich_check)
    .collect::<Vec<_>>();
    let summary = core_runtime::diagnostic_summary_json(&checks);
    let evidence_logs = snapshot
        .status_logs
        .iter()
        .rev()
        .filter(|entry| {
            matches!(entry.level.as_str(), "error" | "warn" | "warning" | "core")
                || matches!(entry.category.as_str(), "diagnostic" | "core")
        })
        .take(80)
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "generatedAt": now_iso(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "status": diagnostics_status_from_snapshot(&snapshot, is_admin),
        "summary": summary,
        "checks": checks,
        "evidenceLogs": evidence_logs,
        "groups": ["connection", "subscription", "node", "dns", "tun", "system-proxy", "firewall"]
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
    let (profile_dir, app_data) = {
        let core = core.lock().unwrap();
        (core.profile_dir.clone(), core.app_data.clone())
    };
    let source = subscription_runtime::download_source_url(url, AEGOS_SUBSCRIPTION_USER_AGENT)?;
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
    let _operation = lock_operation_queue(&operations, "addProfileUrl apply")?;
    let settings = core.lock().unwrap().settings.clone();
    let plan = profile_compiler::compile_profile_source(source.config, &profile, &settings)
        .map_err(|err| {
            subscription_runtime::diagnostic(
                "runtime-preflight",
                format!("runtime config preflight failed: {err}"),
                "the subscription was downloaded, but the generated Mihomo config is not runnable; check unsupported node fields or malformed proxy groups",
            )
        })?;
    let candidate = plan.source_deployment_candidate(&profile_dir, &path, "Subscription import")?;
    let mut deployment =
        config_deployment::ConfigDeploymentTransaction::stage(&app_data, candidate)?;
    deployment.promote()?;
    profile.digest = sha256_file(&path);
    let (was_running, previous_profile_id, previous_profile, rollback_plan) = {
        let core = core.lock().unwrap();
        (
            core.process.is_some(),
            core.settings.active_profile_id.clone(),
            core.active_profile(),
            core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
                core.settings.system_proxy,
                core.traffic_takeover,
                core_runtime::RUNTIME_RESTART_SETTLE_MS,
            ),
        )
    };
    {
        let mut core = core.lock().unwrap();
        core.settings.profiles.push(profile.clone());
        core.settings.active_profile_id = id.clone();
        if let Err(err) = core.save_settings() {
            core.settings.profiles.retain(|item| item.id != profile.id);
            core.settings.active_profile_id = previous_profile_id.clone();
            let rollback =
                deployment.rollback_with_runtime("subscription metadata save failed", || Ok(()));
            return Err(match rollback {
                Ok(_) => err,
                Err(rollback_err) => {
                    format!("{err}; subscription file rollback also failed: {rollback_err}")
                }
            });
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
            let apply_started = Instant::now();
            if let Err(apply_err) = core.hot_reload_runtime_plan(&profile, &plan) {
                core.settings.profiles.retain(|item| item.id != profile.id);
                core.settings.active_profile_id = previous_profile_id.clone();
                let save_result = core.save_settings();
                let runtime_rollback = deployment.rollback_with_runtime(
                    "subscription runtime hot reload failed",
                    || match previous_profile.as_ref() {
                        Some(previous) => core
                            .hot_reload_profile(previous)
                            .map(|_| ())
                            .or_else(|hot_restore_err| {
                                core.add_log(
                                    format!(
                                        "Subscription import hot rollback failed; restarting previous runtime: {hot_restore_err}"
                                    ),
                                    "warn",
                                );
                                let _ = core.stop();
                                core.start_from_restart_plan(rollback_plan).map(|_| ())
                            }),
                        None => {
                            let _ = core.stop();
                            core.start_from_restart_plan(rollback_plan).map(|_| ())
                        }
                    },
                );
                let rollback_result = combine_restore_results(
                    "subscription metadata restore",
                    save_result,
                    "configuration/runtime restore",
                    runtime_rollback.map(|_| ()),
                );
                return Err(match rollback_result {
                    Ok(_) => format!(
                        "Profile import runtime apply failed; rolled back to {previous_profile_id}: {apply_err}"
                    ),
                    Err(rollback_err) => format!(
                        "Profile import runtime apply failed: {apply_err}; rollback to {previous_profile_id} also failed: {rollback_err}"
                    ),
                });
            }
            core.add_log(
                format!(
                    "Subscription import runtime hot reload completed in {} ms without core restart; runtime {}",
                    apply_started.elapsed().as_millis(),
                    core_runtime::digest_prefix(&plan.runtime_digest)
                ),
                "info",
            );
        }
    }
    let _ = deployment.complete_verified(
        "Subscription candidate promoted and profile registration/runtime apply verified.",
        || {
            let mut core = core.lock().unwrap();
            core.settings.profiles.retain(|item| item.id != profile.id);
            core.settings.active_profile_id = previous_profile_id.clone();
            let settings_restore = core.save_settings();
            let runtime_restore = if was_running {
                match previous_profile.as_ref() {
                    Some(previous) => core.hot_reload_profile(previous).map(|_| ()).or_else(|_| {
                        let _ = core.stop();
                        core.start_from_restart_plan(rollback_plan).map(|_| ())
                    }),
                    None => {
                        let _ = core.stop();
                        core.start_from_restart_plan(rollback_plan).map(|_| ())
                    }
                }
            } else {
                Ok(())
            };
            combine_restore_results(
                "subscription metadata restore",
                settings_restore,
                "runtime restore",
                runtime_restore,
            )
        },
    )?;
    Ok(profile)
}

fn update_profile_detached(
    core: Arc<Mutex<CoreManager>>,
    operations: Arc<Mutex<()>>,
    id: &str,
) -> Result<Profile, String> {
    let (mut profile, app_data) = {
        let core = core.lock().unwrap();
        let profile = core
            .settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "Profile not found".to_string())?;
        (profile, core.app_data.clone())
    };
    let Some(url) = profile.source_url.clone() else {
        return Ok(profile);
    };
    let source = subscription_runtime::download_source_url(&url, AEGOS_SUBSCRIPTION_USER_AGENT)?;
    let summary = source.summary.clone();
    let _operation = lock_operation_queue(&operations, "updateProfile apply")?;
    let settings = {
        let core = core.lock().unwrap();
        profile = core
            .settings
            .profiles
            .iter()
            .find(|candidate| candidate.id == id)
            .cloned()
            .ok_or_else(|| "Profile was removed before update apply".to_string())?;
        core.settings.clone()
    };
    if profile.source_url.as_deref() != Some(url.as_str()) {
        return Err(
            "Subscription address changed while the update was downloading; the downloaded result was discarded. Retry the update for the current address."
                .to_string(),
        );
    }
    let previous_profile = profile.clone();
    profile.node_count = summary.proxies;
    profile.proxy_group_count = summary.proxy_groups;
    let plan = profile_compiler::compile_profile_source(source.config, &profile, &settings)
        .map_err(|err| {
            subscription_runtime::diagnostic(
                "runtime-preflight",
                format!("runtime config preflight failed: {err}"),
                "the subscription was downloaded, but the generated Mihomo config is not runnable; the previous subscription is kept",
            )
        })?;
    let profile_path = PathBuf::from(&profile.path);
    let profile_root = profile_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("Profile path has no parent: {}", profile_path.display()))?;
    let candidate =
        plan.source_deployment_candidate(&profile_root, &profile_path, "Subscription update")?;
    let mut deployment =
        config_deployment::ConfigDeploymentTransaction::stage(&app_data, candidate)?;
    deployment.promote()?;
    profile.updated_at = now_iso();
    profile.digest = sha256_file(&profile_path);
    let (was_running, was_active, rollback_plan) = {
        let core = core.lock().unwrap();
        (
            core.process.is_some(),
            core.settings.active_profile_id == id,
            core_runtime::CoreRuntimeRestartPlan::preserving_proxy(
                core.settings.system_proxy,
                core.traffic_takeover,
                core_runtime::RUNTIME_RESTART_SETTLE_MS,
            ),
        )
    };
    {
        let mut core = core.lock().unwrap();
        let Some(stored) = core.settings.profiles.iter_mut().find(|p| p.id == id) else {
            let rollback = deployment.rollback_with_runtime(
                "subscription disappeared before metadata update",
                || Ok(()),
            );
            return Err(match rollback {
                Ok(_) => "Profile was removed before update completed".to_string(),
                Err(rollback_err) => format!(
                    "Profile was removed before update completed; subscription file rollback also failed: {rollback_err}"
                ),
            });
        };
        *stored = profile.clone();
        if let Err(err) = core.save_settings() {
            if let Some(stored) = core.settings.profiles.iter_mut().find(|p| p.id == id) {
                *stored = previous_profile.clone();
            }
            let rollback =
                deployment.rollback_with_runtime("subscription metadata save failed", || Ok(()));
            return Err(match rollback {
                Ok(_) => format!("Profile update save failed; restored previous file: {err}"),
                Err(rollback_err) => format!(
                    "Profile update save failed: {err}; subscription file rollback also failed: {rollback_err}"
                ),
            });
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
            let apply_started = Instant::now();
            if let Err(apply_err) = core.hot_reload_runtime_plan(&profile, &plan) {
                if let Some(stored) = core.settings.profiles.iter_mut().find(|p| p.id == id) {
                    *stored = previous_profile.clone();
                }
                let save_result = core.save_settings();
                let runtime_rollback = deployment.rollback_with_runtime(
                    "subscription runtime hot reload failed",
                    || core
                        .hot_reload_profile(&previous_profile)
                        .map(|_| ())
                        .or_else(|hot_restore_err| {
                            core.add_log(
                                format!(
                                    "Subscription update hot rollback failed; restarting previous runtime: {hot_restore_err}"
                                ),
                                "warn",
                            );
                            let _ = core.stop();
                            core.start_from_restart_plan(rollback_plan).map(|_| ())
                        }),
                );
                let rollback_result = combine_restore_results(
                    "subscription metadata restore",
                    save_result,
                    "configuration/runtime restore",
                    runtime_rollback.map(|_| ()),
                );
                return Err(match rollback_result {
                    Ok(_) => format!(
                        "Profile update runtime apply failed; restored previous subscription: {apply_err}"
                    ),
                    Err(rollback_err) => format!(
                        "Profile update runtime apply failed: {apply_err}; restoring previous subscription also failed: {rollback_err}"
                    ),
                });
            }
            core.add_log(
                format!(
                    "Subscription update runtime hot reload completed in {} ms without core restart; runtime {}",
                    apply_started.elapsed().as_millis(),
                    core_runtime::digest_prefix(&plan.runtime_digest)
                ),
                "info",
            );
        }
    }
    let _ = deployment.complete_verified(
        "Subscription candidate promoted and profile metadata/runtime apply verified.",
        || {
            let mut core = core.lock().unwrap();
            if let Some(stored) = core.settings.profiles.iter_mut().find(|item| item.id == id) {
                *stored = previous_profile.clone();
            }
            let settings_restore = core.save_settings();
            let runtime_restore = if was_running && was_active {
                core.hot_reload_profile(&previous_profile)
                    .map(|_| ())
                    .or_else(|_| {
                        let _ = core.stop();
                        core.start_from_restart_plan(rollback_plan).map(|_| ())
                    })
            } else {
                Ok(())
            };
            combine_restore_results(
                "subscription metadata restore",
                settings_restore,
                "runtime restore",
                runtime_restore,
            )
        },
    )?;
    core.lock()
        .unwrap()
        .profile_metadata_errors
        .remove(&profile.id);
    Ok(profile)
}

fn refresh_outbound_ip_detached(core: Arc<Mutex<CoreManager>>) -> Result<String, String> {
    let (mixed_port, query_generation, profile_id, mode, controller) = {
        let mut core = core.lock().unwrap();
        if core.process.is_none() {
            core.outbound_ip_cache = "-".to_string();
            core.outbound_ip_checked_at = now_secs();
            core.outbound_ip_query_generation = core.outbound_ip_query_generation.saturating_add(1);
            return Err("Outbound IP requires an active or standby connection.".to_string());
        }
        core.outbound_ip_query_generation = core.outbound_ip_query_generation.saturating_add(1);
        (
            core.settings.mixed_port,
            core.outbound_ip_query_generation,
            core.settings.active_profile_id.clone(),
            core.settings.mode.clone(),
            core.core_controller(),
        )
    };
    let selected_proxy = sync_outbound_ip_route(&controller, &mode)?;
    let ip = query_outbound_ip(mixed_port);
    let current_proxy = runtime_current_proxy_route(&controller, &mode)
        .ok()
        .map(|(_, proxy)| proxy);
    let mut core = core.lock().unwrap();
    if core.outbound_ip_query_generation != query_generation
        || core.settings.active_profile_id != profile_id
        || core.settings.mode != mode
        || current_proxy.as_deref() != Some(selected_proxy.as_str())
    {
        core.add_log(
            "Outbound IP refresh result ignored because the selected node changed.",
            "info",
        );
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
            Err(err) => {
                let classification = core_runtime::classify_failure_reason(&err);
                let issue = diagnostics_runtime::issue_from_failure(
                    "subscription update",
                    classification,
                    &err,
                );
                failed.push(json!({
                    "id": profile_id,
                    "error": issue.public_message(),
                    "issue": issue
                }));
            }
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
        "repairDiagnostic" => "修复诊断问题",
        "addProfileUrl" => "导入订阅",
        "renameProfile" => "重命名订阅",
        "updateProfile" | "updateAllProfiles" => "更新订阅",
        "recoverNetwork" => "修复网络",
        "refreshOutboundIp" => "刷新落地 IP",
        "diagnostics" => "运行诊断",
        "startCore" => "建立连接",
        "stopCore" => "断开连接",
        "restartCore" => "重启网络核心",
        "setActiveProfile" => "切换订阅",
        "removeProfile" => "删除订阅",
        "updateSettings" | "updateSetting" => "保存设置",
        "setMode" => "切换模式",
        "changeProxy" => "切换节点",
        "selectBestProxy" => "选择推荐节点",
        "repairSystemProxy" => "修复系统代理",
        "applyRoutingDrafts" => "应用分流规则",
        "undoRoutingApply" => "撤销分流规则",
        "applyRoutingGroupEdit" => "编辑策略组",
        "applyRoutingRuleEdit" => "编辑用户规则",
        "resolveUnboundRoutingRule" => "处理待绑定规则",
        "exportDiagnostics" => "导出支持报告",
        _ => "后台任务",
    }
    .to_string()
}

fn is_supported_diagnostic_repair_action(action: &str) -> bool {
    matches!(
        action,
        "system-proxy"
            | "recommended-ports"
            | "cleanup-firewall"
            | "restart-core"
            | "recover-network"
    )
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
            | "repairDiagnostic"
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
            | "resolveUnboundRoutingRule"
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
        set_job_state(&jobs, &id, "running", 0, 3, "正在准备");
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
                        set_job_state(&jobs, &id, "running", 1, 3, "正在下载订阅");
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
                        set_job_state(&jobs, &id, "running", 1, 3, "正在更新订阅");
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
                set_job_state(&jobs, &id, "running", 1, 2, "正在查询落地 IP");
                refresh_outbound_ip_detached(core.clone()).map(|ip| json!({ "ip": ip }))
            }
            "diagnostics" => {
                set_job_state(&jobs, &id, "running", 1, 2, "正在检查网络状态");
                Ok(diagnostics_detached(core.clone()))
            }
            "repairDiagnostic" => (|| -> Result<JsonValue, String> {
                let action = payload
                    .get("action")
                    .and_then(JsonValue::as_str)
                    .ok_or_else(|| "Missing diagnostic repair action".to_string())?;
                if !is_supported_diagnostic_repair_action(action) {
                    return Err("Unsupported diagnostic repair action".to_string());
                }
                set_job_state(&jobs, &id, "running", 1, 4, "正在验证并修复");
                let _operation = lock_operation_queue(&operations, "repairDiagnostic")?;
                let mut core = core.lock().unwrap();
                match action {
                    "system-proxy" => core.repair_system_proxy_takeover(),
                    "recommended-ports" => core.repair_recommended_ports(),
                    "cleanup-firewall" => core
                        .set_kill_switch(false)
                        .map(|_| json!({ "ok": true, "action": action })),
                    "restart-core" => {
                        if core.process.is_some() {
                            core.restart_core_preserving_proxy(350)
                        } else {
                            core.start()
                        }
                    }
                    "recover-network" => core.recover_network(true),
                    _ => Err(format!("Unsupported diagnostic repair action: {action}")),
                }
            })(),
            "exportDiagnostics" => {
                set_job_state(&jobs, &id, "running", 1, 2, "正在导出支持报告");
                export_diagnostics_report_from_state(core.clone(), &app_data)
            }
            "recoverNetwork" => {
                let force = payload
                    .get("force")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                set_job_state(&jobs, &id, "running", 1, 4, "正在修复网络");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "recoverNetwork")?;
                    core.lock().unwrap().recover_network(force)
                })()
            }
            "startCore" => {
                set_job_state(&jobs, &id, "running", 1, 4, "正在建立连接");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "startCore")?;
                    core.lock().unwrap().start()
                })()
            }
            "stopCore" => {
                set_job_state(&jobs, &id, "running", 1, 2, "正在断开连接");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "stopCore")?;
                    core.lock().unwrap().stop()
                })()
            }
            "restartCore" => {
                set_job_state(&jobs, &id, "running", 1, 5, "正在重启网络核心");
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
                        set_job_state(&jobs, &id, "running", 1, 4, "正在切换订阅");
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
                set_job_state(&jobs, &id, "running", 1, 4, "正在保存设置");
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
                set_job_state(&jobs, &id, "running", 1, 3, "正在保存设置");
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
                        set_job_state(&jobs, &id, "running", 1, 2, "正在切换模式");
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
                set_job_state(&jobs, &id, "running", 1, 2, "正在切换节点");
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
                set_job_state(&jobs, &id, "running", 1, 4, "正在预检分流规则");
                let _operation = lock_operation_queue(&operations, "applyRoutingDrafts")?;
                core.lock().unwrap().apply_user_rule_store_drafts(drafts)
            })(),
            "undoRoutingApply" => (|| -> Result<JsonValue, String> {
                set_job_state(&jobs, &id, "running", 1, 3, "正在撤销分流规则");
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
                set_job_state(&jobs, &id, "running", 1, 4, "正在保存用户规则");
                let _operation = lock_operation_queue(&operations, "applyRoutingRuleEdit")?;
                core.lock().unwrap().apply_user_rule_store_edit(edit)
            })(),
            "resolveUnboundRoutingRule" => (|| -> Result<JsonValue, String> {
                let input = serde_json::from_value::<UnboundRuleResolutionInput>(payload.clone())
                    .map_err(|err| format!("Invalid unbound rule resolution: {err}"))?;
                set_job_state(&jobs, &id, "running", 1, 4, "正在处理待绑定规则");
                let _operation = lock_operation_queue(&operations, "resolveUnboundRoutingRule")?;
                core.lock().unwrap().resolve_unbound_user_rule(input)
            })(),
            _ => Err("Unsupported job kind".to_string()),
        };
        let result = match result {
            Ok(value) => Ok(value),
            Err(raw) => {
                let classification = core_runtime::classify_failure_reason(&raw);
                let issue = diagnostics_runtime::issue_from_failure(&kind, classification, &raw);
                if let Ok(core) = core.lock() {
                    core.add_log(format!("{} technical detail: {}", issue.code, raw), "error");
                }
                set_job_issue(&jobs, &id, json!(issue.clone()));
                Err(issue.public_message())
            }
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
fn app_status(state: State<AppState>, app: AppHandle) -> Result<JsonValue, String> {
    let command_started = Instant::now();
    let first_lock_started = Instant::now();
    let (observed_running, controller, previous_traffic, refresh_lan_ip) = {
        let mut core = state
            .core
            .lock()
            .map_err(|_| "core state lock poisoned before status observation".to_string())?;
        core.status_observation()
    };
    let first_lock_ms = first_lock_started.elapsed().as_millis() as u64;
    let traffic_started = Instant::now();
    let observed_traffic =
        controller.status_traffic_snapshot_or_idle(observed_running, &previous_traffic);
    let traffic_ms = traffic_started.elapsed().as_millis() as u64;
    let final_lock_started = Instant::now();
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core state lock poisoned after status observation".to_string())?;
    let is_admin = cached_process_elevated().unwrap_or(false);
    let mut status = core.status_from_observed_traffic(observed_running, observed_traffic, is_admin);
    let final_lock_ms = final_lock_started.elapsed().as_millis() as u64;
    if let Some(map) = status.as_object_mut() {
        map.insert(
            "runtimeObservationMs".to_string(),
            json!({
                "firstLock": first_lock_ms,
                "traffic": traffic_ms,
                "finalLock": final_lock_ms,
                "total": command_started.elapsed().as_millis() as u64
            }),
        );
    }
    drop(core);
    // The LAN probe is intentionally started after publishing the status
    // snapshot. On cold start it must not win the manager lock race.
    if refresh_lan_ip {
        refresh_lan_ip_detached(app.clone(), Arc::clone(&state.core));
    }
    if cached_process_elevated().is_none() {
        refresh_elevation_detached(app);
    }
    Ok(status)
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
async fn proxy_groups(state: State<'_, AppState>) -> Result<JsonValue, String> {
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
    tauri::async_runtime::spawn_blocking(move || {
        Ok(assemble_proxy_groups_snapshot(
            running,
            controller,
            active_profile,
            selected_map,
            manual_names,
            speed,
        ))
    })
    .await
    .map_err(|err| format!("Proxy snapshot worker stopped: {err}"))?
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
    let mut report = routing_diagnostics_report_from_parts(
        &profile,
        rule_validation,
        reload_preflight,
        rollback_plan,
    );
    if let Some(map) = report.as_object_mut() {
        map.insert(
            "lastRoutingDeployment".to_string(),
            read_routing_deployment_report(&state.app_data),
        );
    }
    Ok(report)
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
    state.core.lock().unwrap().apply_user_rule_store_drafts(drafts)
}

#[tauri::command]
fn undo_last_routing_apply(state: State<AppState>) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "undo_last_routing_apply command")?;
    state.core.lock().unwrap().undo_last_routing_apply()
}

#[tauri::command]
fn prepare_speed_runtime(state: State<AppState>, app: AppHandle) -> Result<JsonValue, String> {
    if state.speed_prepare_running.swap(true, Ordering::AcqRel) {
        return Ok(json!({ "ok": true, "queued": false, "preparing": true }));
    }
    let core = state.core.clone();
    let preparing = state.speed_prepare_running.clone();
    thread::spawn(move || {
        let result = core
            .lock()
            .map_err(|_| "Speed runtime lock is poisoned".to_string())
            .and_then(|mut core| core.prepare_speed_measurement_runtime());
        preparing.store(false, Ordering::Release);
        match result {
            Ok(status) => {
                emit_speed_test_event(&app, json!({ "kind": "runtime-ready", "status": status }))
            }
            Err(error) => {
                emit_speed_test_event(&app, json!({ "kind": "runtime-error", "error": error }))
            }
        }
    });
    Ok(json!({ "ok": true, "queued": true, "preparing": true }))
}

#[tauri::command]
fn start_proxy_delay_test(
    state: State<AppState>,
    app: AppHandle,
    priority_names: Option<Vec<String>>,
) -> Result<JsonValue, String> {
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
    let priority_names = priority_names.unwrap_or_default();
    thread::spawn(move || {
        let result =
            core.lock()
                .unwrap()
                .start_proxy_delay_test_for_run(Some(run_id), app, priority_names);
        if let Err(err) = result {
            fail_speed_test_if_current(&speed_test, run_id, err, now_secs());
        }
    });
    Ok(snapshot)
}

#[tauri::command]
fn test_single_proxy_delay(
    state: State<AppState>,
    app: AppHandle,
    name: String,
) -> Result<JsonValue, String> {
    let snapshot = mark_single_speed_test_preparing(&state.speed_test, &name, now_secs())?;
    let run_id = snapshot
        .get("runId")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if run_id == 0 {
        return Ok(snapshot);
    }
    emit_speed_test_event(
        &app,
        json!({
            "kind": "started",
            "runId": run_id,
            "status": snapshot
        }),
    );
    let core = state.core.clone();
    let speed_test = state.speed_test.clone();
    let queued_name = name.clone();
    thread::spawn(move || {
        let result = core
            .lock()
            .unwrap()
            .test_single_proxy_delay_for_run(name, Some(run_id), app);
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
fn speed_test_progress(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(speed_test_progress_snapshot(&state.speed_test))
}

#[tauri::command]
fn cancel_proxy_delay_test(state: State<AppState>, app: AppHandle) -> Result<JsonValue, String> {
    reset_speed_test_runtime_state(&state.speed_test, "cancelled", false, now_secs());
    let status = speed_test_runtime_snapshot(&state.speed_test, now_secs());
    emit_speed_test_event(
        &app,
        json!({
            "kind": "cancelled",
            "status": status
        }),
    );
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
            let plan = profile_compiler::compile_profile_file(profile, &settings)?;
            config_pipeline::runtime_dns_safety_report(plan.runtime_catalog().config())
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
    let conflict_report = windows_network_conflict_report(
        settings.mixed_port,
        settings.controller_port,
        &core_path,
        settings.tun_enabled,
    );
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
        json!({
            "id": "network-conflicts",
            "label": "Other proxy or VPN software",
            "ok": conflict_report.get("ok").and_then(JsonValue::as_bool).unwrap_or(false),
            "level": conflict_report.get("level").and_then(JsonValue::as_str).unwrap_or("warning"),
            "detail": conflict_report.get("summary").and_then(JsonValue::as_str).unwrap_or("Network conflict scan unavailable"),
            "action": conflict_report.get("action").and_then(JsonValue::as_str).unwrap_or("Close other proxy or VPN software before retrying TUN."),
            "findings": conflict_report.get("findings").cloned().unwrap_or_else(|| json!([]))
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

fn aegos_user_rule_store_path(app_data: &Path) -> PathBuf {
    app_data.join("aegos-user-rules.json")
}

fn routing_deployment_report_path(app_data: &Path) -> PathBuf {
    app_data.join("routing-deployment-report.json")
}

fn routing_store_rollback_path(app_data: &Path) -> PathBuf {
    app_data.join("routing-user-rules.rollback.json")
}

fn routing_store_undo_path(app_data: &Path) -> PathBuf {
    app_data.join("routing-user-rules.undo.json")
}

fn write_routing_store_undo(
    app_data: &Path,
    profile: &Profile,
    previous: &UserRuleStore,
    applied_count: usize,
) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(&json!({
        "profileId": profile.id,
        "profileName": profile.name,
        "appliedCount": applied_count,
        "rollbackAvailable": true,
        "createdAt": now_iso(),
        "store": previous
    }))
    .map_err(|err| err.to_string())?;
    atomic_write_text_confined(&routing_store_undo_path(app_data), app_data, &raw)
}

fn read_routing_deployment_report(app_data: &Path) -> JsonValue {
    fs::read_to_string(routing_deployment_report_path(app_data))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

fn write_routing_deployment_report(app_data: &Path, report: &JsonValue) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(report).map_err(|err| err.to_string())?;
    atomic_write_text_confined(&routing_deployment_report_path(app_data), app_data, &raw)
}

fn stage_routing_store_transaction(
    app_data: &Path,
    operation: &str,
    profile_id: &str,
    previous: &UserRuleStore,
    candidate: &UserRuleStore,
) -> Result<(), String> {
    let backup = serde_json::to_string_pretty(previous).map_err(|err| err.to_string())?;
    atomic_write_text_confined(&routing_store_rollback_path(app_data), app_data, &backup)?;
    write_routing_deployment_report(app_data, &json!({
        "operation": operation,
        "profileId": profile_id,
        "status": "prepared",
        "candidateValidated": false,
        "rollbackReady": true,
        "startedAt": now_iso()
    }))?;
    if let Err(err) = write_aegos_user_rule_store(app_data, candidate) {
        let _ = write_routing_deployment_report(app_data, &json!({
            "operation": operation,
            "profileId": profile_id,
            "status": "rolled-back",
            "storeRestored": true,
            "failure": sanitize_sensitive_text(&err),
            "finishedAt": now_iso()
        }));
        let _ = remove_file_confined(&routing_store_rollback_path(app_data), app_data);
        return Err(err);
    }
    write_routing_deployment_report(app_data, &json!({
        "operation": operation,
        "profileId": profile_id,
        "status": "promoted",
        "candidateValidated": true,
        "rollbackReady": true,
        "startedAt": now_iso()
    }))
}

fn finish_routing_store_transaction(
    app_data: &Path,
    operation: &str,
    profile_id: &str,
    details: JsonValue,
) -> Result<(), String> {
    write_routing_deployment_report(app_data, &json!({
        "operation": operation,
        "profileId": profile_id,
        "status": "verified",
        "candidateValidated": true,
        "runtimeVerified": true,
        "rollbackReady": true,
        "details": details,
        "finishedAt": now_iso()
    }))?;
    remove_file_confined(&routing_store_rollback_path(app_data), app_data)
}

fn rollback_routing_store_transaction(
    app_data: &Path,
    operation: &str,
    profile_id: &str,
    previous: &UserRuleStore,
    failure: &str,
    runtime_restored: bool,
) -> Result<(), String> {
    write_aegos_user_rule_store(app_data, previous)?;
    write_routing_deployment_report(app_data, &json!({
        "operation": operation,
        "profileId": profile_id,
        "status": "rolled-back",
        "storeRestored": true,
        "runtimeRestored": runtime_restored,
        "failure": sanitize_sensitive_text(failure),
        "finishedAt": now_iso()
    }))?;
    remove_file_confined(&routing_store_rollback_path(app_data), app_data)
}

fn recover_interrupted_routing_store_transaction(app_data: &Path) -> Result<bool, String> {
    let report = read_routing_deployment_report(app_data);
    let status = report.get("status").and_then(JsonValue::as_str).unwrap_or("");
    if !matches!(status, "prepared" | "promoted") {
        return Ok(false);
    }
    let backup_path = routing_store_rollback_path(app_data);
    let backup_raw = fs::read_to_string(&backup_path)
        .map_err(|err| format!("规则事务未完成，但回滚快照不可用：{err}"))?;
    let previous: UserRuleStore = serde_json::from_str(&backup_raw)
        .map_err(|err| format!("规则回滚快照损坏：{err}"))?;
    write_aegos_user_rule_store(app_data, &previous)?;
    write_routing_deployment_report(app_data, &json!({
        "operation": report.get("operation").cloned().unwrap_or_else(|| json!("unknown")),
        "profileId": report.get("profileId").cloned().unwrap_or_else(|| json!("")),
        "status": "recovered-after-interruption",
        "storeRestored": true,
        "runtimeRestoredOnNextStart": true,
        "finishedAt": now_iso()
    }))?;
    remove_file_confined(&backup_path, app_data)?;
    Ok(true)
}

fn user_rule_record_from_legacy(profile_id: &str, raw: &str, enabled: bool, priority: u32) -> Option<UserRuleRecord> {
    let parsed = parse_routing_rule_text(0, raw);
    let kind = parsed.get("kind")?.as_str()?.trim();
    let condition = parsed.get("condition")?.as_str()?.trim();
    let target = parsed.get("target")?.as_str()?.trim();
    if kind.is_empty() || condition.is_empty() || target.is_empty() || target == "-" {
        return None;
    }
    let option = parsed
        .get("options")
        .and_then(JsonValue::as_array)
        .and_then(|items| items.first())
        .and_then(JsonValue::as_str)
        .map(str::to_string);
    let fingerprint = sha256_text(&format!("{profile_id}\u{1f}{raw}"));
    Some(UserRuleRecord {
        id: format!("legacy-{}", &fingerprint[..16]),
        scope: UserRuleScope::Profile {
            profile_id: profile_id.to_string(),
        },
        kind: kind.to_string(),
        condition: condition.to_string(),
        target: target.to_string(),
        option,
        enabled,
        priority,
        label: String::new(),
        source: "legacy".to_string(),
        created_at: now_iso(),
        updated_at: now_iso(),
    })
}

fn read_aegos_user_rule_store(app_data: &Path) -> UserRuleStore {
    let path = aegos_user_rule_store_path(app_data);
    if let Some(store) = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<UserRuleStore>(&raw).ok())
    {
        return store.normalized();
    }
    let legacy = read_routing_user_rules(app_data);
    let mut rules = Vec::new();
    let mut priority = 1_u32;
    if let Some(profiles) = legacy.as_object() {
        for (profile_id, entry) in profiles {
            let (active, disabled) = if entry.is_array() {
                (json_string_list(Some(entry)), Vec::new())
            } else {
                (json_string_list(entry.get("active")), json_string_list(entry.get("disabled")))
            };
            for raw in active {
                if let Some(rule) = user_rule_record_from_legacy(profile_id, &raw, true, priority) {
                    rules.push(rule);
                    priority = priority.saturating_add(1);
                }
            }
            for raw in disabled {
                if let Some(rule) = user_rule_record_from_legacy(profile_id, &raw, false, priority) {
                    rules.push(rule);
                    priority = priority.saturating_add(1);
                }
            }
        }
    }
    let store = UserRuleStore { version: 1, rules }.normalized();
    if !store.rules.is_empty() {
        let _ = write_aegos_user_rule_store(app_data, &store);
    }
    store
}

fn write_aegos_user_rule_store(app_data: &Path, store: &UserRuleStore) -> Result<(), String> {
    let path = aegos_user_rule_store_path(app_data);
    let raw = serde_json::to_string_pretty(&store.clone().normalized()).map_err(|err| err.to_string())?;
    atomic_write_text_confined(&path, app_data, &raw)
}

fn apply_aegos_user_rule_overlay(
    app_data: &Path,
    profile: &Profile,
    source: &mut YamlValue,
) -> Result<(), String> {
    let store = read_aegos_user_rule_store(app_data);
    let active_rules = store.active_for_profile(&profile.id);
    let legacy_rules = routing_user_rule_lists(app_data, &profile.id).0;
    let legacy_set = legacy_rules
        .iter()
        .map(|rule| rule.trim())
        .collect::<HashSet<_>>();
    let targets = routing_rule_target_catalog(source);
    let Some(config) = source.as_mapping_mut() else {
        return Err("profile root is not a YAML object".to_string());
    };
    let rules = ensure_yaml_sequence(config, "rules");
    // Migration compatibility: legacy Aegos rules were written into the
    // subscription file. Remove only entries the old registry explicitly
    // owned, then place the canonical rule-store overlay before MATCH.
    rules.retain(|value| {
        value
            .as_str()
            .map(|raw| !legacy_set.contains(raw.trim()))
            .unwrap_or(true)
    });
    let existing = rules
        .iter()
        .filter_map(YamlValue::as_str)
        .map(str::trim)
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let insert_at = rules
        .iter()
        .position(|value| {
            value
                .as_str()
                .map(|raw| raw.trim_start().to_ascii_uppercase().starts_with("MATCH,"))
                .unwrap_or(false)
        })
        .unwrap_or(rules.len());
    let overlay = active_rules
        .into_iter()
        // A removed subscription target must not break a future subscription
        // update. Keep the intent in Aegos, but omit it from this runtime
        // candidate until the user explicitly rebinds it.
        .filter(|rule| routing_domain::target_exists(&targets, &rule.target))
        .map(|rule| rule.raw())
        .filter(|raw| !existing.contains(raw.trim()))
        .collect::<Vec<_>>();
    for (offset, raw) in overlay.iter().enumerate() {
        rules.insert(insert_at + offset, yaml_str(raw));
    }
    Ok(())
}

fn json_string_list(value: Option<&JsonValue>) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(|text| text.trim().to_string()))
        .filter(|value| !value.is_empty() && seen.insert(value.to_string()))
        .collect()
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

fn remove_legacy_routing_user_rules_for_profile(app_data: &Path, profile_id: &str) -> Result<(), String> {
    let mut registry = read_routing_user_rules(app_data);
    let Some(map) = registry.as_object_mut() else {
        return Ok(());
    };
    map.remove(profile_id);
    write_routing_user_rules(app_data, &registry)
}

fn routing_user_rule_lists(app_data: &Path, profile_id: &str) -> (Vec<String>, Vec<String>) {
    let registry = read_routing_user_rules(app_data);
    let Some(entry) = registry.get(profile_id) else {
        return (Vec::new(), Vec::new());
    };
    if entry.is_array() {
        return (json_string_list(Some(entry)), Vec::new());
    }
    let active = json_string_list(entry.get("active"));
    let active_set = active.iter().map(String::as_str).collect::<HashSet<_>>();
    let disabled = json_string_list(entry.get("disabled"))
        .into_iter()
        .filter(|rule| !active_set.contains(rule.as_str()))
        .collect();
    (active, disabled)
}

fn write_routing_user_rule_lists(
    app_data: &Path,
    profile_id: &str,
    active: &[String],
    disabled: &[String],
) -> Result<(), String> {
    let mut registry = read_routing_user_rules(app_data);
    if !registry.is_object() {
        registry = json!({});
    }
    let Some(map) = registry.as_object_mut() else {
        return Ok(());
    };
    let mut seen_active = HashSet::new();
    let active = active
        .iter()
        .map(|rule| rule.trim().to_string())
        .filter(|rule| !rule.is_empty() && seen_active.insert(rule.to_string()))
        .collect::<Vec<_>>();
    let active_set = active.iter().map(String::as_str).collect::<HashSet<_>>();
    let mut seen_disabled = HashSet::new();
    let disabled = disabled
        .iter()
        .map(|rule| rule.trim().to_string())
        .filter(|rule| {
            !rule.is_empty()
                && !active_set.contains(rule.as_str())
                && seen_disabled.insert(rule.to_string())
        })
        .collect::<Vec<_>>();
    map.insert(
        profile_id.to_string(),
        json!({
            "active": active,
            "disabled": disabled
        }),
    );
    write_routing_user_rules(app_data, &registry)
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
        let outbound_ip_rule = target == AEGOS_OUTBOUND_IP_GROUP
            || condition.contains("api.ipify.org")
            || condition.contains("api6.ipify.org")
            || condition.contains("checkip.amazonaws.com")
            || condition.contains("ifconfig.me")
            || condition.contains("icanhazip.com")
            || condition.contains("ident.me");
        if !outbound_ip_rule {
            continue;
        }
        if let Some(map) = item.as_object_mut() {
            map.insert("source".to_string(), json!("system"));
            map.insert("editable".to_string(), json!(false));
            map.insert("systemRuleKind".to_string(), json!("outbound-ip"));
            map.insert(
                "explanation".to_string(),
                json!("Aegos uses this hidden rule to query the current node outbound IP. It does not switch nodes, does not change the user mode, and cannot be edited."),
            );
            map.insert(
                "userImpact".to_string(),
                json!("Only Aegos outbound IP checks use this rule; normal website and app routing is still decided by user rules first."),
            );
            map.insert(
                "lockedReason".to_string(),
                json!("System protection rule: editing it could make outbound IP display inaccurate or leak through the wrong route."),
            );
        }
    }
}

fn normalize_routing_draft_rule(
    draft: &RoutingDraftInput,
    targets: &HashSet<String>,
) -> Result<(String, JsonValue), String> {
    let compiled = draft.compile(targets)?;
    let rule = compiled.rule.clone();
    Ok((
        rule.clone(),
        json!({
            "kind": compiled.kind,
            "condition": sanitize_sensitive_text(&compiled.condition),
            "target": sanitize_sensitive_text(&compiled.target),
            "option": compiled.option,
            "label": sanitize_sensitive_text(&compiled.label),
            "source": compiled.source,
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
        let known = target != "-" && routing_domain::target_exists(targets, &target);
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
    let config = match cached_profile_yaml(path) {
        Ok(config) => config,
        Err(err) => {
            return (
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Some(format!("profile config read failed {}: {err}", path.display())),
            )
        }
    };
    let fingerprint = match profile_yaml_fingerprint(path) {
        Ok(fingerprint) => fingerprint,
        Err(err) => {
            return (
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Some(format!("profile config read failed {}: {err}", path.display())),
            )
        }
    };
    let cache = PROFILE_YAML_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = cache.lock() {
        if let Some(snapshot) = entries
            .get(path)
            .filter(|entry| entry.fingerprint == fingerprint)
            .and_then(|entry| entry.routing_rules.as_ref())
        {
            return (
                snapshot.rules.clone(),
                snapshot.missing_targets.clone(),
                snapshot.order_issues.clone(),
                None,
            );
        }
    }
    let mut rules = yaml_sequence(config.as_ref(), "rules")
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, value)| parse_routing_rule_value(index + 1, value))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let targets = routing_rule_target_catalog(config.as_ref());
    let missing_targets = validate_routing_rule_targets(&mut rules, &targets);
    let order_issues = detect_routing_rule_order_issues(&mut rules);
    let snapshot = RoutingRulesProfileSnapshot {
        rules: rules.clone(),
        missing_targets: missing_targets.clone(),
        order_issues: order_issues.clone(),
    };
    if let Ok(mut entries) = cache.lock() {
        if let Some(entry) = entries
            .get_mut(path)
            .filter(|entry| entry.fingerprint == fingerprint)
        {
            entry.routing_rules = Some(snapshot);
        }
    }
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

fn routing_config_rules_for_profile(app_data: &Path, profile: Option<&Profile>) -> Vec<JsonValue> {
    let (mut rules, _, _, _) = routing_rules_for_profile(profile);
    if let Some(profile) = profile {
        let (legacy_active, legacy_disabled) = routing_user_rule_lists(app_data, &profile.id);
        let legacy = legacy_active
            .iter()
            .chain(legacy_disabled.iter())
            .map(|raw| raw.trim())
            .collect::<HashSet<_>>();
        rules.retain(|item| {
            item.get("raw")
                .and_then(JsonValue::as_str)
                .map(|raw| !legacy.contains(raw.trim()))
                .unwrap_or(true)
        });
    }
    mark_system_routing_rules(&mut rules);
    rules
        .into_iter()
        .filter(|item| item.get("source").and_then(JsonValue::as_str) != Some("system"))
        .collect()
}

fn routing_rule_matches_domain(item: &JsonValue, domain: &str) -> bool {
    let kind = item
        .get("kind")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_ascii_uppercase();
    let condition = item
        .get("condition")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match kind.as_str() {
        "DOMAIN" => domain == condition,
        "DOMAIN-SUFFIX" => domain == condition || domain.ends_with(&format!(".{condition}")),
        "DOMAIN-KEYWORD" => !condition.is_empty() && domain.contains(&condition),
        "MATCH" => true,
        _ => false,
    }
}

#[tauri::command]
fn routing_rule_page(
    state: State<AppState>,
    profile_id: String,
    offset: usize,
    limit: usize,
) -> Result<JsonValue, String> {
    let active_profile = {
        let core = state.core.lock().unwrap();
        if core.settings.active_profile_id != profile_id {
            return Err("订阅已切换，这一页旧规则已取消加载。".to_string());
        }
        core.active_profile()
    };
    let rules = routing_config_rules_for_profile(&state.app_data, active_profile.as_ref());
    let total = rules.len();
    let safe_limit = limit.clamp(20, 200);
    let safe_offset = offset.min(total);
    let items = rules
        .into_iter()
        .skip(safe_offset)
        .take(safe_limit)
        .collect::<Vec<_>>();
    Ok(json!({
        "profileId": profile_id,
        "offset": safe_offset,
        "limit": safe_limit,
        "total": total,
        "hasMore": safe_offset.saturating_add(items.len()) < total,
        "items": items
    }))
}

#[tauri::command]
fn test_routing_website(state: State<AppState>, input: String) -> Result<JsonValue, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("请输入要测试的网站。".to_string());
    }
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let parsed = reqwest::Url::parse(&candidate).map_err(|_| "网站格式不正确，例如 youtube.com。".to_string())?;
    let domain = parsed
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "网站中没有可识别的域名。".to_string())?;
    let profile = {
        let core = state.core.lock().unwrap();
        core.active_profile()
    };
    let Some(profile) = profile else {
        return Err("当前没有可用订阅。".to_string());
    };
    const PROTECTED_DOMAINS: &[&str] = &[
        "api.ipify.org",
        "api6.ipify.org",
        "checkip.amazonaws.com",
        "ifconfig.me",
        "icanhazip.com",
        "ident.me",
    ];
    if PROTECTED_DOMAINS.contains(&domain.as_str()) {
        return Ok(json!({
            "domain": domain,
            "matched": true,
            "source": "system",
            "target": AEGOS_OUTBOUND_IP_GROUP,
            "kind": "SYSTEM",
            "condition": "落地 IP 查询服务",
            "explanation": "这是不可覆盖的系统检测规则，只用于确认当前节点出口。"
        }));
    }
    let source = cached_profile_yaml(Path::new(&profile.path))?;
    let targets = routing_rule_target_catalog(source.as_ref());
    let store = read_aegos_user_rule_store(&state.app_data);
    for rule in store.active_for_profile(&profile.id) {
        if !routing_domain::target_exists(&targets, &rule.target) {
            continue;
        }
        let item = parse_routing_rule_text(0, &rule.raw());
        if routing_rule_matches_domain(&item, &domain) {
            return Ok(json!({
                "domain": domain,
                "matched": true,
                "source": "user",
                "scope": if matches!(rule.scope, UserRuleScope::Global) { "global" } else { "profile" },
                "ruleId": rule.id,
                "target": rule.target,
                "kind": rule.kind,
                "condition": rule.condition,
                "explanation": "命中 Aegos 用户规则；仅当前订阅规则优先于所有订阅规则。"
            }));
        }
    }
    let config_rules = routing_config_rules_for_profile(&state.app_data, Some(&profile));
    if let Some(item) = config_rules.iter().find(|item| routing_rule_matches_domain(item, &domain)) {
        return Ok(json!({
            "domain": domain,
            "matched": true,
            "source": "subscription",
            "target": item.get("target").cloned().unwrap_or_else(|| json!("-")),
            "kind": item.get("kind").cloned().unwrap_or_else(|| json!("-")),
            "condition": item.get("condition").cloned().unwrap_or_else(|| json!("-")),
            "explanation": "未命中更具体的用户规则，按订阅规则处理。"
        }));
    }
    Ok(json!({
        "domain": domain,
        "matched": false,
        "source": "none",
        "target": "-",
        "explanation": "没有找到可解释的网站规则，流量将继续交给核心的其他规则判断。"
    }))
}

#[tauri::command]
fn routing_snapshot(state: State<AppState>) -> Result<JsonValue, String> {
    // This snapshot feeds an interactive page. Keep an observation record so a
    // slow profile or controller can be diagnosed without guessing in the UI.
    let observed_at = Instant::now();
    let (running, controller, mode, groups, active_profile, profile_ids, last_apply) = {
        let core = state.core.lock().unwrap();
        (
            core.process.is_some(),
            core.core_controller(),
            core.settings.mode.clone(),
            core.proxy_groups(),
            core.active_profile(),
            core.settings.profiles.iter().map(|profile| profile.id.clone()).collect::<HashSet<_>>(),
            core.routing_apply_metadata(),
        )
    };
    let core_snapshot_ms = observed_at.elapsed().as_millis() as u64;
    let group_rows =
        core_runtime::routing_group_rows(&groups, &[AEGOS_OUTBOUND_IP_GROUP, "GLOBAL"]);
    let group_rows_ms = observed_at.elapsed().as_millis() as u64;
    let recent_rules = controller.routing_recent_rule_hits_snapshot_or_empty(running);
    let recent_rules_ms = observed_at.elapsed().as_millis() as u64;
    // Warm the shared profile parse before shaping rules. This makes the
    // remaining timing explicitly represent rule validation and JSON shaping,
    // rather than hiding a YAML parse inside that number.
    if let Some(profile) = active_profile.as_ref() {
        let _ = cached_profile_yaml(Path::new(&profile.path));
    }
    let active_rule_targets = active_profile
        .as_ref()
        .and_then(|profile| cached_profile_yaml(Path::new(&profile.path)).ok())
        .map(|source| routing_rule_target_catalog(source.as_ref()))
        .unwrap_or_default();
    let profile_yaml_ms = observed_at.elapsed().as_millis() as u64;
    let (mut static_rules, missing_rule_targets, rule_order_issues, rule_error) =
        routing_rules_for_profile(active_profile.as_ref());
    let profile_rules_ms = observed_at.elapsed().as_millis() as u64;
    if let Some(profile) = active_profile.as_ref() {
        let (legacy_active, legacy_disabled) = routing_user_rule_lists(&state.app_data, &profile.id);
        let legacy_rules = legacy_active
            .iter()
            .chain(legacy_disabled.iter())
            .map(|raw| raw.trim().to_string())
            .collect::<HashSet<_>>();
        // Legacy Aegos rules live in the subscription YAML. They are removed
        // from the product snapshot and represented by the canonical store.
        static_rules.retain(|item| {
            item.get("raw")
                .and_then(JsonValue::as_str)
                .map(|raw| !legacy_rules.contains(raw.trim()))
                .unwrap_or(true)
        });
        let store = read_aegos_user_rule_store(&state.app_data);
        for rule in store.rules.iter().filter(|rule| rule.scope.applies_to(&profile.id)) {
            let target_available = routing_domain::target_exists(&active_rule_targets, &rule.target);
            let status = if !rule.enabled {
                "paused"
            } else if target_available {
                "available"
            } else {
                "needs-rebind"
            };
            let mut item = parse_routing_rule_text(0, &rule.raw());
            if let Some(map) = item.as_object_mut() {
                map.insert("source".to_string(), json!("user"));
                map.insert("editable".to_string(), json!(true));
                map.insert("ruleId".to_string(), json!(rule.id));
                map.insert(
                    "scope".to_string(),
                    json!(if matches!(rule.scope, UserRuleScope::Global) { "global" } else { "profile" }),
                );
                map.insert("enabled".to_string(), json!(rule.enabled));
                map.insert("priority".to_string(), json!(rule.priority));
                map.insert("label".to_string(), json!(rule.label));
                map.insert("ruleSource".to_string(), json!(rule.source));
                map.insert(
                    "priorityClass".to_string(),
                    json!(match rule.kind.trim().to_ascii_uppercase().as_str() {
                        "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "PROCESS-NAME" | "PROCESS-PATH" | "IP-CIDR" => "explicit-user",
                        "GEOSITE" | "GEOIP" => "user-scene",
                        _ => "user-other",
                    }),
                );
                map.insert("status".to_string(), json!(status));
                map.insert("targetAvailable".to_string(), json!(target_available));
                map.insert(
                    "note".to_string(),
                    json!(if !rule.enabled {
                        "规则已暂停，不会进入运行配置。"
                    } else if target_available {
                        "规则目标可用，会优先于订阅规则进入运行配置。"
                    } else {
                        "当前订阅中找不到目标线路，规则已保留但不会进入运行配置。"
                    }),
                );
            }
            static_rules.push(item);
        }
    }
    // Older apply receipts are informational only. Ownership is now defined
    // by the Aegos rule store, not by a raw rule string in a profile backup.
    let _ = last_apply;
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
            "systemRuleKind": "outbound-ip",
            "editable": false,
            "explanation": "Aegos uses this hidden rule to query the current node outbound IP. It is generated at runtime, does not switch nodes, and cannot be edited.",
            "userImpact": "Only Aegos outbound IP checks use this rule; normal website and app routing is still decided by user rules first.",
            "lockedReason": "System protection rule: editing it could make outbound IP display inaccurate or leak through the wrong route."
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
    const INITIAL_CONFIG_RULE_LIMIT: usize = 80;
    let mut included_config_rules = 0_usize;
    static_rules.retain(|item| {
        let source = item.get("source").and_then(JsonValue::as_str).unwrap_or("config");
        if matches!(source, "user" | "system") {
            return true;
        }
        let include = included_config_rules < INITIAL_CONFIG_RULE_LIMIT;
        included_config_rules = included_config_rules.saturating_add(1);
        include
    });
    let stored_user_rules = read_aegos_user_rule_store(&state.app_data);
    let unbound_user_rules = stored_user_rules
        .rules
        .iter()
        .filter(|rule| rule.scope.profile_id().is_some_and(|id| !profile_ids.contains(id)))
        .map(|rule| json!({
            "id": rule.id,
            "label": rule.label,
            "kind": rule.kind,
            "condition": rule.condition,
            "target": rule.target,
            "scope": "profile",
            "profileId": rule.scope.profile_id(),
            "enabled": rule.enabled,
            "status": "needs-rebind",
            "reason": "原订阅已删除，规则会继续保留，但不会写入运行配置。",
            "nextActions": ["rebind", "global", "delete"]
        }))
        .collect::<Vec<_>>();
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
        "lastDeployment": read_routing_deployment_report(&state.app_data),
        "unboundUserRules": unbound_user_rules,
        "configRulePage": {
            "profileId": active_profile.as_ref().map(|profile| profile.id.as_str()).unwrap_or(""),
            "offset": 0,
            "limit": INITIAL_CONFIG_RULE_LIMIT,
            "total": config_rule_count,
            "hasMore": config_rule_count > INITIAL_CONFIG_RULE_LIMIT
        },
        "runtimeObservationMs": {
            "coreSnapshot": core_snapshot_ms,
            "groupRows": group_rows_ms.saturating_sub(core_snapshot_ms),
            "recentRules": recent_rules_ms.saturating_sub(group_rows_ms),
            "profileYaml": profile_yaml_ms.saturating_sub(recent_rules_ms),
            "profileRules": profile_rules_ms.saturating_sub(profile_yaml_ms),
            "total": observed_at.elapsed().as_millis() as u64
        },
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
            ,"unboundUserRuleCount": stored_user_rules.rules.iter().filter(|rule| rule.scope.profile_id().is_some_and(|id| !profile_ids.contains(id))).count()
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
fn profile_removal_impact(state: State<AppState>, id: String) -> Result<JsonValue, String> {
    let (profile_name, is_active, exists) = {
        let core = state.core.lock().unwrap();
        let profile = core.settings.profiles.iter().find(|profile| profile.id == id);
        (
            profile.map(|profile| profile.name.clone()).unwrap_or_default(),
            core.settings.active_profile_id == id,
            profile.is_some(),
        )
    };
    if !exists {
        return Err("订阅已不存在，请刷新后重试。".to_string());
    }
    let store = read_aegos_user_rule_store(&state.app_data);
    let scoped = store
        .rules
        .iter()
        .filter(|rule| rule.scope.profile_id() == Some(id.as_str()))
        .collect::<Vec<_>>();
    Ok(json!({
        "profileId": id,
        "profileName": profile_name,
        "isActive": is_active,
        "affectedRuleCount": scoped.len(),
        "enabledRuleCount": scoped.iter().filter(|rule| rule.enabled).count(),
        "rulesWillBeRetained": true,
        "nextState": if scoped.is_empty() { "none" } else { "needs-rebind" },
        "sampleRules": scoped.iter().take(5).map(|rule| json!({
            "id": rule.id,
            "label": rule.label,
            "condition": rule.condition,
            "target": rule.target,
            "enabled": rule.enabled
        })).collect::<Vec<_>>()
    }))
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
            let core_state = Arc::new(Mutex::new(core));
            app.manage(AppState {
                core: core_state.clone(),
                speed_test,
                speed_prepare_running: Arc::new(AtomicBool::new(false)),
                logs,
                app_data,
                jobs: Arc::new(Mutex::new(HashMap::new())),
                operations: Arc::new(Mutex::new(())),
            });
            thread::spawn(move || {
                // Integrity metadata is diagnostic information. Read the binary
                // outside the state lock, then publish the completed value.
                let path = core_state.lock().ok().map(|manager| manager.core_path.clone());
                let Some(path) = path else { return; };
                let checksum = if path.exists() { sha256_file(&path) } else { String::new() };
                if let Ok(mut manager) = core_state.lock() {
                    if manager.core_path == path {
                        manager.core_sha256 = checksum;
                    }
                }
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
            prepare_speed_runtime,
            start_proxy_delay_test,
            test_single_proxy_delay,
            node_diagnostics,
            speed_test_status,
            speed_test_progress,
            cancel_proxy_delay_test,
            recover_network,
            refresh_outbound_ip,
            ipv6_dns_safety_snapshot,
            environment_readiness,
            select_best_proxy,
            connections,
            routing_rule_page,
            test_routing_website,
            routing_snapshot,
            active_connection_count,
            close_connection,
            close_connections,
            add_profile_url,
            update_profile,
            set_active_profile,
            profile_removal_impact,
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
