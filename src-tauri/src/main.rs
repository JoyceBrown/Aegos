#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use rand::random;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use serde_yaml::{Mapping, Value as YamlValue};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Write},
    net::{IpAddr, TcpListener, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, Window, WindowEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const APP_NAME: &str = "Aegos";
const CREATE_NO_WINDOW: u32 = 0x08000000;
const AEGOS_DEFAULT_MIXED_PORT: u16 = 7891;
const AEGOS_DEFAULT_CONTROLLER_PORT: u16 = 19091;
const RESERVED_MIXED_PORTS: &[u16] = &[7890];
const AEGOS_OUTBOUND_IP_GROUP: &str = "Aegos Landing IP";
const SPEED_RESULT_HIGH_CONFIDENCE_SECS: u64 = 600;
const SPEED_RESULT_MEDIUM_CONFIDENCE_SECS: u64 = 1800;
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
const MIHOMO_PROXY_TYPES: &[&str] = &[
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

#[derive(Clone, Default, Debug)]
struct ProfileSourceSummary {
    format: String,
    proxies: usize,
    proxy_groups: usize,
    rules: usize,
    unsupported_lines: usize,
}

#[derive(Debug)]
struct ProfileSource {
    config: YamlValue,
    summary: ProfileSourceSummary,
}

fn subscription_diagnostic(stage: &str, reason: impl AsRef<str>, suggestion: &str) -> String {
    format!(
        "Subscription diagnostics [{stage}]: {}. Suggestion: {suggestion}. Open Logs or Diagnostics for details.",
        reason.as_ref()
    )
}

fn is_supported_uri_scheme(scheme: &str) -> bool {
    let scheme = scheme.to_ascii_lowercase();
    AEGOS_URI_PROTOCOLS.contains(&scheme.as_str())
}

fn normalize_proxy_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "hy2" => "hysteria2".to_string(),
        "socks" => "socks5".to_string(),
        other => other.to_string(),
    }
}

fn mihomo_supports_proxy_type(value: &str) -> bool {
    let normalized = normalize_proxy_type(value);
    MIHOMO_PROXY_TYPES.contains(&normalized.as_str())
}

fn protocol_capability_summary() -> String {
    format!(
        "Aegos URI parser: {}; bundled Mihomo proxy types: {}",
        AEGOS_URI_PROTOCOLS.join(", "),
        MIHOMO_PROXY_TYPES.join(", ")
    )
}

fn classify_failure_reason(reason: &str) -> &'static str {
    let text = reason.to_ascii_lowercase();
    if text.contains("timeout") || text.contains("timed out") || text.contains("i/o timeout") {
        "timeout"
    } else if text.contains("dns")
        || text.contains("lookup")
        || text.contains("no such host")
        || text.contains("failed to lookup")
    {
        "dns"
    } else if text.contains("tls")
        || text.contains("certificate")
        || text.contains("handshake")
        || text.contains("x509")
    {
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
    } else if text.contains("port")
        && (text.contains("in use") || text.contains("conflict") || text.contains("占用"))
    {
        "port-conflict"
    } else if text.contains("controller")
        || text.contains("/proxies")
        || text.contains("/configs")
        || text.contains("connection refused")
    {
        "controller-unavailable"
    } else if text.contains("yaml")
        || text.contains("config")
        || text.contains("preflight")
        || text.contains("配置")
    {
        "config"
    } else if text.contains("network") || text.contains("connect") || text.contains("proxy") {
        "network"
    } else {
        "unknown"
    }
}

fn classified_error(context: &str, reason: impl AsRef<str>) -> String {
    let reason = reason.as_ref();
    format!(
        "{context} failed [{}]: {reason}",
        classify_failure_reason(reason)
    )
}

fn is_ignorable_subscription_line(line: &str) -> bool {
    let line = line.trim().trim_start_matches('\u{feff}');
    if line.is_empty() || line.starts_with('#') || line.starts_with("//") || line.starts_with(';') {
        return true;
    }
    let lower = line.to_ascii_lowercase();
    lower.starts_with("subscription-userinfo:")
        || lower.starts_with("profile-title:")
        || lower.starts_with("profile-update-interval:")
        || lower.starts_with("profile-web-page-url:")
        || lower.starts_with("support-url:")
        || lower.starts_with("upload=")
        || lower.starts_with("download=")
        || lower.starts_with("total=")
        || lower.starts_with("expire=")
}

fn decoded_subscription_body(text: &str) -> String {
    let raw = text.trim_start_matches('\u{feff}').trim();
    if raw.contains("://") || looks_like_clash_yaml(raw) {
        raw.to_string()
    } else {
        b64_decode_text(raw).unwrap_or_else(|| raw.to_string())
    }
}

fn unsupported_uri_schemes(text: &str) -> Vec<String> {
    let body = decoded_subscription_body(text);
    let mut schemes = body
        .lines()
        .map(str::trim)
        .filter(|line| !is_ignorable_subscription_line(line))
        .filter_map(|line| line.split_once("://").map(|(scheme, _)| scheme.trim()))
        .filter(|scheme| !scheme.is_empty() && !is_supported_uri_scheme(scheme))
        .map(|scheme| scheme.to_ascii_lowercase())
        .collect::<Vec<_>>();
    schemes.sort();
    schemes.dedup();
    schemes
}

fn looks_like_clash_yaml(text: &str) -> bool {
    text.lines().take(48).any(|line| {
        let line = line.trim_start();
        line.starts_with("proxies:")
            || line.starts_with("proxy-groups:")
            || line.starts_with("rules:")
            || line.starts_with("mixed-port:")
            || line.starts_with("port:")
            || line.starts_with("socks-port:")
    })
}

struct RenderedProfile {
    yaml: String,
    digest: String,
    report: JsonValue,
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

#[derive(Clone, Serialize)]
struct LogEntry {
    at: String,
    level: String,
    category: String,
    line: String,
}

#[derive(Clone, Default)]
struct SpeedTestState {
    run_id: u64,
    running: bool,
    started_at: u64,
    updated_at: u64,
    total: usize,
    completed: usize,
    ok: usize,
    failed: usize,
    delays: HashMap<String, i64>,
    health: HashMap<String, NodeHealth>,
    low_latency: Vec<String>,
    recommended: Option<JsonValue>,
    error: Option<String>,
}

#[derive(Clone, Default, Serialize)]
struct NodeHealth {
    name: String,
    protocol: String,
    last_delay: i64,
    median_delay: i64,
    jitter: i64,
    success_count: u64,
    failure_count: u64,
    failure_streak: u64,
    last_success_at: u64,
    last_tested_at: u64,
    cooldown_until: u64,
    status: String,
    confidence: String,
    score: i64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct SystemProxySnapshot {
    proxy_enable: bool,
    proxy_server: String,
    proxy_override: String,
    captured_at: String,
}

#[derive(Clone)]
struct SpeedTestTarget {
    name: String,
    select_name: String,
    group_name: String,
    protocol: String,
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
    settings_path: PathBuf,
    proxy_snapshot_path: PathBuf,
    settings: Settings,
    process: Option<Child>,
    runtime_profile_id: Option<String>,
    runtime_config_digest: Option<String>,
    traffic_takeover: bool,
    logs: Arc<Mutex<Vec<LogEntry>>>,
    last_traffic: JsonValue,
    speed_test: Arc<Mutex<SpeedTestState>>,
    lan_ip_cache: String,
    lan_ip_checked_at: u64,
    outbound_ip_cache: String,
    outbound_ip_checked_at: u64,
    reliability_failures: u64,
}

struct AppState {
    core: Arc<Mutex<CoreManager>>,
    jobs: Arc<Mutex<HashMap<String, JobRecord>>>,
    operations: Arc<Mutex<()>>,
}

#[derive(Clone)]
struct DiagnosticsSnapshot {
    settings: Settings,
    active_profile: Option<Profile>,
    core_path: PathBuf,
    proxy_snapshot_path: PathBuf,
    running: bool,
    traffic_takeover: bool,
    last_traffic: JsonValue,
    speed_test: SpeedTestState,
    lan_ip_cache: String,
    outbound_ip_cache: String,
    reliability_failures: u64,
    recent_logs: Vec<LogEntry>,
    status_logs: Vec<LogEntry>,
}

#[derive(Clone, Serialize)]
struct JobRecord {
    id: String,
    kind: String,
    label: String,
    state: String,
    started_at: u64,
    updated_at: u64,
    progress: u64,
    total: u64,
    message: String,
    result: Option<JsonValue>,
    error: Option<String>,
    cancel_requested: bool,
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

fn port_from_value(value: &JsonValue, fallback: u16, label: &str) -> Result<u16, String> {
    let port = value.as_u64().unwrap_or(u64::from(fallback));
    if !(1024..=65535).contains(&port) {
        return Err(format!("{label} must be between 1024 and 65535"));
    }
    Ok(port as u16)
}

fn mixed_port_from_value(value: &JsonValue, fallback: u16) -> Result<u16, String> {
    let port = port_from_value(value, fallback, "Mixed proxy port")?;
    if RESERVED_MIXED_PORTS.contains(&port) {
        return Err("7890 已由 FlClash/Codex 使用，Aegos 请使用 7891 或其他端口。".to_string());
    }
    Ok(port)
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

fn test_proxy_delay_request(
    client: &Client,
    controller_port: u16,
    secret: &str,
    name: &str,
    test_url: &str,
    timeout_ms: u64,
) -> i64 {
    let url = format!(
        "http://127.0.0.1:{}/proxies/{}/delay?timeout={}&url={}",
        controller_port,
        url_path_encode(name),
        timeout_ms,
        url_path_encode(test_url)
    );
    client
        .get(url)
        .bearer_auth(secret)
        .send()
        .ok()
        .and_then(|res| res.error_for_status().ok())
        .and_then(|res| res.json::<JsonValue>().ok())
        .and_then(|data| data.get("delay").and_then(|value| value.as_i64()))
        .unwrap_or(-1)
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
        "tuic" | "hysteria" | "wireguard" => 2800,
        "anytls" => 2600,
        "reality" => 2400,
        "ss-obfs" => 2800,
        "vmess" | "trojan" | "ss" => 2200,
        _ => 2600,
    }
}

fn delay_probe_plan(protocol: &str, depth: DelayProbeDepth) -> Vec<DelayProbe> {
    if matches!(depth, DelayProbeDepth::Fast) {
        let timeout_ms = protocol_fast_timeout_ms(protocol);
        if matches!(
            protocol_family(protocol),
            "tuic" | "hysteria" | "wireguard" | "anytls" | "ss-obfs"
        ) {
            return vec![
                DelayProbe {
                    url: "http://www.gstatic.com/generate_204",
                    timeout_ms,
                },
                DelayProbe {
                    url: "http://cp.cloudflare.com/generate_204",
                    timeout_ms,
                },
            ];
        }
        return vec![DelayProbe {
            url: "http://www.gstatic.com/generate_204",
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
    redact_uri_userinfo(redacted)
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

fn speed_result_confidence(
    delay: i64,
    failure_streak: u64,
    last_success_at: u64,
    last_tested_at: u64,
    cooldown_until: u64,
    now: u64,
) -> String {
    if cooldown_until > now {
        return "cooldown".to_string();
    }
    if delay == 0 {
        return "testing".to_string();
    }
    if delay > 0 && failure_streak == 0 && last_success_at > 0 {
        let age = now.saturating_sub(last_success_at);
        if age <= SPEED_RESULT_HIGH_CONFIDENCE_SECS {
            "high".to_string()
        } else if age <= SPEED_RESULT_MEDIUM_CONFIDENCE_SECS {
            "medium".to_string()
        } else {
            "stale".to_string()
        }
    } else if failure_streak > 0 && last_success_at > 0 {
        "low".to_string()
    } else if failure_streak > 0 || last_tested_at > 0 {
        "failed".to_string()
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
    } else {
        health.failure_count = health.failure_count.saturating_add(1);
        health.failure_streak = health.failure_streak.saturating_add(1);
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
    let (slow, fast): (Vec<_>, Vec<_>) = ordered.into_iter().partition(|target| {
        let family = protocol_family(&target.protocol);
        let cooldown = health
            .get(&target.name)
            .map(|item| item.cooldown_until > now)
            .unwrap_or(false);
        cooldown || matches!(family, "tuic" | "hysteria" | "wireguard" | "ss-obfs")
    });
    let first_count = fast.len().min(16);
    let first = fast.iter().take(first_count).cloned().collect::<Vec<_>>();
    let rest = fast.into_iter().skip(first_count).collect::<Vec<_>>();
    let mut phases = Vec::new();
    if !first.is_empty() {
        phases.push((first, 16usize));
    }
    if !rest.is_empty() {
        phases.push((rest, 32usize));
    }
    if !slow.is_empty() {
        let chunk_size = slow
            .iter()
            .map(|target| protocol_concurrency(&target.protocol))
            .min()
            .unwrap_or(8);
        phases.push((slow, chunk_size));
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

fn speed_confidence_summary(speed: &SpeedTestState, now: u64) -> JsonValue {
    let mut high = 0usize;
    let mut medium = 0usize;
    let mut stale = 0usize;
    let mut low = 0usize;
    let mut failed = 0usize;
    let mut cooldown = 0usize;
    let mut testing = 0usize;
    let mut unknown = 0usize;
    let mut newest_success_at = 0u64;

    for item in speed.health.values() {
        let confidence = speed_result_confidence(
            item.last_delay,
            item.failure_streak,
            item.last_success_at,
            item.last_tested_at,
            item.cooldown_until,
            now,
        );
        match confidence.as_str() {
            "high" => high += 1,
            "medium" => medium += 1,
            "stale" => stale += 1,
            "low" => low += 1,
            "failed" => failed += 1,
            "cooldown" => cooldown += 1,
            "testing" => testing += 1,
            _ => unknown += 1,
        }
        newest_success_at = newest_success_at.max(item.last_success_at);
    }

    let fresh = high + medium;
    json!({
        "fresh": fresh,
        "high": high,
        "medium": medium,
        "stale": stale,
        "low": low,
        "failed": failed,
        "cooldown": cooldown,
        "testing": testing,
        "unknown": unknown,
        "newestSuccessAgeSecs": if newest_success_at > 0 { json!(now.saturating_sub(newest_success_at)) } else { JsonValue::Null },
        "recommendedFresh": speed.recommended.as_ref().and_then(|value| value.get("confidence")).and_then(|value| value.as_str()).map(|value| value == "high" || value == "medium").unwrap_or(false)
    })
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

fn test_proxy_delay_with_retry(
    client: &Client,
    controller_port: u16,
    secret: &str,
    name: &str,
    protocol: &str,
) -> i64 {
    let fast_delay = delay_probe_plan(protocol, DelayProbeDepth::Fast)
        .iter()
        .map(|probe| {
            test_proxy_delay_request(
                client,
                controller_port,
                secret,
                name,
                probe.url,
                probe.timeout_ms,
            )
        })
        .find(|delay| *delay >= 0)
        .unwrap_or(-1);
    if fast_delay >= 0 {
        return fast_delay;
    }
    delay_probe_plan(protocol, DelayProbeDepth::Full)
        .iter()
        .map(|probe| {
            test_proxy_delay_request(
                client,
                controller_port,
                secret,
                name,
                probe.url,
                probe.timeout_ms,
            )
        })
        .find(|delay| *delay >= 0)
        .unwrap_or(-1)
}

fn test_proxy_delay_fast(
    client: &Client,
    controller_port: u16,
    secret: &str,
    name: &str,
    protocol: &str,
) -> i64 {
    delay_probe_plan(protocol, DelayProbeDepth::Fast)
        .iter()
        .map(|probe| {
            test_proxy_delay_request(
                client,
                controller_port,
                secret,
                name,
                probe.url,
                probe.timeout_ms,
            )
        })
        .find(|delay| *delay >= 0)
        .unwrap_or(-1)
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
    let proxies = yaml_sequence(config, "proxies")
        .map(|items| items.len())
        .unwrap_or(0);
    let proxy_groups = yaml_sequence(config, "proxy-groups")
        .map(|items| items.len())
        .unwrap_or(0);
    let rules = yaml_sequence(config, "rules")
        .map(|items| items.len())
        .unwrap_or(0);
    if proxies == 0 {
        return Err("订阅解析成功，但没有可用 proxies 节点".to_string());
    }
    Ok(ProfileSourceSummary {
        format: format.to_string(),
        proxies,
        proxy_groups,
        rules,
        unsupported_lines,
    })
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

    let proxy_names: Vec<YamlValue> = config
        .get(yaml_key("proxies"))
        .and_then(|v| v.as_sequence())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get(yaml_key("name")).and_then(|v| v.as_str()))
                .map(|name| YamlValue::String(name.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let has_proxy_group = matches!(config.get(yaml_key("proxy-groups")), Some(YamlValue::Sequence(items)) if !items.is_empty());
    if !proxy_names.is_empty() && !has_proxy_group {
        let mut group = Mapping::new();
        set_yaml(&mut group, "name", yaml_str("GLOBAL"));
        set_yaml(&mut group, "type", yaml_str("select"));
        set_yaml(
            &mut group,
            "proxies",
            YamlValue::Sequence(proxy_names.clone()),
        );
        set_yaml(
            &mut config,
            "proxy-groups",
            YamlValue::Sequence(vec![YamlValue::Mapping(group)]),
        );
    }

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
        return Err("手动节点必须是对象".to_string());
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
    let node_type = normalize_proxy_type(
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
        return Err("请输入固定节点端口".to_string());
    };
    if name.is_empty() {
        return Err("请输入固定节点名称".to_string());
    }
    if server.is_empty() {
        return Err("请输入固定节点地址".to_string());
    }
    if port == 0 || port > 65535 {
        return Err("固定节点端口必须在 1-65535 之间".to_string());
    }
    if !mihomo_supports_proxy_type(&node_type) {
        return Err(format!(
            "Unsupported manual node protocol: {node_type}; {}",
            protocol_capability_summary()
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
        return Err(format!("暂不支持的固定节点协议：{node_type}"));
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
        return Err("手动节点数据无效".to_string());
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
        .ok_or_else(|| "手动节点缺少名称".to_string())?;
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
            return Err(format!("固定节点名称已存在：{name}"));
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

fn proxy_ports_from_config(config: &YamlValue) -> Vec<u16> {
    let mut ports = HashSet::new();
    for proxy in yaml_sequence(config, "proxies")
        .into_iter()
        .flat_map(|items| items.iter())
    {
        let Some(map) = proxy.as_mapping() else {
            continue;
        };
        let Some(port) = map
            .get(yaml_key("port"))
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok())
        else {
            continue;
        };
        if port > 0 {
            ports.insert(port);
        }
    }
    let mut ports = ports.into_iter().collect::<Vec<_>>();
    ports.sort_unstable();
    ports
}

fn preflight_runtime_config(
    config: &YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<JsonValue, String> {
    let root = config
        .as_mapping()
        .ok_or_else(|| "配置预检失败：根节点必须是 YAML 对象".to_string())?;
    let proxies = yaml_sequence(config, "proxies")
        .cloned()
        .unwrap_or_default();
    let proxy_groups = yaml_sequence(config, "proxy-groups")
        .cloned()
        .unwrap_or_default();
    let rules = yaml_sequence(config, "rules").cloned().unwrap_or_default();
    let builtin_direct = profile.id == "direct" || profile.profile_type == "builtin";
    let mut names = HashSet::new();
    let mut duplicate_names = Vec::new();
    let mut missing_fields = Vec::new();
    let mut unsupported_proxy_types = Vec::new();

    for (index, proxy) in proxies.iter().enumerate() {
        let Some(map) = proxy.as_mapping() else {
            missing_fields.push(format!("proxies[{}] 不是对象", index));
            continue;
        };
        let name = map
            .get(yaml_key("name"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        if name.is_empty() {
            missing_fields.push(format!("proxies[{}] 缺少 name", index));
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
                "{} 缺少 type",
                if name.is_empty() { "proxy" } else { name }
            ));
        }
        let proxy_type = map
            .get(yaml_key("type"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        if !proxy_type.is_empty() && !mihomo_supports_proxy_type(proxy_type) {
            unsupported_proxy_types.push(format!(
                "{} ({})",
                if name.is_empty() { "proxy" } else { name },
                proxy_type
            ));
        }
    }

    if !builtin_direct && proxies.is_empty() {
        return Err("配置预检失败：订阅没有可用 proxies 节点".to_string());
    }
    if !duplicate_names.is_empty() {
        duplicate_names.sort();
        duplicate_names.dedup();
        return Err(format!(
            "配置预检失败：存在重复节点名 {}",
            duplicate_names.join(", ")
        ));
    }
    if !missing_fields.is_empty() {
        return Err(format!("配置预检失败：{}", missing_fields.join("；")));
    }
    if !unsupported_proxy_types.is_empty() {
        unsupported_proxy_types.sort();
        unsupported_proxy_types.dedup();
        return Err(format!(
            "Config preflight failed: unsupported proxy type(s): {}. {}",
            unsupported_proxy_types.join(", "),
            protocol_capability_summary()
        ));
    }
    if !proxies.is_empty() && proxy_groups.is_empty() {
        return Err("配置预检失败：存在节点但没有 proxy-groups".to_string());
    }
    if rules.is_empty() {
        return Err("配置预检失败：rules 为空".to_string());
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
            "配置预检失败：代理组引用了不存在的节点 {}",
            bad_refs.join(", ")
        ));
    }

    let mixed_port = root
        .get(yaml_key("mixed-port"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if mixed_port != u64::from(settings.mixed_port) {
        return Err(format!(
            "配置预检失败：mixed-port 应为 {}，实际为 {}",
            settings.mixed_port, mixed_port
        ));
    }
    let controller = root
        .get(yaml_key("external-controller"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if !controller.ends_with(&format!(":{}", settings.controller_port)) {
        return Err(format!(
            "配置预检失败：external-controller 应使用端口 {}",
            settings.controller_port
        ));
    }

    Ok(json!({
        "ok": true,
        "profile": profile.name,
        "proxies": proxies.len(),
        "proxyGroups": proxy_groups.len(),
        "rules": rules.len(),
        "mixedPort": settings.mixed_port,
        "controllerPort": settings.controller_port,
        "protocolCapabilities": {
            "uriParser": AEGOS_URI_PROTOCOLS,
            "mihomoProxyTypes": MIHOMO_PROXY_TYPES,
            "core": "Mihomo Meta v1.19.27 bundled"
        }
    }))
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
        Err("无法获取落地 IP".to_string())
    } else {
        Err(format!("无法获取落地 IP: {last_error}"))
    }
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
        assert!(err.contains("bundled Mihomo proxy types"));
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
        assert!(mihomo_supports_proxy_type("anytls"));
        assert!(protocol_capability_summary().contains("Aegos URI parser"));
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

        assert_eq!(resolve_group_leaf(&groups, &selected, "Final", 0), "Node A");
        assert_eq!(resolve_group_leaf(&groups, &selected, "Auto", 0), "Node A");
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
    fn failure_reason_classifier_covers_common_connection_failures() {
        assert_eq!(classify_failure_reason("dial tcp: i/o timeout"), "timeout");
        assert_eq!(classify_failure_reason("dns lookup failed"), "dns");
        assert_eq!(classify_failure_reason("tls handshake failed"), "tls");
        assert_eq!(classify_failure_reason("HTTP 401 unauthorized"), "auth");
        assert_eq!(
            classify_failure_reason("Config preflight failed: unsupported proxy type"),
            "unsupported-protocol"
        );
        assert_eq!(
            classify_failure_reason("controller connection refused"),
            "controller-unavailable"
        );
        assert!(classified_error("Node switch", "connection refused")
            .contains("Node switch failed [controller-unavailable]"));
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
        let first = update_node_health(None, "HK 02", "trojan", 48, 100);
        assert_eq!(first.status, "low");
        assert_eq!(first.confidence, "high");
        assert_eq!(first.failure_streak, 0);
        assert!(first.score < 100);

        let failed_once = update_node_health(Some(&first), "HK 02", "trojan", -1, 110);
        assert_eq!(failed_once.failure_streak, 1);
        assert_eq!(failed_once.status, "unstable");
        assert_eq!(failed_once.confidence, "low");

        let failed_twice = update_node_health(Some(&failed_once), "HK 02", "trojan", -1, 120);
        assert_eq!(failed_twice.failure_streak, 2);
        assert!(failed_twice.cooldown_until > 120);
        assert_eq!(failed_twice.status, "cooldown");
        assert_eq!(failed_twice.confidence, "cooldown");
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
        let line = "update failed https://train.example/api/linkon?token=fixture-token-redacted&protocol=vless password: secret uuid=00000000-0000-4000-8000-000000000000 bearer abc.def trojan://pass@example.com:443";
        let sanitized = sanitize_sensitive_text(line);

        assert!(sanitized.contains("token=[redacted]"));
        assert!(sanitized.contains("password: [redacted]"));
        assert!(sanitized.contains("uuid=[redacted]"));
        assert!(sanitized.contains("bearer [redacted]"));
        assert!(sanitized.contains("trojan://[redacted]@example.com:443"));
        assert!(!sanitized.contains("fixture-token-redacted"));
        assert!(!sanitized.contains("00000000-0000-4000-8000-000000000000"));
        assert!(!sanitized.contains("abc.def"));
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
            },
            SpeedTestTarget {
                name: "Trojan".to_string(),
                select_name: "Trojan".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "trojan".to_string(),
            },
        ];
        let phases = speed_test_phases(targets, &HashMap::new(), 1);
        assert_eq!(phases.first().unwrap().0[0].name, "Trojan");
        assert!(phases
            .last()
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
        assert_eq!(fast_tuic_probes.len(), 2);
        assert_eq!(
            fast_tuic_probes[0].url,
            "http://www.gstatic.com/generate_204"
        );
        assert_eq!(
            fast_tuic_probes[1].url,
            "http://cp.cloudflare.com/generate_204"
        );
        assert_eq!(fast_tuic_probes[0].timeout_ms, 2800);
        let fast_anytls_probes = delay_probe_plan("anytls", DelayProbeDepth::Fast);
        assert_eq!(fast_anytls_probes.len(), 2);
        assert_eq!(
            fast_anytls_probes[0].url,
            "http://www.gstatic.com/generate_204"
        );
        let tuic_probes = delay_probe_plan("tuic", DelayProbeDepth::Full);
        assert_eq!(tuic_probes[0].url, "http://www.gstatic.com/generate_204");
        assert!(tuic_probes
            .iter()
            .any(|probe| probe.url == "https://cp.cloudflare.com/generate_204"));
        assert!(tuic_probes.iter().all(|probe| probe.timeout_ms == 5000));
        let trojan_fast_probes = delay_probe_plan("trojan", DelayProbeDepth::Fast);
        assert_eq!(trojan_fast_probes[0].timeout_ms, 2200);
        let ss_obfs_fast_probes = delay_probe_plan("ss-obfs", DelayProbeDepth::Fast);
        assert_eq!(
            ss_obfs_fast_probes[0].url,
            "http://www.gstatic.com/generate_204"
        );
        assert_eq!(ss_obfs_fast_probes[0].timeout_ms, 2800);

        let targets = vec![
            SpeedTestTarget {
                name: "Hysteria2".to_string(),
                select_name: "Hysteria2".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "hysteria2".to_string(),
            },
            SpeedTestTarget {
                name: "Reality".to_string(),
                select_name: "Reality".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "vless-reality".to_string(),
            },
            SpeedTestTarget {
                name: "TUIC".to_string(),
                select_name: "TUIC".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "tuic".to_string(),
            },
            SpeedTestTarget {
                name: "SS Obfs".to_string(),
                select_name: "SS Obfs".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "ss-obfs".to_string(),
            },
        ];
        let phases = speed_test_phases(targets, &HashMap::new(), 1);
        assert_eq!(phases.first().unwrap().0[0].name, "Reality");
        let slow_names = phases
            .last()
            .unwrap()
            .0
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        assert!(slow_names.contains(&"Hysteria2"));
        assert!(slow_names.contains(&"TUIC"));
        assert!(slow_names.contains(&"SS Obfs"));
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
            },
            SpeedTestTarget {
                name: "Slow".to_string(),
                select_name: "Slow".to_string(),
                group_name: "GLOBAL".to_string(),
                protocol: "ss".to_string(),
            },
        ];
        let mut health = HashMap::new();
        health.insert(
            "Fast".to_string(),
            update_node_health(None, "Fast", "trojan", 48, 100),
        );
        health.insert(
            "Slow".to_string(),
            update_node_health(None, "Slow", "ss", 120, 100),
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
    Err(format!("未找到可用端口: {fallback}-{}", fallback + 79))
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
    let normalized = normalize_proxy_type(protocol);
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
    let server = map
        .get(yaml_key("server"))
        .and_then(|value| value.as_str())
        .unwrap_or(name);
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

fn group_selected_name(group: &JsonValue, selected_map: &HashMap<String, String>) -> String {
    let group_name = group
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    selected_map
        .get(group_name)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .or_else(|| {
            group
                .get("now")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string())
        })
        .unwrap_or_default()
}

fn resolve_group_leaf(
    groups: &[JsonValue],
    selected_map: &HashMap<String, String>,
    name: &str,
    depth: usize,
) -> String {
    if depth > 8 {
        return name.to_string();
    }
    let Some(group) = groups
        .iter()
        .find(|group| group.get("name").and_then(|value| value.as_str()) == Some(name))
    else {
        return name.to_string();
    };
    let selected = group_selected_name(group, selected_map);
    if selected.is_empty() || selected == name {
        return name.to_string();
    }
    resolve_group_leaf(groups, selected_map, &selected, depth + 1)
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

fn is_recovery_candidate_name(name: &str) -> bool {
    let text = name.trim();
    if text.is_empty() {
        return false;
    }
    let upper = text.to_ascii_uppercase();
    if matches!(
        upper.as_str(),
        "DIRECT" | "REJECT" | "REJECT-DROP" | "COMPATIBLE"
    ) {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    ![
        "traffic", "expire", "剩余", "到期", "套餐", "官网", "流量", "过期",
    ]
    .iter()
    .any(|needle| lower.contains(&needle.to_ascii_lowercase()))
}

fn ps_escape(value: impl AsRef<str>) -> String {
    value.as_ref().replace('\'', "''")
}

fn firewall_program_path(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let normalized = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut text = normalized.to_string_lossy().replace('/', "\\");
    if text.starts_with("\\\\?\\UNC\\") {
        text = format!("\\\\{}", &text[8..]);
    } else if text.starts_with("\\\\?\\") {
        text = text[4..].to_string();
    }
    Some(text)
}

fn ps_array_literal(items: &[String]) -> String {
    let quoted = items
        .iter()
        .map(|item| format!("'{}'", ps_escape(item)))
        .collect::<Vec<_>>()
        .join(", ");
    format!("@({quoted})")
}

fn ps_port_list(ports: &[u16]) -> String {
    ports
        .iter()
        .map(|port| port.to_string())
        .collect::<Vec<_>>()
        .join(",")
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
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|err| err.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn is_process_elevated() -> bool {
    run_powershell(
        r#"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'true' } else { 'false' }
"#,
    )
    .map(|output| output.trim().eq_ignore_ascii_case("true"))
    .unwrap_or(false)
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

fn read_windows_proxy_snapshot() -> Result<SystemProxySnapshot, String> {
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

fn write_windows_proxy_snapshot(snapshot: &SystemProxySnapshot) -> Result<(), String> {
    let enable = if snapshot.proxy_enable { 1 } else { 0 };
    let server = ps_escape(&snapshot.proxy_server);
    let override_value = ps_escape(&snapshot.proxy_override);
    run_powershell(&format!(
        r#"
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value {enable}
Set-ItemProperty -Path $path -Name ProxyServer -Type String -Value '{server}'
Set-ItemProperty -Path $path -Name ProxyOverride -Type String -Value '{override_value}'
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

fn proxy_points_to_aegos(snapshot: &SystemProxySnapshot, mixed_port: u16) -> bool {
    snapshot.proxy_enable
        && snapshot.proxy_server.split(';').any(|item| {
            item.trim()
                .eq_ignore_ascii_case(&format!("127.0.0.1:{mixed_port}"))
        })
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
    let programs = [exe, core_path.to_path_buf()]
        .into_iter()
        .filter_map(|path| firewall_program_path(&path))
        .collect::<Vec<_>>();
    let program_array = ps_array_literal(&programs);
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
            ps_escape(snapshot.to_string_lossy()),
            ps_escape(&group),
            program_array
        )
    } else {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
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
            ps_escape(snapshot.to_string_lossy()),
            ps_escape(&group)
        )
    }
}

fn build_speed_test_firewall_script(
    enable: bool,
    user_data: &Path,
    core_path: &Path,
    ports: &[u16],
) -> String {
    let group = format!("{APP_NAME} Kill Switch Speed Test");
    let exe = std::env::current_exe().unwrap_or_default();
    let programs = [exe, core_path.to_path_buf()]
        .into_iter()
        .filter_map(|path| firewall_program_path(&path))
        .collect::<Vec<_>>();
    let program_array = ps_array_literal(&programs);
    let port_list = ps_port_list(ports);
    let marker = user_data.join("kill-switch-speed-test-rules.marker");
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
Get-NetFirewallRule -DisplayName "$rulePrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$index = 1
foreach ($program in $programs) {{
  if (Test-Path -LiteralPath $program) {{
    Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix Program $index" dir=out action=allow "program=$program" enable=yes profile=any | Out-Null
    $index += 1
  }}
}}
Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS UDP" dir=out action=allow protocol=UDP remoteport=53 enable=yes profile=any | Out-Null
Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix DNS TCP" dir=out action=allow protocol=TCP remoteport=53 enable=yes profile=any | Out-Null
if ($portList) {{
  Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix Node TCP" dir=out action=allow protocol=TCP remoteport=$portList enable=yes profile=any | Out-Null
  Invoke-AegosNetsh advfirewall firewall add rule "name=$rulePrefix Node UDP" dir=out action=allow protocol=UDP remoteport=$portList enable=yes profile=any | Out-Null
}}
Set-Content -LiteralPath $markerPath -Value (Get-Date).ToString('o') -Encoding UTF8
"#,
            ps_escape(marker.to_string_lossy()),
            ps_escape(&group),
            program_array,
            ps_escape(port_list)
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
"#,
            ps_escape(&group),
            ps_escape(marker.to_string_lossy())
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
        let proxy_snapshot_path = app_data.join("system-proxy-snapshot.json");
        ensure_dir(&home_dir)?;
        ensure_dir(&profile_dir)?;
        let settings = load_settings(&settings_path);
        let mut manager = Self {
            app_data,
            home_dir,
            profile_dir,
            core_path,
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
            reliability_failures: 0,
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

    fn save_system_proxy_snapshot(&self, snapshot: &SystemProxySnapshot) -> Result<(), String> {
        save_json(&self.proxy_snapshot_path, &self.app_data, snapshot)
    }

    fn load_system_proxy_snapshot(&self) -> Option<SystemProxySnapshot> {
        fs::read_to_string(&self.proxy_snapshot_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
    }

    fn clear_system_proxy_snapshot(&self) {
        let _ = remove_file_confined(&self.proxy_snapshot_path, &self.app_data);
    }

    fn capture_proxy_snapshot_before_takeover(&self) -> Result<(), String> {
        if self.proxy_snapshot_path.exists() {
            return Ok(());
        }
        let snapshot = read_windows_proxy_snapshot()?;
        if !proxy_points_to_aegos(&snapshot, self.settings.mixed_port) {
            self.save_system_proxy_snapshot(&snapshot)?;
        }
        Ok(())
    }

    fn verify_system_proxy_points_to_aegos(&self, expected: bool) -> Result<(), String> {
        let current = read_windows_proxy_snapshot()?;
        let points_to_aegos = proxy_points_to_aegos(&current, self.settings.mixed_port);
        if expected && !points_to_aegos {
            return Err(format!(
                "Windows system proxy verification failed: current '{}', expected 127.0.0.1:{}",
                current.proxy_server, self.settings.mixed_port
            ));
        }
        if !expected && points_to_aegos {
            return Err(format!(
                "Windows system proxy restore verification failed: still points to '{}'",
                current.proxy_server
            ));
        }
        Ok(())
    }

    fn ensure_direct_profile(&mut self) -> Result<(), String> {
        let path = self.profile_dir.join("direct.yaml");
        let config = patch_config_with_settings(
            YamlValue::Mapping(Mapping::new()),
            &self.settings,
            Some("direct"),
        )?;
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
                    name: "直连诊断配置".to_string(),
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
        if RESERVED_MIXED_PORTS.contains(&settings.mixed_port) {
            return Err(
                "Mixed proxy port 7890 is reserved for FlClash/Codex; use 7891 or another free port"
                    .to_string(),
            );
        }
        if settings.mixed_port == settings.controller_port {
            return Err(format!(
                "Mixed proxy port {} cannot equal controller port {}",
                settings.mixed_port, settings.controller_port
            ));
        }
        Ok(())
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
                settings.mixed_port = mixed_port_from_value(value, settings.mixed_port)?;
            }
            "controllerPort" => {
                settings.controller_port =
                    port_from_value(value, settings.controller_port, "Controller port")?;
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
            thread::sleep(Duration::from_millis(250));
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

    fn standby_settings(&self) -> Settings {
        let mut settings = self.settings.clone();
        settings.tun_enabled = false;
        settings
    }

    fn preflight_profile_file(&self, profile: &Profile) -> Result<JsonValue, String> {
        self.render_runtime_profile(profile)
            .map(|rendered| rendered.report)
    }

    fn render_runtime_profile(&self, profile: &Profile) -> Result<RenderedProfile, String> {
        self.render_runtime_profile_with_settings(profile, &self.settings)
    }

    fn render_runtime_profile_with_settings(
        &self,
        profile: &Profile,
        settings: &Settings,
    ) -> Result<RenderedProfile, String> {
        let path = PathBuf::from(&profile.path);
        let raw = fs::read_to_string(&path)
            .map_err(|err| format!("profile config read failed {}: {err}", path.display()))?;
        let source: YamlValue = serde_yaml::from_str(&raw)
            .map_err(|err| format!("profile YAML parse failed {}: {err}", path.display()))?;
        let patched = patch_config_with_settings(source, settings, Some(&profile.id))?;
        let report = preflight_runtime_config(&patched, profile, settings)?;
        let yaml = serde_yaml::to_string(&patched).map_err(|err| err.to_string())?;
        let digest = sha256_text(&yaml);
        Ok(RenderedProfile {
            yaml,
            digest,
            report,
        })
    }

    fn patch_profile_file(&mut self, profile: &Profile) -> Result<String, String> {
        let path = PathBuf::from(&profile.path);
        let rendered = self.render_runtime_profile(profile)?;
        let current_digest = sha256_file(&path);
        if current_digest != rendered.digest {
            atomic_write_text_confined(&path, &self.profile_dir, &rendered.yaml)?;
        }
        ensure_dir(&self.home_dir)?;
        let runtime_path = self.runtime_profile_path();
        atomic_write_text_confined(&runtime_path, &self.home_dir, &rendered.yaml)?;
        self.add_log(
            format!(
                "Config preflight passed: {} proxies, {} groups, digest {}{}",
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
                &rendered.digest[..12.min(rendered.digest.len())],
                if current_digest == rendered.digest {
                    " (unchanged)"
                } else {
                    ""
                }
            ),
            "info",
        );
        Ok(rendered.digest)
    }

    fn speed_test_firewall_ports(&self) -> Vec<u16> {
        let mut ports = [80u16, 443u16].into_iter().collect::<HashSet<_>>();
        if let Some(profile) = self.active_profile() {
            let path = PathBuf::from(&profile.path);
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(source) = serde_yaml::from_str::<YamlValue>(&raw) {
                    if let Ok(patched) = patch_config_with_settings(
                        source,
                        &self.standby_settings(),
                        Some(&profile.id),
                    ) {
                        ports.extend(proxy_ports_from_config(&patched));
                    }
                }
            }
        }
        let mut ports = ports.into_iter().collect::<Vec<_>>();
        ports.sort_unstable();
        ports
    }

    fn set_speed_test_firewall_rules(&self, enable: bool, ports: &[u16]) -> Result<(), String> {
        if !self.settings.kill_switch_enabled {
            return Ok(());
        }
        run_powershell(&build_speed_test_firewall_script(
            enable,
            &self.app_data,
            &self.core_path,
            ports,
        ))?;
        self.add_log(
            if enable {
                format!(
                    "Speed test firewall window opened for ports: {}",
                    ps_port_list(ports)
                )
            } else {
                "Speed test firewall window closed".to_string()
            },
            "info",
        );
        Ok(())
    }

    fn runtime_profile_path(&self) -> PathBuf {
        self.home_dir.join("aegos-runtime-profile.yaml")
    }

    fn hot_reload_profile(&mut self, profile: &Profile) -> Result<JsonValue, String> {
        let config_digest = self.patch_profile_file(profile)?;
        let same_runtime = self.runtime_profile_id.as_deref() == Some(profile.id.as_str())
            && self.runtime_config_digest.as_deref() == Some(config_digest.as_str());
        if same_runtime && self.controller("GET", "/version", None, 900).is_ok() {
            self.add_log(
                format!(
                    "Profile apply skipped; unchanged runtime config digest: {}",
                    &config_digest[..12.min(config_digest.len())]
                ),
                "info",
            );
            return Ok(json!({
                "ok": true,
                "skipped": true,
                "reason": "unchanged runtime config digest",
                "digest": config_digest
            }));
        }
        let runtime_path = self.runtime_profile_path();
        let result = self.controller(
            "PUT",
            "/configs?force=true",
            Some(json!({ "path": runtime_path.to_string_lossy().to_string() })),
            8000,
        )?;
        self.wait_for_controller()?;
        self.runtime_profile_id = Some(profile.id.clone());
        self.runtime_config_digest = Some(config_digest.clone());
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
                "Profile hot reloaded via mihomo controller: {} digest {}",
                profile.name,
                &config_digest[..12.min(config_digest.len())]
            ),
            "info",
        );
        Ok(result)
    }

    fn ensure_runtime_ports(&mut self) -> Result<(), String> {
        self.settings.mixed_port = find_free_port(
            self.settings.mixed_port,
            AEGOS_DEFAULT_MIXED_PORT,
            RESERVED_MIXED_PORTS,
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
        match child.try_wait() {
            Ok(Some(status)) => {
                self.process = None;
                self.runtime_profile_id = None;
                self.runtime_config_digest = None;
                self.traffic_takeover = false;
                Some(format!("mihomo exited before ready: {status}"))
            }
            Ok(None) => None,
            Err(err) => {
                self.process = None;
                self.runtime_profile_id = None;
                self.runtime_config_digest = None;
                self.traffic_takeover = false;
                Some(format!("mihomo status check failed: {err}"))
            }
        }
    }

    fn recent_logs(&self, limit: usize) -> Vec<LogEntry> {
        let logs = self.logs.lock().unwrap();
        let mut items = logs.iter().rev().take(limit).cloned().collect::<Vec<_>>();
        items.reverse();
        items
    }

    fn recent_node_logs(&self, node: &str, limit: usize) -> Vec<LogEntry> {
        let logs = self.logs.lock().unwrap();
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

    fn export_logs(&self) -> Result<JsonValue, String> {
        let items = self.logs.lock().unwrap().clone();
        let export_dir = self.app_data.join("diagnostics");
        ensure_dir(&export_dir)?;
        let path = export_dir.join(format!("aegos-logs-{}.txt", now_secs()));
        let content = if items.is_empty() {
            "No Aegos logs captured yet.\n".to_string()
        } else {
            items
                .iter()
                .map(|entry| {
                    let line = entry.line.replace('\r', " ").replace('\n', " ");
                    format!("{} [{}:{}] {}", entry.at, entry.level, entry.category, line)
                })
                .collect::<Vec<_>>()
                .join("\n")
                + "\n"
        };
        atomic_write_text_confined(&path, &export_dir, &content)?;
        Ok(json!({
            "path": path.to_string_lossy(),
            "count": items.len()
        }))
    }

    fn recent_log_summary(&self, limit: usize) -> String {
        let items = self.recent_logs(limit);
        if items.is_empty() {
            return "无最近日志".to_string();
        }
        items
            .into_iter()
            .map(|entry| format!("[{}] {}", entry.level, entry.line))
            .collect::<Vec<_>>()
            .join(" | ")
    }

    fn start_failure_message(&self, profile: Option<&Profile>, reason: &str) -> String {
        let profile_name = profile
            .map(|item| item.name.as_str())
            .unwrap_or("未选择订阅");
        let profile_path = profile.map(|item| item.path.as_str()).unwrap_or("-");
        format!(
            "核心启动失败：{reason}；订阅：{profile_name}；配置：{profile_path}；核心：{}；端口：mixed {} / controller {}；最近日志：{}",
            self.core_path.display(),
            self.settings.mixed_port,
            self.settings.controller_port,
            self.recent_log_summary(8)
        )
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
        ensure_dir(&self.home_dir)?;
        let runtime_path = self.runtime_profile_path();
        atomic_write_text_confined(&runtime_path, &self.home_dir, &rendered.yaml)?;
        self.add_log(
            format!(
                "Standby config preflight passed: {} proxies, {} groups, digest {}",
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
                &rendered.digest[..12.min(rendered.digest.len())]
            ),
            "info",
        );
        Ok(rendered.digest)
    }

    fn apply_takeover_after_core_ready(&mut self, enable_takeover: bool) {
        if enable_takeover {
            let should_apply_system_proxy = self.settings.system_proxy
                || self.settings.start_with_system_proxy
                || !self.settings.tun_enabled;
            let mut system_proxy_applied = false;
            if should_apply_system_proxy {
                self.traffic_takeover = true;
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
            self.traffic_takeover = self.settings.tun_enabled || system_proxy_applied;
        } else {
            self.traffic_takeover = false;
        }
    }

    fn start(&mut self) -> Result<JsonValue, String> {
        self.start_with_takeover(true)
    }

    fn start_standby(&mut self) -> Result<JsonValue, String> {
        self.start_with_takeover(false)
    }

    fn start_with_takeover(&mut self, enable_takeover: bool) -> Result<JsonValue, String> {
        if !self.core_path.exists() {
            return Err(format!(
                "mihomo core not found: {}",
                self.core_path.display()
            ));
        }
        self.ensure_runtime_ports()
            .map_err(|err| self.start_failure_message(None, &format!("端口准备失败：{err}")))?;
        let profile = self
            .active_profile()
            .ok_or_else(|| "没有活动配置".to_string())?;
        let config_digest = self
            .prepare_runtime_profile(&profile, enable_takeover)
            .map_err(|err| {
                self.start_failure_message(Some(&profile), &format!("配置生成失败：{err}"))
            })?;
        if self.process.is_some() {
            let same_profile = self.runtime_profile_id.as_deref() == Some(profile.id.as_str());
            let same_config = self.runtime_config_digest.as_deref() == Some(config_digest.as_str());
            if same_profile && same_config && self.controller("GET", "/version", None, 900).is_ok()
            {
                self.apply_takeover_after_core_ready(enable_takeover);
                return Ok(json!({
                    "ok": true,
                    "message": "Core already running",
                    "standby": !enable_takeover,
                    "trafficTakeover": self.traffic_takeover,
                    "connection": self.connection_closure()
                }));
            }
            let restore_system_proxy = self.settings.system_proxy;
            let restore_takeover = self.traffic_takeover && enable_takeover;
            self.add_log(
                "Runtime profile or controller drift detected; restarting mihomo",
                "warn",
            );
            self.stop()?;
            if restore_takeover {
                self.restore_system_proxy_preference(restore_system_proxy);
            }
            thread::sleep(Duration::from_millis(250));
        }
        ensure_dir(&self.home_dir).map_err(|err| {
            self.start_failure_message(Some(&profile), &format!("运行目录准备失败：{err}"))
        })?;
        let runtime_profile_path = self.runtime_profile_path();
        let runtime_profile_arg = runtime_profile_path.to_string_lossy().to_string();
        self.add_log(
            format!(
                "Starting mihomo{}: {}",
                if enable_takeover { "" } else { " in standby" },
                profile.name
            ),
            "info",
        );
        let mut command = Command::new(&self.core_path);
        command
            .args([
                "-d",
                &self.home_dir.to_string_lossy(),
                "-f",
                &runtime_profile_arg,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = command.spawn().map_err(|err| {
            self.start_failure_message(Some(&profile), &format!("核心进程启动失败：{err}"))
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
            self.terminate_core_process("Stopping failed mihomo startup");
            return Err(message);
        }
        self.runtime_profile_id = Some(profile.id.clone());
        self.runtime_config_digest = Some(config_digest);
        self.apply_takeover_after_core_ready(enable_takeover);
        Ok(json!({
            "ok": true,
            "standby": !enable_takeover,
            "trafficTakeover": self.traffic_takeover,
            "connection": self.connection_closure()
        }))
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
        let restore_system_proxy = self.settings.system_proxy;
        let restore_takeover = self.traffic_takeover;
        self.stop()?;
        if restore_takeover {
            self.restore_system_proxy_preference(restore_system_proxy);
        }
        thread::sleep(Duration::from_millis(delay_ms));
        if restore_takeover {
            self.start()
        } else {
            self.start_standby()
        }
    }

    fn stop(&mut self) -> Result<JsonValue, String> {
        let restore_result = self.set_system_proxy(false);
        self.terminate_core_process("Stopping mihomo");
        if let Err(err) = restore_result {
            return Err(format!(
                "Core stopped, but Windows system proxy restore failed: {err}"
            ));
        }
        Ok(json!({ "ok": true }))
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
        self.terminate_core_process("Stopping mihomo for app exit");
    }

    fn wait_for_controller(&mut self) -> Result<(), String> {
        for _ in 0..24 {
            if let Some(reason) = self.reap_exited_core() {
                self.add_log(&reason, "error");
                return Err(reason);
            }
            if self.controller("GET", "/version", None, 300).is_ok() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err("mihomo 控制接口未在 6 秒内就绪，请查看日志中的核心错误。".to_string())
    }

    fn controller(
        &self,
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

    fn traffic_snapshot(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .map_err(|err| err.to_string())?;
        let url = format!("http://127.0.0.1:{}/traffic", self.settings.controller_port);
        let res = client
            .get(url)
            .bearer_auth(&self.settings.secret)
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

    fn status(&mut self) -> JsonValue {
        if let Some(reason) = self.reap_exited_core() {
            self.add_log(reason, "warn");
        }
        let running = self.process.is_some();
        let traffic = if running {
            self.traffic_snapshot(120)
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
            "coreReady": running,
            "trafficTakeover": self.traffic_takeover,
            "standby": running && !self.traffic_takeover,
            "controller": running,
            "version": JsonValue::Null,
            "traffic": traffic,
            "mode": self.settings.mode,
            "systemProxy": self.settings.system_proxy,
            "activeProfile": self.active_profile(),
            "network": {
                "lanIp": lan_ip,
                "proxyEndpoint": format!("127.0.0.1:{}", self.settings.mixed_port),
                "outboundIp": self.cached_outbound_ip()
            },
            "permissions": {
                "isAdmin": is_process_elevated(),
                "requiresAdminFor": ["TUN", "断网保护"]
            },
            "speedTest": self.speed_test_snapshot(),
            "settings": self.public_settings(),
            "protection": self.protection_status(),
            "logs": self.recent_logs(120)
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

    fn cached_outbound_ip(&self) -> String {
        if self.outbound_ip_cache.trim().is_empty() {
            "-".to_string()
        } else {
            self.outbound_ip_cache.clone()
        }
    }

    fn connection_closure(&self) -> JsonValue {
        let groups = self.proxy_groups();
        let current_node = self
            .current_outbound_ip_proxy_name(&groups)
            .unwrap_or_else(|| "-".to_string());
        let outbound_ip = self.cached_outbound_ip();
        json!({
            "coreRunning": self.process.is_some(),
            "trafficTakeover": self.traffic_takeover,
            "systemProxyWanted": self.settings.system_proxy,
            "systemProxyApplied": self.traffic_takeover && self.settings.system_proxy,
            "tunEnabled": self.settings.tun_enabled,
            "mode": self.settings.mode,
            "activeProfileId": self.settings.active_profile_id,
            "currentNode": current_node,
            "outboundIp": outbound_ip,
            "outboundIpKnown": outbound_ip != "-",
            "checkedAt": now_secs()
        })
    }

    fn public_settings(&self) -> JsonValue {
        json!({
            "activeProfileId": self.settings.active_profile_id,
            "mixedPort": self.settings.mixed_port,
            "controllerPort": self.settings.controller_port,
            "profiles": self.public_profiles(),
            "startWithSystemProxy": self.settings.start_with_system_proxy,
            "systemProxy": self.settings.system_proxy,
            "killSwitchEnabled": self.settings.kill_switch_enabled,
            "tunEnabled": self.settings.tun_enabled,
            "tunStack": self.settings.tun_stack,
            "dnsHijackEnabled": self.settings.dns_hijack_enabled,
            "ipv6Enabled": self.settings.ipv6_enabled,
            "allowLan": self.settings.allow_lan,
            "logLevel": self.settings.log_level,
            "selectedProxyMap": &self.settings.selected_proxy_map,
            "manualNodes": &self.settings.manual_nodes,
            "reliability": {
                "auto": self.settings.reliability_auto,
                "profileFailover": self.settings.reliability_profile_failover,
                "failureThreshold": self.settings.reliability_failure_threshold,
                "maxDelayMs": self.settings.reliability_max_delay_ms,
                "candidateLimit": self.settings.reliability_candidate_limit,
                "failures": self.reliability_failures
            },
            "runtimes": { "mihomo": self.core_path.exists() },
            "reservedPorts": {
                "mixed": RESERVED_MIXED_PORTS,
                "reason": "7890 is reserved for FlClash/Codex traffic"
            },
            "proxyTakeover": {
                "endpoint": format!("127.0.0.1:{}", self.settings.mixed_port),
                "active": self.traffic_takeover,
                "standby": self.process.is_some() && !self.traffic_takeover,
                "snapshotCaptured": self.proxy_snapshot_path.exists(),
                "restoresPreviousProxy": true
            }
        })
    }

    fn public_profiles(&self) -> Vec<JsonValue> {
        self.settings.profiles.iter().map(public_profile).collect()
    }

    fn protection_status(&self) -> JsonValue {
        let running = self.process.is_some();
        let level = if !running {
            "idle"
        } else if !self.traffic_takeover {
            "standby"
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
            "standby" => "核心待命",
            "partial" => "仅内核运行",
            _ => "未接管",
        };
        json!({ "level": level, "label": label })
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
            return Err("断网保护需要管理员权限，请在设置中以管理员身份重启 Aegos。".to_string());
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
        let ok = proxy_points_to_aegos(&current, self.settings.mixed_port);
        if !ok {
            return Err(format!(
                "Windows system proxy still points to '{}', expected 127.0.0.1:{}",
                current.proxy_server, self.settings.mixed_port
            ));
        }
        Ok(json!({
            "ok": true,
            "endpoint": format!("127.0.0.1:{}", self.settings.mixed_port),
            "current": current
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
                        "TUN 模式需要管理员权限，请在设置中以管理员身份重启 Aegos。".to_string()
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
                self.settings.mixed_port = mixed_port_from_value(value, self.settings.mixed_port)?
            }
            "controllerPort" => {
                self.settings.controller_port =
                    port_from_value(value, self.settings.controller_port, "Controller port")?
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
        if self.process.is_some() {
            let _ = self.controller("PATCH", "/configs", Some(json!({ "mode": mode })), 3000);
        }
        Ok(mode.to_string())
    }

    fn proxy_groups(&self) -> JsonValue {
        let mut result = None;
        if self.process.is_some() {
            if let Ok(data) = self.controller("GET", "/proxies", None, 1200) {
                if let Some(proxies) = data.get("proxies").and_then(|v| v.as_object()) {
                    let groups: Vec<JsonValue> = proxies
                        .values()
                        .filter(|item| matches!(item.get("type").and_then(|v| v.as_str()), Some("Selector" | "URLTest" | "Fallback" | "LoadBalance" | "Relay")))
                        .filter(|item| item.get("name").and_then(|v| v.as_str()) != Some(AEGOS_OUTBOUND_IP_GROUP))
                        .filter(|item| item.get("all").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false))
                        .map(|group| {
                            let items = group.get("all").and_then(|v| v.as_array()).cloned().unwrap_or_default()
                                .into_iter()
                                .filter_map(|name| name.as_str().map(|name| {
                                    normalize_proxy_item(proxies.get(name).cloned().unwrap_or_else(|| json!({ "name": name, "type": "Unknown", "alive": true, "delay": -1 })))
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
                    result = Some(json!(groups));
                }
            }
        }
        let mut groups = result.unwrap_or_else(|| self.profile_proxy_groups());
        self.apply_group_resolution(&mut groups);
        self.apply_speed_test_delays(&mut groups);
        self.annotate_manual_groups(&mut groups);
        groups
    }

    fn active_manual_node_names(&self) -> HashSet<String> {
        self.active_profile()
            .and_then(|profile| self.settings.manual_nodes.get(&profile.id).cloned())
            .map(|nodes| nodes.keys().cloned().collect::<HashSet<_>>())
            .unwrap_or_default()
    }

    fn annotate_manual_groups(&self, groups: &mut JsonValue) {
        let names = self.active_manual_node_names();
        if names.is_empty() {
            return;
        }
        let Some(groups) = groups.as_array_mut() else {
            return;
        };
        for group in groups {
            let Some(items) = group
                .get_mut("items")
                .and_then(|items| items.as_array_mut())
            else {
                continue;
            };
            for item in items {
                let Some(name) = item.get("name").and_then(|value| value.as_str()) else {
                    continue;
                };
                if names.contains(name) {
                    if let Some(map) = item.as_object_mut() {
                        map.insert("manual".to_string(), json!(true));
                        map.insert("fixed".to_string(), json!(true));
                        map.insert("static".to_string(), json!(true));
                        map.insert("source".to_string(), json!("manual"));
                    }
                }
            }
        }
    }

    fn profile_proxy_groups(&self) -> JsonValue {
        let Some(profile) = self.active_profile() else {
            return json!([]);
        };
        let raw = fs::read_to_string(profile.path).unwrap_or_default();
        let config: YamlValue =
            serde_yaml::from_str(&raw).unwrap_or_else(|_| YamlValue::Mapping(Mapping::new()));
        let proxies = config
            .get(yaml_key("proxies"))
            .and_then(|v| v.as_sequence())
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
                        proxy_items
                            .get(item_name)
                            .cloned()
                            .unwrap_or_else(|| {
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
                let now = self
                    .settings
                    .selected_proxy_map
                    .get(name)
                    .cloned()
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
                            let select_name = item.get("name").and_then(|value| value.as_str())?;
                            let name = item
                                .get("realProxyName")
                                .or_else(|| item.get("name"))
                                .and_then(|value| value.as_str())?;
                            if matches!(name, "DIRECT" | "REJECT" | "PASS" | "COMPATIBLE") {
                                return None;
                            }
                            let protocol = item
                                .get("speedProtocol")
                                .or_else(|| item.get("protocol"))
                                .or_else(|| item.get("type"))
                                .and_then(|value| value.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            Some(SpeedTestTarget {
                                name: name.to_string(),
                                select_name: select_name.to_string(),
                                group_name: group_name.clone(),
                                protocol,
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

    fn apply_group_resolution(&self, groups: &mut JsonValue) {
        let Some(snapshot) = groups.as_array().cloned() else {
            return;
        };
        let group_names = snapshot
            .iter()
            .filter_map(|group| group.get("name").and_then(|value| value.as_str()))
            .map(|name| name.to_string())
            .collect::<HashSet<_>>();
        let Some(group_items) = groups.as_array_mut() else {
            return;
        };
        for group in group_items {
            let group_name = group
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let selected = self
                .settings
                .selected_proxy_map
                .get(&group_name)
                .cloned()
                .unwrap_or_else(|| group_selected_name(group, &self.settings.selected_proxy_map));
            if !selected.is_empty() {
                if let Some(map) = group.as_object_mut() {
                    map.insert("now".to_string(), json!(selected));
                }
            }
            if let Some(items) = group
                .get_mut("items")
                .and_then(|items| items.as_array_mut())
            {
                for item in items {
                    let Some(name) = item
                        .get("name")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                    else {
                        continue;
                    };
                    if !group_names.contains(&name) {
                        continue;
                    }
                    let leaf =
                        resolve_group_leaf(&snapshot, &self.settings.selected_proxy_map, &name, 0);
                    if let Some(map) = item.as_object_mut() {
                        map.insert("group".to_string(), json!(true));
                        map.insert("type".to_string(), json!("Group"));
                        map.insert("realProxyName".to_string(), json!(leaf));
                    }
                }
            }
        }
    }

    fn apply_speed_test_delays(&self, groups: &mut JsonValue) {
        let speed = self.speed_test.lock().unwrap().clone();
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
                                    map.insert(
                                        "medianDelay".to_string(),
                                        json!(health.median_delay),
                                    );
                                    map.insert("jitter".to_string(), json!(health.jitter));
                                    map.insert(
                                        "failureStreak".to_string(),
                                        json!(health.failure_streak),
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
        let leaf = resolve_group_leaf(snapshot, &self.settings.selected_proxy_map, &primary, 0);
        if leaf.trim().is_empty() || leaf == AEGOS_OUTBOUND_IP_GROUP {
            return None;
        }
        Some(leaf)
    }

    fn sync_outbound_ip_group_selection(&mut self) -> Option<String> {
        if self.process.is_none() {
            return None;
        }
        let groups = self.proxy_groups();
        let proxy = self.current_outbound_ip_proxy_name(&groups)?;
        if let Err(err) = self.controller(
            "PUT",
            &format!("/proxies/{}", url_path_encode(AEGOS_OUTBOUND_IP_GROUP)),
            Some(json!({ "name": proxy })),
            1500,
        ) {
            self.add_log(
                format!("Outbound IP lookup group sync failed: {err}"),
                "warn",
            );
            return None;
        }
        Some(proxy)
    }

    fn speed_test_snapshot(&self) -> JsonValue {
        let speed = self.speed_test.lock().unwrap().clone();
        let now = now_secs();
        json!({
            "runId": speed.run_id,
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
            "confidence": speed_confidence_summary(&speed, now),
            "lowLatency": speed.low_latency,
            "recommended": speed.recommended
        })
    }

    fn reset_speed_test_state(&self, reason: &str, clear_health: bool) {
        let mut speed = self.speed_test.lock().unwrap();
        let run_id = speed.run_id.saturating_add(1);
        let health = if clear_health {
            HashMap::new()
        } else {
            speed.health.clone()
        };
        *speed = SpeedTestState {
            run_id,
            running: false,
            updated_at: now_secs(),
            health,
            error: Some(reason.to_string()),
            ..SpeedTestState::default()
        };
    }

    fn best_proxy_candidate(&self) -> Option<JsonValue> {
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        let speed = self.speed_test.lock().unwrap().clone();
        speed_recommendation(&targets, &speed.health, now_secs())
    }

    fn node_diagnostics(&self, name: String) -> Result<JsonValue, String> {
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        let target = targets
            .iter()
            .find(|target| target.name == name || target.select_name == name)
            .cloned()
            .ok_or_else(|| format!("Node not found: {name}"))?;
        let speed = self.speed_test.lock().unwrap().clone();
        let health = speed.health.get(&target.name).cloned();
        let logs = self.recent_node_logs(&target.name, 20);
        let last_failure = logs
            .iter()
            .rev()
            .find(|entry| entry.level == "warn" || entry.level == "error")
            .map(|entry| {
                json!({
                    "level": entry.level,
                    "category": entry.category,
                    "line": entry.line,
                    "classification": classify_failure_reason(&entry.line)
                })
            });
        let region = infer_node_region(&target.name);
        let suggestions = self
            .recovery_suggestions(8)
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
        if self.process.is_some() && self.controller("GET", "/version", None, 900).is_ok() {
            return Ok(());
        }
        if self.traffic_takeover {
            self.add_log(
                "Speed test requires controller recovery; restarting active core",
                "warn",
            );
            self.start()?;
        } else {
            self.add_log(
                "Speed test starting mihomo in standby without traffic takeover",
                "info",
            );
            self.start_standby()?;
        }
        Ok(())
    }

    fn start_proxy_delay_test(&mut self) -> Result<JsonValue, String> {
        if let Err(err) = self.ensure_core_for_delay_test() {
            let message = format!("测速准备失败：{err}");
            let mut speed = self.speed_test.lock().unwrap();
            speed.running = false;
            speed.error = Some(message.clone());
            speed.updated_at = now_secs();
            return Err(message);
        }
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        let total = targets.len();
        if total == 0 {
            return Ok(self.speed_test_snapshot());
        }

        let controller_port = self.settings.controller_port;
        let secret = self.settings.secret.clone();
        let speed_test = self.speed_test.clone();
        let previous_health = speed_test.lock().unwrap().health.clone();
        let phases = speed_test_phases(targets.clone(), &previous_health, now_secs());
        let run_id;
        {
            let mut speed = speed_test.lock().unwrap();
            if speed.running {
                drop(speed);
                return Ok(self.speed_test_snapshot());
            }
            let now = now_secs();
            run_id = speed.run_id.saturating_add(1);
            *speed = SpeedTestState {
                run_id,
                running: true,
                started_at: now,
                updated_at: now,
                total,
                completed: 0,
                ok: 0,
                failed: 0,
                delays: targets
                    .iter()
                    .map(|target| (target.name.clone(), 0))
                    .collect(),
                health: previous_health,
                low_latency: Vec::new(),
                recommended: None,
                error: None,
            };
        }

        let speed_firewall_enabled = self.settings.kill_switch_enabled;
        let speed_firewall_ports = if speed_firewall_enabled {
            self.speed_test_firewall_ports()
        } else {
            Vec::new()
        };
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
                    let message = format!("断网保护测速放行失败：{err}");
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
                        let secret = secret.clone();
                        let client = client.clone();
                        handles.push(thread::spawn(move || {
                            let delay = test_proxy_delay_fast(
                                &client,
                                controller_port,
                                &secret,
                                &target.name,
                                &target.protocol,
                            );
                            let _ = tx.send((target, delay));
                        }));
                    }
                    drop(tx);
                    for (target, delay) in rx {
                        let mut speed = speed_test.lock().unwrap();
                        if !speed.running || speed.run_id != run_id {
                            cleanup_speed_firewall();
                            return;
                        }
                        speed.completed += 1;
                        if delay > 0 {
                            speed.ok += 1;
                        } else {
                            speed.failed += 1;
                        }
                        speed.delays.insert(target.name.clone(), delay);
                        let now = now_secs();
                        let health = update_node_health(
                            speed.health.get(&target.name),
                            &target.name,
                            &target.protocol,
                            delay,
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

    fn test_single_proxy_delay(&mut self, name: String) -> Result<JsonValue, String> {
        self.ensure_core_for_delay_test()?;
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        let target = targets
            .iter()
            .find(|target| target.name == name || target.select_name == name)
            .cloned()
            .ok_or_else(|| format!("Node not found: {name}"))?;
        {
            let mut speed = self.speed_test.lock().unwrap();
            speed.delays.insert(target.name.clone(), 0);
            speed.error = None;
            speed.updated_at = now_secs();
        }
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(6500))
            .build()
            .map_err(|err| err.to_string())?;
        let speed_firewall_ports = if self.settings.kill_switch_enabled {
            self.speed_test_firewall_ports()
        } else {
            Vec::new()
        };
        self.set_speed_test_firewall_rules(true, &speed_firewall_ports)?;
        let delay = test_proxy_delay_with_retry(
            &client,
            self.settings.controller_port,
            &self.settings.secret,
            &target.name,
            &target.protocol,
        );
        if let Err(err) = self.set_speed_test_firewall_rules(false, &speed_firewall_ports) {
            self.add_log(
                format!("Speed test firewall cleanup failed after single test: {err}"),
                "warn",
            );
        }
        let now = now_secs();
        let health = {
            let mut speed = self.speed_test.lock().unwrap();
            let health = update_node_health(
                speed.health.get(&target.name),
                &target.name,
                &target.protocol,
                delay,
                now,
            );
            speed.delays.insert(target.name.clone(), delay);
            speed.health.insert(target.name.clone(), health.clone());
            speed.low_latency = low_latency_names(&speed.health, now);
            speed.recommended = speed_recommendation(&targets, &speed.health, now);
            speed.updated_at = now;
            health
        };
        self.add_log(
            format!("Single node delay tested: {} = {} ms", target.name, delay),
            if delay > 0 { "info" } else { "warn" },
        );
        Ok(json!({
            "ok": delay > 0,
            "group": target.group_name,
            "proxy": target.select_name,
            "realProxyName": target.name,
            "protocol": target.protocol,
            "delay": delay,
            "medianDelay": health.median_delay,
            "jitter": health.jitter,
            "healthStatus": health.status,
            "healthConfidence": health.confidence,
            "lastTestedAt": health.last_tested_at,
            "lastSuccessAt": health.last_success_at,
            "resultAgeSecs": if health.last_success_at > 0 { now.saturating_sub(health.last_success_at) } else { 0 },
            "score": health.score
        }))
    }

    fn test_proxy_delays(&mut self) -> JsonValue {
        let _ = self.start_proxy_delay_test();
        let mut groups = self.proxy_groups();
        self.apply_speed_test_delays(&mut groups);
        groups
    }

    fn cancel_proxy_delay_test(&mut self) -> JsonValue {
        self.reset_speed_test_state("cancelled", false);
        json!({ "ok": true })
    }

    fn probe_proxy_network(&self, timeout_ms: u64) -> JsonValue {
        if self.process.is_none() {
            return json!({
                "ok": false,
                "url": "",
                "status": 0,
                "reason": "core stopped"
            });
        }
        let proxy_url = format!("http://127.0.0.1:{}", self.settings.mixed_port);
        let proxy = match reqwest::Proxy::all(&proxy_url) {
            Ok(proxy) => proxy,
            Err(err) => {
                return json!({
                    "ok": false,
                    "url": "",
                    "status": 0,
                    "reason": err.to_string()
                })
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
                return json!({
                    "ok": false,
                    "url": "",
                    "status": 0,
                    "reason": err.to_string()
                })
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
                        return json!({
                            "ok": true,
                            "url": url,
                            "status": status,
                            "reason": ""
                        });
                    }
                    last_error = format!("HTTP {status}");
                }
                Err(err) => last_error = err.to_string(),
            }
        }
        json!({
            "ok": false,
            "url": "",
            "status": 0,
            "reason": last_error
        })
    }

    fn recovery_group_rank(name: &str) -> usize {
        match name {
            "GLOBAL" => 0,
            "Proxy" => 1,
            "Proxies" => 2,
            _ => 10,
        }
    }

    fn recovery_candidates(&self) -> Vec<(String, String, i64)> {
        let groups = self.proxy_groups();
        let Some(group_items) = groups.as_array() else {
            return Vec::new();
        };
        let mut group_refs = group_items.iter().collect::<Vec<_>>();
        group_refs.sort_by_key(|group| {
            group
                .get("name")
                .and_then(|value| value.as_str())
                .map(Self::recovery_group_rank)
                .unwrap_or(99)
        });
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
        let mut seen = HashSet::new();
        let mut tested = 0usize;
        let mut results = Vec::new();
        let limit = self.settings.reliability_candidate_limit as usize;
        let max_delay = self.settings.reliability_max_delay_ms as i64;
        for group in group_refs {
            let group_name = group
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let current = group
                .get("now")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let Some(items) = group.get("items").and_then(|value| value.as_array()) else {
                continue;
            };
            for item in items {
                if tested >= limit {
                    break;
                }
                let Some(name) = item.get("name").and_then(|value| value.as_str()) else {
                    continue;
                };
                let protocol = item
                    .get("type")
                    .or_else(|| item.get("protocol"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("unknown");
                if name == current || !is_recovery_candidate_name(name) {
                    continue;
                }
                let key = format!("{group_name}\n{name}");
                if !seen.insert(key) {
                    continue;
                }
                tested += 1;
                let delay = test_proxy_delay_with_retry(
                    &client,
                    self.settings.controller_port,
                    &self.settings.secret,
                    name,
                    protocol,
                );
                if delay > 0 && delay <= max_delay {
                    results.push((group_name.clone(), name.to_string(), delay));
                }
            }
        }
        results.sort_by_key(|(_, _, delay)| *delay);
        results
    }

    fn recovery_suggestions(&self, limit: usize) -> Vec<JsonValue> {
        let groups = self.proxy_groups();
        let targets = Self::collect_proxy_targets(&groups);
        let speed = self.speed_test.lock().unwrap().clone();
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
        let max_delay = self.settings.reliability_max_delay_ms as i64;
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
                return Ok(Some(json!({
                    "action": "switchProxy",
                    "group": group,
                    "proxy": proxy,
                    "delay": delay,
                    "probe": probe
                })));
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
            return Ok(json!({
                "ok": true,
                "healthy": true,
                "action": "none",
                "failures": self.reliability_failures,
                "probe": before,
                "suggestions": self.recovery_suggestions(5),
                "settings": self.public_settings()
            }));
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
            return Ok(json!({
                "ok": false,
                "healthy": false,
                "action": "observe",
                "failures": self.reliability_failures,
                "threshold": self.settings.reliability_failure_threshold,
                "probe": before,
                "suggestions": self.recovery_suggestions(5),
                "settings": self.public_settings()
            }));
        }
        if let Some(result) = self.try_recover_current_profile()? {
            self.add_log("Reliability recovery switched proxy", "info");
            self.reliability_failures = 0;
            return Ok(json!({
                "ok": true,
                "healthy": true,
                "profileChanged": false,
                "failures": self.reliability_failures,
                "result": result,
                "suggestions": self.recovery_suggestions(5),
                "settings": self.public_settings()
            }));
        }
        if self.settings.reliability_profile_failover {
            let original_profile_id = self.settings.active_profile_id.clone();
            let profile_ids = self
                .settings
                .profiles
                .iter()
                .filter(|profile| {
                    profile.id != original_profile_id
                        && profile.id != "direct"
                        && profile.profile_type != "builtin"
                })
                .map(|profile| profile.id.clone())
                .collect::<Vec<_>>();
            for profile_id in profile_ids {
                let profile = self.set_active_profile(&profile_id)?;
                self.add_log(format!("Recovery trying profile: {}", profile.name), "info");
                if let Some(result) = self.try_recover_current_profile()? {
                    self.add_log(
                        format!("Reliability recovery switched profile: {}", profile.name),
                        "info",
                    );
                    self.reliability_failures = 0;
                    return Ok(json!({
                        "ok": true,
                        "healthy": true,
                        "profileChanged": true,
                        "failures": self.reliability_failures,
                        "profile": profile,
                        "result": result,
                        "suggestions": self.recovery_suggestions(5),
                        "settings": self.public_settings()
                    }));
                }
            }
            if self.settings.active_profile_id != original_profile_id {
                let _ = self.set_active_profile(&original_profile_id);
            }
        }
        Ok(json!({
            "ok": false,
            "healthy": false,
            "action": "failed",
            "failures": self.reliability_failures,
            "probe": before,
            "suggestions": self.recovery_suggestions(5),
            "settings": self.public_settings()
        }))
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
            if let Err(err) = self.controller(
                "PUT",
                &format!("/proxies/{}", url_path_encode(group)),
                Some(json!({ "name": proxy })),
                5000,
            ) {
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
                return Err(classified_error("Node switch", err));
            }
            let _ = self.sync_outbound_ip_group_selection();
            let _ = self.controller("DELETE", "/connections", None, 1500);
        }
        Ok(true)
    }

    fn connections(&self) -> JsonValue {
        self.controller("GET", "/connections", None, 900)
            .ok()
            .and_then(|data| data.get("connections").cloned())
            .unwrap_or_else(|| json!([]))
    }

    fn active_connection_count(&self) -> JsonValue {
        let count = if self.process.is_some() {
            self.controller("GET", "/connections", None, 350)
                .ok()
                .and_then(|data| {
                    data.get("connections")
                        .and_then(|value| value.as_array())
                        .map(|items| items.len())
                })
                .unwrap_or(0)
        } else {
            0
        };
        json!({
            "count": count,
            "checkedAt": now_secs()
        })
    }

    fn close_connection(&self, id: &str) -> Result<bool, String> {
        self.controller("DELETE", &format!("/connections/{id}"), None, 2000)?;
        Ok(true)
    }

    fn close_connections(&self) -> Result<bool, String> {
        self.controller("DELETE", "/connections", None, 3000)?;
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
        self.settings.active_profile_id = id.to_string();
        self.save_settings()?;
        if was_running {
            let restore_system_proxy = self.settings.system_proxy;
            let restore_takeover = self.traffic_takeover;
            let apply_result = self.hot_reload_profile(&profile).or_else(|hot_err| {
                self.add_log(
                    format!("Profile hot reload failed; falling back to restart: {hot_err}"),
                    "warn",
                );
                self.restart_core_preserving_proxy(250)
            });
            if let Err(start_err) = apply_result {
                let _ = self.stop();
                if restore_takeover {
                    self.restore_system_proxy_preference(restore_system_proxy);
                }
                self.settings.active_profile_id = previous_profile_id.clone();
                let save_result = self.save_settings();
                let rollback_result = if save_result.is_ok() {
                    if restore_takeover {
                        self.start().map(|_| ())
                    } else {
                        self.start_standby().map(|_| ())
                    }
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
            return Err("订阅名称不能为空".to_string());
        }
        if next_name.chars().count() > 80 {
            return Err("订阅名称不能超过 80 个字符".to_string());
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
            return Err("内置直连配置不能删除".to_string());
        }
        let was_running = self.process.is_some();
        let was_active = self.settings.active_profile_id == id;
        let restore_takeover = self.traffic_takeover;
        let remove_path = self
            .settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .map(|profile| profile.path.clone());
        if was_running && was_active {
            let restore_system_proxy = self.settings.system_proxy;
            self.stop()?;
            if restore_takeover {
                self.restore_system_proxy_preference(restore_system_proxy);
            }
            thread::sleep(Duration::from_millis(250));
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
            if restore_takeover {
                self.start()?;
            } else {
                self.start_standby()?;
            }
        }
        Ok(true)
    }

    fn save_manual_node(&mut self, input: JsonValue) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "请先导入或启用一个订阅，再添加固定节点".to_string())?;
        let node = normalize_manual_node(&input)?;
        let name = node
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
        if let Err(err) = self.save_settings() {
            self.settings = previous_settings;
            return Err(format!("固定节点保存失败：{err}"));
        }
        if self.process.is_some() && self.settings.active_profile_id == profile.id {
            if let Err(err) = self.hot_reload_profile(&profile) {
                self.settings = previous_settings;
                let _ = self.save_settings();
                let message = format!("固定节点保存后热重载失败，已回滚：{err}");
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
        proxy_snapshot_path: core.proxy_snapshot_path.clone(),
        running: core.process.is_some(),
        traffic_takeover: core.traffic_takeover,
        last_traffic: core.last_traffic.clone(),
        speed_test,
        lan_ip_cache: core.lan_ip_cache.clone(),
        outbound_ip_cache: core.cached_outbound_ip(),
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
    let level = if !snapshot.running {
        "idle"
    } else if !snapshot.traffic_takeover {
        "standby"
    } else if snapshot.settings.kill_switch_enabled && snapshot.settings.tun_enabled {
        "strict"
    } else if snapshot.settings.kill_switch_enabled {
        "guarded"
    } else if snapshot.settings.tun_enabled {
        "tunnel"
    } else if snapshot.settings.system_proxy {
        "proxy"
    } else {
        "partial"
    };
    let label = match level {
        "strict" => "强保护",
        "guarded" => "断网保护",
        "tunnel" => "全局接管",
        "proxy" => "系统代理",
        "standby" => "核心待命",
        "partial" => "仅内核运行",
        _ => "未接管",
    };
    json!({ "level": level, "label": label })
}

fn diagnostics_public_settings(snapshot: &DiagnosticsSnapshot) -> JsonValue {
    json!({
        "activeProfileId": snapshot.settings.active_profile_id,
        "mixedPort": snapshot.settings.mixed_port,
        "controllerPort": snapshot.settings.controller_port,
        "profiles": snapshot.settings.profiles.iter().map(public_profile).collect::<Vec<_>>(),
        "startWithSystemProxy": snapshot.settings.start_with_system_proxy,
        "systemProxy": snapshot.settings.system_proxy,
        "killSwitchEnabled": snapshot.settings.kill_switch_enabled,
        "tunEnabled": snapshot.settings.tun_enabled,
        "tunStack": snapshot.settings.tun_stack,
        "dnsHijackEnabled": snapshot.settings.dns_hijack_enabled,
        "ipv6Enabled": snapshot.settings.ipv6_enabled,
        "allowLan": snapshot.settings.allow_lan,
        "logLevel": snapshot.settings.log_level,
        "selectedProxyMap": &snapshot.settings.selected_proxy_map,
        "manualNodes": &snapshot.settings.manual_nodes,
        "reliability": {
            "auto": snapshot.settings.reliability_auto,
            "profileFailover": snapshot.settings.reliability_profile_failover,
            "failureThreshold": snapshot.settings.reliability_failure_threshold,
            "maxDelayMs": snapshot.settings.reliability_max_delay_ms,
            "candidateLimit": snapshot.settings.reliability_candidate_limit,
            "failures": snapshot.reliability_failures
        },
        "runtimes": { "mihomo": snapshot.core_path.exists() },
        "reservedPorts": {
            "mixed": RESERVED_MIXED_PORTS,
            "reason": "7890 is reserved for FlClash/Codex traffic"
        },
        "proxyTakeover": {
            "endpoint": format!("127.0.0.1:{}", snapshot.settings.mixed_port),
            "active": snapshot.traffic_takeover,
            "standby": snapshot.running && !snapshot.traffic_takeover,
            "snapshotCaptured": snapshot.proxy_snapshot_path.exists(),
            "restoresPreviousProxy": true
        }
    })
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
        json!({ "up": 0, "down": 0, "upTotal": 0, "downTotal": 0 })
    };
    json!({
        "product": "Aegos",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "runtime": "mihomo",
        "shell": "tauri",
        "running": snapshot.running,
        "coreReady": snapshot.running,
        "trafficTakeover": snapshot.traffic_takeover,
        "standby": snapshot.running && !snapshot.traffic_takeover,
        "controller": snapshot.running,
        "version": JsonValue::Null,
        "traffic": traffic,
        "mode": snapshot.settings.mode,
        "systemProxy": snapshot.settings.system_proxy,
        "activeProfile": snapshot.active_profile,
        "network": {
            "lanIp": lan_ip,
            "proxyEndpoint": format!("127.0.0.1:{}", snapshot.settings.mixed_port),
            "outboundIp": snapshot.outbound_ip_cache
        },
        "permissions": {
            "isAdmin": is_admin,
            "requiresAdminFor": ["TUN", "断网保护"]
        },
        "speedTest": diagnostics_speed_snapshot(&snapshot.speed_test),
        "settings": diagnostics_public_settings(snapshot),
        "protection": diagnostics_protection_status(snapshot),
        "logs": snapshot.status_logs
    })
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
            let raw = fs::read_to_string(&path)
                .map_err(|err| format!("配置读取失败 {}: {err}", path.display()))?;
            let source: YamlValue = serde_yaml::from_str(&raw)
                .map_err(|err| format!("YAML 解析失败 {}: {err}", path.display()))?;
            let patched =
                patch_config_with_settings(source, &snapshot.settings, Some(&profile.id))?;
            preflight_runtime_config(&patched, profile, &snapshot.settings).map(|report| {
                format!(
                    "{} proxies, {} groups, {} rules",
                    report
                        .get("proxies")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0),
                    report
                        .get("proxyGroups")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0),
                    report
                        .get("rules")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0)
                )
            })
        });
    let profile_preflight_ok = profile_preflight.is_ok();
    let profile_preflight_detail = profile_preflight.unwrap_or_else(|err| err);
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
    let expected_proxy_endpoint = format!("127.0.0.1:{}", snapshot.settings.mixed_port);
    let current_proxy_ok = current_proxy
        .as_ref()
        .map(|proxy| {
            !snapshot.settings.system_proxy
                || proxy_points_to_aegos(proxy, snapshot.settings.mixed_port)
        })
        .unwrap_or(false);
    let current_proxy_detail = current_proxy
        .as_ref()
        .map(|proxy| {
            format!(
                "enabled={}, server={}, expected={}",
                proxy.proxy_enable, proxy.proxy_server, expected_proxy_endpoint
            )
        })
        .unwrap_or_else(|err| format!("read failed: {err}"));
    let mixed_port_free = is_port_free(snapshot.settings.mixed_port);
    let controller_port_free = is_port_free(snapshot.settings.controller_port);
    let check =
        |name: &str, ok: bool, detail: String, severity: &str, category: &str, hint: &str| {
            json!({
                "name": name,
                "ok": ok,
                "detail": detail,
                "severity": if ok { "ok" } else { severity },
                "category": category,
                "hint": if ok { "" } else { hint },
                "actionable": !ok && !hint.is_empty()
            })
        };
    let checks = vec![
        check(
            "mihomo core",
            snapshot.core_path.exists(),
            snapshot.core_path.to_string_lossy().to_string(),
            "error",
            "runtime",
            "核心文件缺失或路径不可用，请重新放置 resources/core/mihomo.exe 后再启动。",
        ),
        check(
            "Active profile config",
            active_profile_exists,
            active_profile_path
                .clone()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|| "no active profile".to_string()),
            "error",
            "profile",
            "当前订阅配置文件不存在，请切换到可用订阅或重新导入订阅。",
        ),
        check(
            "Profile preflight",
            profile_preflight_ok,
            profile_preflight_detail,
            "error",
            "profile",
            "订阅预检失败，请优先检查订阅内容、代理组引用和端口配置。",
        ),
        check("Tauri shell", true, "Aegos".to_string(), "warning", "app", ""),
        check(
            "Administrator",
            admin_ok,
            if is_admin {
                "elevated".to_string()
            } else if admin_required {
                "not elevated; TUN and 断网保护 require admin restart".to_string()
            } else {
                "not elevated; only required when TUN or 断网保护 is enabled".to_string()
            },
            "warning",
            "permission",
            "TUN 或断网保护已启用时，需要在设置页以管理员身份重启 Aegos。",
        ),
        check(
            "FlClash/Codex port isolation",
            snapshot.settings.mixed_port != 7890,
            format!(
                "Aegos mixed port: {}, reserved: 7890",
                snapshot.settings.mixed_port
            ),
            "error",
            "network",
            "Aegos 不能占用 7890，建议保持 mixed port 为 7891，避免和 FlClash/Codex 代理冲突。",
        ),
        check(
            "Controller port",
            snapshot.settings.controller_port != snapshot.settings.mixed_port,
            format!("127.0.0.1:{}", snapshot.settings.controller_port),
            "error",
            "network",
            "控制端口不能和代理端口相同，请在设置页改成 19091 或其他未占用端口。",
        ),
        check(
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
        check(
            "Mixed port availability",
            snapshot.running || mixed_port_free,
            port_owner_detail(snapshot.settings.mixed_port),
            "error",
            "network",
            "Aegos core is not running, but the mixed proxy port is already occupied. Change Aegos mixed port or close the conflicting proxy app.",
        ),
        check(
            "Controller port availability",
            snapshot.running || controller_port_free,
            port_owner_detail(snapshot.settings.controller_port),
            "error",
            "network",
            "Aegos core is not running, but the controller port is already occupied. Change Aegos controller port or close the conflicting app.",
        ),
        check(
            "Windows System Proxy takeover",
            current_proxy_ok,
            current_proxy_detail,
            "warning",
            "network",
            "Aegos system proxy is enabled in settings, but Windows is not pointing at the Aegos endpoint. Toggle system proxy off/on or use repair takeover.",
        ),
        check(
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
            "TUN 已启用但当前不是管理员权限，请在设置页以管理员身份重启。",
        ),
        check(
            "断网保护",
            !snapshot.settings.kill_switch_enabled || is_admin,
            if snapshot.settings.kill_switch_enabled {
                "enabled"
            } else {
                "disabled"
            }
            .to_string(),
            "warning",
            "permission",
            "断网保护已启用但当前不是管理员权限，请在设置页以管理员身份重启。",
        ),
        check(
            "Recent core logs",
            recent_logs_ok,
            recent_log_detail,
            "warning",
            "logs",
            "最近核心日志出现 warning/error，请打开日志页查看启动失败或代理连接失败的上下文。",
        ),
    ];
    let failed_count = checks
        .iter()
        .filter(|item| {
            !item
                .get("ok")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        })
        .count();
    let error_count = checks
        .iter()
        .filter(|item| item.get("severity").and_then(|value| value.as_str()) == Some("error"))
        .count();
    let warning_count = checks
        .iter()
        .filter(|item| item.get("severity").and_then(|value| value.as_str()) == Some("warning"))
        .count();
    let next_actions = checks
        .iter()
        .filter(|item| {
            !item
                .get("ok")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
                && item
                    .get("actionable")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
        })
        .filter_map(|item| {
            item.get("hint")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .take(3)
        .collect::<Vec<_>>();
    json!({
        "generatedAt": now_iso(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "status": diagnostics_status_from_snapshot(&snapshot, is_admin),
        "summary": {
            "total": checks.len(),
            "failed": failed_count,
            "errors": error_count,
            "warnings": warning_count,
            "nextActions": next_actions
        },
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
    let patched = patch_config_with_settings(source.config, &settings, Some(&id))?;
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
    preflight_runtime_config(&patched, &profile, &settings).map_err(|err| {
        subscription_diagnostic(
            "runtime-preflight",
            format!("runtime config preflight failed: {err}"),
            "the subscription was downloaded, but the generated Mihomo config is not runnable; check unsupported node fields or malformed proxy groups",
        )
    })?;
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
        let previous_system_proxy = core.settings.system_proxy;
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
                core.restore_system_proxy_preference(previous_system_proxy);
                core.settings.profiles.retain(|item| item.id != profile.id);
                core.settings.active_profile_id = previous_profile_id.clone();
                let _ = remove_file_confined(&path, &profile_dir);
                let save_result = core.save_settings();
                let rollback_result = if save_result.is_ok() {
                    core.start().map(|_| ())
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
    let patched = patch_config_with_settings(source.config, &settings, Some(&profile.id))?;
    profile.node_count = summary.proxies;
    profile.proxy_group_count = summary.proxy_groups;
    preflight_runtime_config(&patched, &profile, &settings).map_err(|err| {
        subscription_diagnostic(
            "runtime-preflight",
            format!("runtime config preflight failed: {err}"),
            "the subscription was downloaded, but the generated Mihomo config is not runnable; the previous subscription is kept",
        )
    })?;
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
        let previous_system_proxy = core.settings.system_proxy;
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
                core.restore_system_proxy_preference(previous_system_proxy);
                if let Some(raw) = previous_raw.as_ref() {
                    let _ = atomic_write_text_confined(&profile_path, &profile_root, raw);
                }
                if let Some(stored) = core.settings.profiles.iter_mut().find(|p| p.id == id) {
                    *stored = previous_profile.clone();
                }
                let save_result = core.save_settings();
                let rollback_result = if save_result.is_ok() {
                    core.start().map(|_| ())
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
    let mixed_port = {
        let mut core = core.lock().unwrap();
        if core.process.is_none() {
            core.outbound_ip_cache = "-".to_string();
            core.outbound_ip_checked_at = now_secs();
            return Err("请先连接核心后再刷新落地 IP".to_string());
        }
        let _ = core.sync_outbound_ip_group_selection();
        core.settings.mixed_port
    };
    let ip = query_outbound_ip(mixed_port);
    let mut core = core.lock().unwrap();
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
    jobs: Arc<Mutex<HashMap<String, JobRecord>>>,
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
        "addProfileUrl" => "导入订阅",
        "renameProfile" => "重命名订阅",
        "updateProfile" => "更新订阅",
        "recoverNetwork" => "网络自愈",
        "refreshOutboundIp" => "刷新落地 IP",
        "startCore" => "连接核心",
        "stopCore" => "断开核心",
        "restartCore" => "重启核心",
        "setActiveProfile" => "切换订阅",
        "updateSettings" => "保存设置",
        "updateSetting" => "保存设置",
        "setMode" => "切换模式",
        "changeProxy" => "切换节点",
        "selectBestProxy" => "切换到推荐",
        _ => "后台任务",
    }
    .to_string()
}

fn set_job_state(
    jobs: &Arc<Mutex<HashMap<String, JobRecord>>>,
    id: &str,
    state: &str,
    progress: u64,
    total: u64,
    message: &str,
) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        if job.cancel_requested && job.state == "cancelled" {
            return;
        }
        job.state = state.to_string();
        job.progress = progress;
        job.total = total;
        job.message = message.to_string();
        job.updated_at = now_secs();
    }
}

fn job_cancel_requested(jobs: &Arc<Mutex<HashMap<String, JobRecord>>>, id: &str) -> bool {
    jobs.lock()
        .unwrap()
        .get(id)
        .map(|job| job.cancel_requested)
        .unwrap_or(false)
}

fn finish_cancelled(jobs: &Arc<Mutex<HashMap<String, JobRecord>>>, id: &str, message: &str) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.state = "cancelled".to_string();
        job.message = message.to_string();
        job.updated_at = now_secs();
        job.error = None;
    }
}

fn finish_job(
    jobs: &Arc<Mutex<HashMap<String, JobRecord>>>,
    id: &str,
    result: Result<JsonValue, String>,
) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.updated_at = now_secs();
        match result {
            Ok(value) => {
                job.state = "succeeded".to_string();
                job.progress = job.total.max(1);
                job.total = job.progress;
                job.message = "完成".to_string();
                job.result = Some(value);
                job.error = None;
            }
            Err(err) => {
                job.state = "failed".to_string();
                job.message = err.clone();
                job.error = Some(err);
            }
        }
    }
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
    ) {
        return Err(format!("Unsupported job kind: {kind}"));
    }
    let id = format!("job-{}-{}", now_secs(), hex_random(4));
    let now = now_secs();
    let record = JobRecord {
        id: id.clone(),
        kind: kind.clone(),
        label: job_label(&kind),
        state: "queued".to_string(),
        started_at: now,
        updated_at: now,
        progress: 0,
        total: 1,
        message: "等待执行".to_string(),
        result: None,
        error: None,
        cancel_requested: false,
    };
    state
        .jobs
        .lock()
        .unwrap()
        .insert(id.clone(), record.clone());

    let core = state.core.clone();
    let jobs = state.jobs.clone();
    let operations = state.operations.clone();
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
                        set_job_state(&jobs, &id, "running", 1, 2, "正在重命名订阅");
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
                set_job_state(&jobs, &id, "running", 1, 2, "diagnostics running");
                Ok(diagnostics_detached(core.clone()))
            }
            "recoverNetwork" => {
                let force = payload
                    .get("force")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                set_job_state(&jobs, &id, "running", 1, 4, "正在执行网络自愈");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "recoverNetwork")?;
                    core.lock().unwrap().recover_network(force)
                })()
            }
            "startCore" => {
                set_job_state(&jobs, &id, "running", 1, 4, "正在启动核心");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "startCore")?;
                    core.lock().unwrap().start()
                })()
            }
            "stopCore" => {
                set_job_state(&jobs, &id, "running", 1, 2, "正在断开核心");
                (|| -> Result<JsonValue, String> {
                    let _operation = lock_operation_queue(&operations, "stopCore")?;
                    core.lock().unwrap().stop()
                })()
            }
            "restartCore" => {
                set_job_state(&jobs, &id, "running", 1, 5, "正在重启核心");
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
                        set_job_state(&jobs, &id, "running", 1, 4, "正在应用订阅");
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
            _ => Err("Unsupported job kind".to_string()),
        };
        finish_job(&jobs, &id, result);
    });

    Ok(json!(record))
}

#[tauri::command]
fn job_status(state: State<AppState>, id: Option<String>) -> Result<JsonValue, String> {
    let mut jobs = state.jobs.lock().unwrap();
    let now = now_secs();
    jobs.retain(|_, job| {
        matches!(job.state.as_str(), "queued" | "running")
            || now.saturating_sub(job.updated_at) < 600
    });
    if let Some(id) = id {
        return jobs
            .get(&id)
            .cloned()
            .map(|job| json!(job))
            .ok_or_else(|| "Job not found".to_string());
    }
    let mut items = jobs.values().cloned().collect::<Vec<_>>();
    items.sort_by_key(|job| job.started_at);
    Ok(json!(items))
}

#[tauri::command]
fn cancel_job(state: State<AppState>, id: String) -> Result<JsonValue, String> {
    let mut jobs = state.jobs.lock().unwrap();
    let job = jobs
        .get_mut(&id)
        .ok_or_else(|| "Job not found".to_string())?;
    job.cancel_requested = true;
    if job.state == "queued" {
        job.state = "cancelled".to_string();
        job.message = "已取消".to_string();
        job.updated_at = now_secs();
    }
    if job.state == "running" {
        job.message = "cancel requested".to_string();
        job.updated_at = now_secs();
    }
    Ok(json!(job.clone()))
}

#[tauri::command]
fn app_status(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().status())
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
        ps_escape(exe.to_string_lossy()),
        ps_escape(cwd.to_string_lossy())
    ))?;
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        app.exit(0);
    });
    Ok(true)
}

#[tauri::command]
fn proxy_groups(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().proxy_groups())
}

#[tauri::command]
fn start_proxy_delay_test(state: State<AppState>) -> Result<JsonValue, String> {
    state.core.lock().unwrap().start_proxy_delay_test()
}

#[tauri::command]
fn test_single_proxy_delay(state: State<AppState>, name: String) -> Result<JsonValue, String> {
    state.core.lock().unwrap().test_single_proxy_delay(name)
}

#[tauri::command]
fn node_diagnostics(state: State<AppState>, name: String) -> Result<JsonValue, String> {
    state.core.lock().unwrap().node_diagnostics(name)
}

#[tauri::command]
fn speed_test_status(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().speed_test_snapshot())
}

#[tauri::command]
fn cancel_proxy_delay_test(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().cancel_proxy_delay_test())
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
fn test_proxy_delays(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().test_proxy_delays())
}

#[tauri::command]
fn refresh_outbound_ip(state: State<AppState>) -> Result<String, String> {
    refresh_outbound_ip_detached(state.core.clone())
}

#[tauri::command]
fn select_best_proxy(state: State<AppState>) -> Result<JsonValue, String> {
    let _operation = lock_operation_queue(&state.operations, "select_best_proxy command")?;
    state.core.lock().unwrap().select_best_proxy()
}

#[tauri::command]
fn connections(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().connections())
}

#[tauri::command]
fn active_connection_count(state: State<AppState>) -> Result<JsonValue, String> {
    Ok(state.core.lock().unwrap().active_connection_count())
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
    let logs = state.core.lock().unwrap().logs.clone();
    logs.lock().unwrap().clear();
    Ok(true)
}

#[tauri::command]
fn export_logs(state: State<AppState>) -> Result<JsonValue, String> {
    state.core.lock().unwrap().export_logs()
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
            app.manage(AppState {
                core: Arc::new(Mutex::new(core)),
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
            update_settings,
            relaunch_as_admin,
            proxy_groups,
            start_proxy_delay_test,
            test_single_proxy_delay,
            node_diagnostics,
            speed_test_status,
            cancel_proxy_delay_test,
            recover_network,
            test_proxy_delays,
            refresh_outbound_ip,
            select_best_proxy,
            connections,
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
