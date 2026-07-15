use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
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
pub const AEGOS_AUTO_SELECT_GROUP_NAME: &str = "閼奉亜濮╅柅澶嬪";
pub const LEGACY_AEGOS_AUTO_SELECT_GROUP_NAME: &str = "鑷姩閫夋嫨";
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
pub const RESERVED_MIXED_PORTS: &[u16] = &[7890];
pub const RESERVED_MIXED_PORTS_REASON: &str = "7890 is reserved for FlClash/Codex traffic";
pub const MIN_RUNTIME_PORT: u64 = 1024;
pub const MAX_RUNTIME_PORT: u64 = 65535;
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
pub const FIREWALL_DISCONNECT_PROTECTION_GROUP: &str = "Aegos Kill Switch";
pub const FIREWALL_SPEED_TEST_GROUP: &str = "Aegos Kill Switch Speed Test";
pub const FIREWALL_RULE_PREFIX_SUFFIX: &str = " Allow";
pub const FIREWALL_PROFILE_SNAPSHOT_FILE: &str = "kill-switch-firewall-profile.json";
pub const FIREWALL_SPEED_TEST_MARKER_FILE: &str = "kill-switch-speed-test-rules.marker";
pub const WINDOWS_PROXY_BYPASS_LIST: &str =
    "<local>;localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2*;172.30.*;172.31.*;192.168.*";
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

#[allow(clippy::too_many_arguments)]
pub fn status_surface_json(
    runtime_info: JsonValue,
    running: bool,
    traffic_takeover: bool,
    traffic: JsonValue,
    mode: &str,
    system_proxy: bool,
    mixed_port: u16,
    lan_ip: &str,
    outbound_ip: &str,
    is_admin: bool,
    active_profile: JsonValue,
    speed_test: JsonValue,
    settings: JsonValue,
    connection: JsonValue,
    protection: JsonValue,
    network_availability: JsonValue,
    logs: JsonValue,
) -> JsonValue {
    let mut status = json!({
        "product": "Aegos",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "shell": "tauri",
        "traffic": traffic,
        "mode": mode,
        "systemProxy": system_proxy,
        "activeProfile": active_profile,
        "network": {
            "lanIp": lan_ip,
            "proxyEndpoint": windows_proxy_server(mixed_port),
            "outboundIp": outbound_ip,
            "availability": network_availability
        },
        "permissions": {
            "isAdmin": is_admin,
            "requiresAdminFor": ["TUN", "Disconnect protection"]
        },
        "speedTest": speed_test,
        "settings": settings,
        "connection": connection,
        "protection": protection,
        "logs": logs
    });
    let runtime_status = runtime_status_json(runtime_info, running, traffic_takeover);
    if let (Some(status_map), Some(runtime_map)) =
        (status.as_object_mut(), runtime_status.as_object())
    {
        for (key, value) in runtime_map {
            status_map.insert(key.clone(), value.clone());
        }
    }
    status
}

pub fn network_availability_json(
    core_running: bool,
    traffic_takeover: bool,
    outbound_ip: &str,
    outbound_checked_at: u64,
    now_secs: u64,
) -> JsonValue {
    let has_outbound_ip = !outbound_ip.trim().is_empty() && outbound_ip != "-";
    let checked = outbound_checked_at > 0;
    let checking = core_running && traffic_takeover && !checked;
    let fresh = checked && now_secs.saturating_sub(outbound_checked_at) <= 600;
    let (state, label, detail, network_usable) = if !core_running {
        (
            "unverified",
            "未验证",
            "软件未运行，只能确认本机状态，不能代表代理网络可用。",
            false,
        )
    } else if !traffic_takeover {
        (
            "unverified",
            "未验证",
            "核心待命中，尚未接管系统流量。",
            false,
        )
    } else if has_outbound_ip && fresh {
        (
            "available",
            "可用",
            "已获取当前节点落地 IP，网络可用性已验证。",
            true,
        )
    } else if has_outbound_ip {
        (
            "stale",
            "需刷新",
            "落地 IP 是旧结果，建议刷新确认当前网络。",
            true,
        )
    } else if checking {
        (
            "checking",
            "检测中",
            "已接管流量，正在等待落地 IP 结果。",
            false,
        )
    } else if checked {
        (
            "unavailable",
            "不可用",
            "最近一次落地 IP 查询失败，网络可能不可用。",
            false,
        )
    } else {
        ("unverified", "未验证", "尚未进行网络可用性验证。", false)
    };
    json!({
        "state": state,
        "label": label,
        "detail": detail,
        "networkUsable": network_usable,
        "softwareReady": core_running,
        "trafficTakeover": traffic_takeover,
        "outboundIpKnown": has_outbound_ip,
        "checkedAt": outbound_checked_at
    })
}

pub fn idle_traffic_snapshot() -> JsonValue {
    json!({ "up": 0, "down": 0, "upTotal": 0, "downTotal": 0 })
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

pub fn core_start_result_json(
    message: Option<&str>,
    standby: bool,
    traffic_takeover: bool,
    connection: JsonValue,
) -> JsonValue {
    let mut result = json!({
        "ok": true,
        "standby": standby,
        "trafficTakeover": traffic_takeover,
        "connection": connection
    });
    if let Some(message) = message {
        if let Some(map) = result.as_object_mut() {
            map.insert("message".to_string(), json!(message));
        }
    }
    result
}

pub fn core_stop_result_json() -> JsonValue {
    json!({ "ok": true })
}

pub fn recovery_probe_result_json(
    ok: bool,
    url: &str,
    status: u16,
    reason: impl Into<String>,
) -> JsonValue {
    json!({
        "ok": ok,
        "url": url,
        "status": status,
        "reason": reason.into()
    })
}

pub fn recovery_switch_proxy_result_json(
    group: impl Into<String>,
    proxy: impl Into<String>,
    delay: i64,
    probe: JsonValue,
) -> JsonValue {
    json!({
        "action": "switchProxy",
        "group": group.into(),
        "proxy": proxy.into(),
        "delay": delay,
        "probe": probe
    })
}

pub fn recovery_healthy_result_json(
    failures: u64,
    probe: JsonValue,
    suggestions: JsonValue,
    settings: JsonValue,
) -> JsonValue {
    json!({
        "ok": true,
        "healthy": true,
        "action": "none",
        "failures": failures,
        "probe": probe,
        "suggestions": suggestions,
        "settings": settings
    })
}

pub fn recovery_observe_result_json(
    failures: u64,
    threshold: u64,
    probe: JsonValue,
    suggestions: JsonValue,
    settings: JsonValue,
) -> JsonValue {
    json!({
        "ok": false,
        "healthy": false,
        "action": "observe",
        "failures": failures,
        "threshold": threshold,
        "probe": probe,
        "suggestions": suggestions,
        "settings": settings
    })
}

pub fn recovery_proxy_switched_result_json(
    failures: u64,
    result: JsonValue,
    suggestions: JsonValue,
    settings: JsonValue,
) -> JsonValue {
    json!({
        "ok": true,
        "healthy": true,
        "profileChanged": false,
        "failures": failures,
        "result": result,
        "suggestions": suggestions,
        "settings": settings
    })
}

pub fn recovery_profile_switched_result_json(
    failures: u64,
    profile: JsonValue,
    result: JsonValue,
    suggestions: JsonValue,
    settings: JsonValue,
) -> JsonValue {
    json!({
        "ok": true,
        "healthy": true,
        "profileChanged": true,
        "failures": failures,
        "profile": profile,
        "result": result,
        "suggestions": suggestions,
        "settings": settings
    })
}

pub fn recovery_failed_result_json(
    failures: u64,
    probe: JsonValue,
    suggestions: JsonValue,
    settings: JsonValue,
) -> JsonValue {
    json!({
        "ok": false,
        "healthy": false,
        "action": "failed",
        "failures": failures,
        "probe": probe,
        "suggestions": suggestions,
        "settings": settings
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryCandidatePlan {
    pub group_name: String,
    pub proxy_name: String,
    pub protocol: String,
}

pub fn recovery_group_rank(name: &str) -> usize {
    match name {
        "GLOBAL" => 0,
        "Proxy" => 1,
        "Proxies" => 2,
        _ => 10,
    }
}

pub fn is_recovery_candidate_proxy_name(name: &str) -> bool {
    let text = name.trim();
    if text.is_empty() {
        return false;
    }
    let upper = text.to_ascii_uppercase();
    if matches!(
        upper.as_str(),
        "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE"
    ) {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    ![
        "traffic",
        "expire",
        "metadata",
        "subscription",
        "remaining",
        "鍓╀綑",
        "鍒版湡",
        "濂楅",
        "瀹樼綉",
        "娴侀噺",
        "杩囨湡",
        "\u{5269}\u{4f59}",
        "\u{5230}\u{671f}",
        "\u{5957}\u{9910}",
        "\u{5b98}\u{7f51}",
        "\u{6d41}\u{91cf}",
        "\u{8fc7}\u{671f}",
    ]
    .iter()
    .any(|needle| lower.contains(&needle.to_ascii_lowercase()))
}

fn is_recovery_group_reference_item(item: &JsonValue) -> bool {
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

pub fn recovery_candidate_plan(groups: &JsonValue, limit: usize) -> Vec<RecoveryCandidatePlan> {
    let Some(group_items) = groups.as_array() else {
        return Vec::new();
    };
    let mut group_refs = group_items.iter().collect::<Vec<_>>();
    group_refs.sort_by_key(|group| {
        group
            .get("name")
            .and_then(JsonValue::as_str)
            .map(recovery_group_rank)
            .unwrap_or(99)
    });
    let mut seen = HashSet::new();
    let mut plan = Vec::new();
    for group in group_refs {
        if plan.len() >= limit {
            break;
        }
        let group_name = group
            .get("name")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let current = group.get("now").and_then(JsonValue::as_str).unwrap_or("");
        let Some(items) = group.get("items").and_then(JsonValue::as_array) else {
            continue;
        };
        for item in items {
            if plan.len() >= limit {
                break;
            }
            if is_recovery_group_reference_item(item) {
                continue;
            }
            let Some(name) = item.get("name").and_then(JsonValue::as_str) else {
                continue;
            };
            if name == current || !is_recovery_candidate_proxy_name(name) {
                continue;
            }
            let key = format!("{group_name}\n{name}");
            if !seen.insert(key) {
                continue;
            }
            let protocol = item
                .get("type")
                .or_else(|| item.get("protocol"))
                .and_then(JsonValue::as_str)
                .unwrap_or("unknown")
                .to_string();
            plan.push(RecoveryCandidatePlan {
                group_name: group_name.clone(),
                proxy_name: name.to_string(),
                protocol,
            });
        }
    }
    plan
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryProfileFailoverPlan {
    pub id: String,
    pub name: String,
    pub profile_type: String,
}

pub fn recovery_profile_failover_plan(
    profiles: &JsonValue,
    active_profile_id: &str,
) -> Vec<RecoveryProfileFailoverPlan> {
    let Some(profile_items) = profiles.as_array() else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut plan = Vec::new();
    for profile in profile_items {
        let id = profile
            .get("id")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .trim();
        if id.is_empty() || id == active_profile_id || id == "direct" {
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }
        let profile_type = profile
            .get("type")
            .or_else(|| profile.get("profile_type"))
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .trim();
        if profile_type.eq_ignore_ascii_case("builtin") {
            continue;
        }
        let name = profile
            .get("name")
            .and_then(JsonValue::as_str)
            .unwrap_or(id)
            .trim();
        plan.push(RecoveryProfileFailoverPlan {
            id: id.to_string(),
            name: if name.is_empty() {
                id.to_string()
            } else {
                name.to_string()
            },
            profile_type: profile_type.to_string(),
        });
    }
    plan
}

pub fn protection_phase(
    core_running: bool,
    traffic_takeover: bool,
    disconnect_protection_enabled: bool,
    tun_enabled: bool,
    system_proxy_enabled: bool,
) -> (&'static str, &'static str) {
    if !core_running {
        return ("idle", "Not taken over");
    }
    if !traffic_takeover {
        return ("standby", "Core standby");
    }
    if disconnect_protection_enabled && tun_enabled {
        return ("strict", "Protected");
    }
    if disconnect_protection_enabled {
        return ("guarded", "Disconnect protected");
    }
    if tun_enabled {
        return ("tunnel", "TUN tunnel");
    }
    if system_proxy_enabled {
        return ("proxy", "System proxy");
    }
    ("partial", "Core only")
}

pub fn protection_status_json(
    core_running: bool,
    traffic_takeover: bool,
    disconnect_protection_enabled: bool,
    tun_enabled: bool,
    system_proxy_enabled: bool,
) -> JsonValue {
    let (level, label) = protection_phase(
        core_running,
        traffic_takeover,
        disconnect_protection_enabled,
        tun_enabled,
        system_proxy_enabled,
    );
    json!({ "level": level, "label": label })
}

pub fn proxy_takeover_status_json(
    mixed_port: u16,
    core_running: bool,
    traffic_takeover: bool,
    snapshot_captured: bool,
) -> JsonValue {
    json!({
        "endpoint": windows_proxy_server(mixed_port),
        "active": traffic_takeover,
        "standby": core_running && !traffic_takeover,
        "snapshotCaptured": snapshot_captured,
        "restoresPreviousProxy": true
    })
}

pub fn proxy_takeover_integrity_json(
    system_proxy_enabled: bool,
    traffic_takeover: bool,
    snapshot_captured: bool,
    current: Option<&SystemProxySnapshot>,
    read_error: Option<&str>,
    mixed_port: u16,
) -> JsonValue {
    let expected = windows_proxy_server(mixed_port);
    let current_server = current
        .map(|snapshot| snapshot.proxy_server.clone())
        .unwrap_or_else(|| "-".to_string());
    let current_points_to_aegos = current
        .map(|snapshot| system_proxy_snapshot_points_to_aegos(snapshot, mixed_port))
        .unwrap_or(false);

    let (ok, level, detail, action) = if !system_proxy_enabled {
        (
            true,
            "ok",
            "System proxy takeover is disabled.",
            "No action needed.",
        )
    } else if !traffic_takeover {
        (
            true,
            "info",
            "System proxy is enabled as a preference, but traffic is not connected yet.",
            "Click Connect when you want Aegos to apply Windows system proxy takeover.",
        )
    } else if current_points_to_aegos && snapshot_captured {
        (
            true,
            "ok",
            "Windows system proxy points to Aegos and a restore snapshot is available.",
            "No action needed.",
        )
    } else if current_points_to_aegos {
        (
            false,
            "warning",
            "Windows system proxy points to Aegos, but no restore snapshot is available.",
            "Disconnect or use repair takeover before closing Aegos.",
        )
    } else if let Some(error) = read_error {
        (
            false,
            "warning",
            error,
            "Open Diagnostics or use repair takeover; if this repeats, restart Aegos as administrator.",
        )
    } else {
        (
            false,
            "error",
            "Windows system proxy does not point to the Aegos endpoint.",
            "Use repair takeover or disconnect/reconnect Aegos.",
        )
    };

    json!({
        "ok": ok,
        "level": level,
        "expectedEndpoint": expected,
        "currentServer": current_server,
        "snapshotCaptured": snapshot_captured,
        "detail": if read_error.is_some() { format!("read failed: {detail}") } else { format!("{detail} current={current_server}, expected={expected}") },
        "action": action
    })
}

pub fn system_proxy_repair_result_json(
    mixed_port: u16,
    current: &SystemProxySnapshot,
) -> JsonValue {
    json!({
        "ok": true,
        "endpoint": windows_proxy_server(mixed_port),
        "current": current
    })
}

pub fn runtime_config_unchanged_result_json(digest: impl Into<String>) -> JsonValue {
    json!({
        "ok": true,
        "skipped": true,
        "reason": "unchanged runtime config digest",
        "digest": digest.into()
    })
}

#[allow(clippy::too_many_arguments)]
pub fn public_settings_surface_json(
    active_profile_id: &str,
    mixed_port: u16,
    controller_port: u16,
    profiles: JsonValue,
    start_with_system_proxy: bool,
    system_proxy: bool,
    kill_switch_enabled: bool,
    tun_enabled: bool,
    tun_stack: &str,
    dns_hijack_enabled: bool,
    ipv6_enabled: bool,
    allow_lan: bool,
    log_level: &str,
    selected_proxy_map: JsonValue,
    manual_nodes: JsonValue,
    reliability_auto: bool,
    reliability_profile_failover: bool,
    reliability_failure_threshold: u64,
    reliability_max_delay_ms: u64,
    reliability_candidate_limit: u64,
    reliability_failures: u64,
    core_exists: bool,
    core_running: bool,
    traffic_takeover: bool,
    proxy_snapshot_captured: bool,
) -> JsonValue {
    json!({
        "activeProfileId": active_profile_id,
        "mixedPort": mixed_port,
        "controllerPort": controller_port,
        "profiles": profiles,
        "startWithSystemProxy": start_with_system_proxy,
        "systemProxy": system_proxy,
        "killSwitchEnabled": kill_switch_enabled,
        "tunEnabled": tun_enabled,
        "tunStack": tun_stack,
        "dnsHijackEnabled": dns_hijack_enabled,
        "ipv6Enabled": ipv6_enabled,
        "allowLan": allow_lan,
        "logLevel": log_level,
        "selectedProxyMap": selected_proxy_map,
        "manualNodes": manual_nodes,
        "reliability": {
            "auto": reliability_auto,
            "profileFailover": reliability_profile_failover,
            "failureThreshold": reliability_failure_threshold,
            "maxDelayMs": reliability_max_delay_ms,
            "candidateLimit": reliability_candidate_limit,
            "failures": reliability_failures
        },
        "runtimes": { "mihomo": core_exists },
        "reservedPorts": {
            "mixed": RESERVED_MIXED_PORTS,
            "reason": RESERVED_MIXED_PORTS_REASON
        },
        "proxyTakeover": proxy_takeover_status_json(
            mixed_port,
            core_running,
            traffic_takeover,
            proxy_snapshot_captured,
        )
    })
}

pub fn port_from_value(value: &JsonValue, fallback: u16, label: &str) -> Result<u16, String> {
    let port = value.as_u64().unwrap_or(u64::from(fallback));
    if !(MIN_RUNTIME_PORT..=MAX_RUNTIME_PORT).contains(&port) {
        return Err(format!(
            "{label} must be between {MIN_RUNTIME_PORT} and {MAX_RUNTIME_PORT}"
        ));
    }
    Ok(port as u16)
}

pub fn mixed_port_from_value(value: &JsonValue, fallback: u16) -> Result<u16, String> {
    let port = port_from_value(value, fallback, "Mixed proxy port")?;
    if RESERVED_MIXED_PORTS.contains(&port) {
        return Err(format!(
            "{RESERVED_MIXED_PORTS_REASON}; use 7891 or another port for Aegos."
        ));
    }
    Ok(port)
}

pub fn validate_runtime_ports(mixed_port: u16, controller_port: u16) -> Result<(), String> {
    if RESERVED_MIXED_PORTS.contains(&mixed_port) {
        return Err(format!(
            "Mixed proxy port 7890 is reserved for FlClash/Codex; use 7891 or another free port"
        ));
    }
    if mixed_port == controller_port {
        return Err(format!(
            "Mixed proxy port {mixed_port} cannot equal controller port {controller_port}"
        ));
    }
    Ok(())
}

pub fn diagnostic_check_json(
    name: &str,
    ok: bool,
    detail: impl Into<String>,
    severity: &str,
    category: &str,
    hint: &str,
) -> JsonValue {
    json!({
        "name": name,
        "ok": ok,
        "detail": detail.into(),
        "severity": if ok { "ok" } else { severity },
        "category": category,
        "hint": if ok { "" } else { hint },
        "actionable": !ok && !hint.is_empty()
    })
}

pub fn diagnostic_summary_json(checks: &[JsonValue]) -> JsonValue {
    let failed = checks
        .iter()
        .filter(|item| !item.get("ok").and_then(JsonValue::as_bool).unwrap_or(false))
        .count();
    let errors = checks
        .iter()
        .filter(|item| item.get("severity").and_then(JsonValue::as_str) == Some("error"))
        .count();
    let warnings = checks
        .iter()
        .filter(|item| item.get("severity").and_then(JsonValue::as_str) == Some("warning"))
        .count();
    let next_actions = checks
        .iter()
        .filter(|item| {
            !item.get("ok").and_then(JsonValue::as_bool).unwrap_or(false)
                && item
                    .get("actionable")
                    .and_then(JsonValue::as_bool)
                    .unwrap_or(false)
        })
        .filter_map(|item| {
            item.get("hint")
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        })
        .take(3)
        .collect::<Vec<_>>();
    json!({
        "total": checks.len(),
        "failed": failed,
        "errors": errors,
        "warnings": warnings,
        "nextActions": next_actions
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

    pub fn status_traffic_snapshot_or_idle(
        &self,
        running: bool,
        last_traffic: &JsonValue,
    ) -> JsonValue {
        if !running {
            return idle_traffic_snapshot();
        }
        self.status_traffic_snapshot()
            .unwrap_or_else(|_| last_traffic.clone())
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

    pub fn ui_proxy_groups_snapshot_or_else<F>(
        &self,
        running: bool,
        hidden_group_names: &[&str],
        fallback: F,
    ) -> JsonValue
    where
        F: FnOnce() -> JsonValue,
    {
        self.ui_proxy_groups_snapshot_or_none(running, hidden_group_names)
            .unwrap_or_else(fallback)
    }

    pub fn version_probe(&self, timeout_ms: u64) -> Result<JsonValue, String> {
        self.request("GET", "/version", None, timeout_ms)
    }

    pub fn runtime_reuse_ready(&self) -> bool {
        self.version_probe(READY_REUSE_PROBE_TIMEOUT_MS).is_ok()
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

    pub fn apply_mode_if_running(
        &self,
        running: bool,
        mode: &str,
    ) -> Option<Result<JsonValue, String>> {
        if running {
            Some(self.apply_mode(mode))
        } else {
            None
        }
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

    pub fn apply_proxy_selection_with_cleanup(
        &self,
        group: &str,
        proxy: &str,
    ) -> Result<(), String> {
        self.apply_proxy_selection(group, proxy)?;
        self.cleanup_stale_connections_after_selection();
        Ok(())
    }

    pub fn apply_auxiliary_proxy_selection(&self, group: &str, proxy: &str) -> Result<(), String> {
        self.select_proxy(group, proxy, AUXILIARY_PROXY_SELECT_TIMEOUT_MS)
    }

    pub fn apply_auxiliary_proxy_selection_if_running(
        &self,
        running: bool,
        group: &str,
        proxy: &str,
    ) -> Option<Result<(), String>> {
        if running {
            Some(self.apply_auxiliary_proxy_selection(group, proxy))
        } else {
            None
        }
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

pub fn classify_failure_reason(reason: &str) -> &'static str {
    let text = reason.to_ascii_lowercase();
    if text.contains("198.18.")
        || text.contains("198.19.")
        || text.contains("fake-ip")
        || text.contains("fake ip")
    {
        "dns-fake-ip"
    } else if text.contains("firewall")
        || text.contains("blocked by protection")
        || text.contains("disconnect protection")
        || text.contains("kill switch")
    {
        "protection-blocked"
    } else if text.contains("blocked") || text.contains("reject") || text.contains("denied by rule")
    {
        "blocked"
    } else if (text.contains("connect") || text.contains("dial"))
        && (text.contains("no route to host")
            || text.contains("network unreachable")
            || text.contains("host unreachable"))
    {
        "node-connect"
    } else if text.contains("no route to host")
        || text.contains("network unreachable")
        || text.contains("host unreachable")
    {
        "unreachable"
    } else if text.contains("timeout") || text.contains("timed out") || text.contains("i/o timeout")
    {
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
    } else if text.contains("port") && (text.contains("in use") || text.contains("conflict")) {
        "port-conflict"
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
    } else if text.contains("yaml") || text.contains("config") || text.contains("preflight") {
        "config"
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

pub fn classified_error(context: &str, reason: impl AsRef<str>) -> String {
    let reason = reason.as_ref();
    format!(
        "{context} failed [{}]: {reason}",
        classify_failure_reason(reason)
    )
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

pub fn is_proxies_group_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("Proxies") || name.eq_ignore_ascii_case("Proxy")
}

pub fn is_aegos_auto_select_group_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("Aegos Auto Select")
        || name.eq_ignore_ascii_case("Auto Select")
        || name == AEGOS_AUTO_SELECT_GROUP_NAME
        || name == LEGACY_AEGOS_AUTO_SELECT_GROUP_NAME
}

pub fn normalize_proxy_groups_snapshot_defaults(groups: &mut JsonValue) {
    let Some(group_items) = groups.as_array_mut() else {
        return;
    };
    if group_items.is_empty() {
        return;
    }
    let all_items = all_real_snapshot_items(group_items);
    if all_items.is_empty() {
        return;
    }
    let first_name = all_items
        .first()
        .and_then(snapshot_proxy_item_name)
        .unwrap_or("")
        .to_string();
    let has_proxies = group_items.iter().any(|group| {
        group
            .get("name")
            .and_then(JsonValue::as_str)
            .map(is_proxies_group_name)
            .unwrap_or(false)
    });
    if !has_proxies {
        group_items.insert(
            0,
            json!({
                "name": "Proxies",
                "type": "Selector",
                "now": first_name,
                "items": all_items.clone()
            }),
        );
    }
    let has_auto = group_items.iter().any(|group| {
        group
            .get("name")
            .and_then(JsonValue::as_str)
            .map(is_aegos_auto_select_group_name)
            .unwrap_or(false)
    });
    if !has_auto && all_items.len() >= 2 {
        let insert_index = group_items
            .iter()
            .position(|group| {
                group
                    .get("name")
                    .and_then(JsonValue::as_str)
                    .map(is_proxies_group_name)
                    .unwrap_or(false)
            })
            .map(|index| index.saturating_add(1))
            .unwrap_or(0);
        group_items.insert(
            insert_index,
            json!({
                "name": AEGOS_AUTO_SELECT_GROUP_NAME,
                "type": "URLTest",
                "now": first_name,
                "items": all_items
            }),
        );
    }
}

pub fn apply_group_resolution_with_selected_map(
    groups: &mut JsonValue,
    selected_map: &HashMap<String, String>,
) {
    let Some(snapshot) = groups.as_array().cloned() else {
        return;
    };
    let group_names = snapshot_group_names(&snapshot);
    let Some(group_items) = groups.as_array_mut() else {
        return;
    };
    for group in group_items {
        let group_name = group
            .get("name")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let selected = selected_map
            .get(&group_name)
            .cloned()
            .unwrap_or_else(|| group_selected_name(group, selected_map));
        if !selected.is_empty() {
            if let Some(map) = group.as_object_mut() {
                map.insert("now".to_string(), json!(selected));
            }
        }
        if let Some(items) = group.get_mut("items").and_then(JsonValue::as_array_mut) {
            for item in items {
                let Some(name) = item
                    .get("name")
                    .and_then(JsonValue::as_str)
                    .map(str::to_string)
                else {
                    continue;
                };
                if !group_names.contains(&name) {
                    continue;
                }
                let leaf = resolve_group_leaf(&snapshot, selected_map, &name, 0);
                if let Some(map) = item.as_object_mut() {
                    map.insert("group".to_string(), json!(true));
                    map.insert("type".to_string(), json!("Group"));
                    map.insert("realProxyName".to_string(), json!(leaf));
                }
            }
        }
    }
}

pub fn annotate_manual_groups_with_names(groups: &mut JsonValue, names: &HashSet<String>) {
    if names.is_empty() {
        return;
    }
    let Some(groups) = groups.as_array_mut() else {
        return;
    };
    for group in groups {
        let Some(items) = group.get_mut("items").and_then(JsonValue::as_array_mut) else {
            continue;
        };
        for item in items {
            let Some(name) = item.get("name").and_then(JsonValue::as_str) else {
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

fn snapshot_proxy_item_name(item: &JsonValue) -> Option<&str> {
    item.get("realProxyName")
        .or_else(|| item.get("name"))
        .and_then(JsonValue::as_str)
        .filter(|name| !name.trim().is_empty())
}

fn snapshot_group_names(groups: &[JsonValue]) -> HashSet<String> {
    groups
        .iter()
        .filter_map(|group| group.get("name").and_then(JsonValue::as_str))
        .map(str::to_string)
        .collect()
}

fn is_builtin_snapshot_proxy_item(item: &JsonValue) -> bool {
    let name = item
        .get("name")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_ascii_uppercase();
    let item_type = item
        .get("type")
        .or_else(|| item.get("protocol"))
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_ascii_uppercase();
    item.get("builtin")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false)
        || matches!(
            name.as_str(),
            "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE"
        )
        || matches!(
            item_type.as_str(),
            "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE"
        )
}

fn collect_real_snapshot_items(
    groups: &[JsonValue],
    group: &JsonValue,
    group_names: &HashSet<String>,
    seen_groups: &mut HashSet<String>,
    seen_nodes: &mut HashSet<String>,
    out: &mut Vec<JsonValue>,
) {
    let group_name = group
        .get("name")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    if !group_name.is_empty() && !seen_groups.insert(group_name) {
        return;
    }
    let Some(items) = group.get("items").and_then(JsonValue::as_array) else {
        return;
    };
    for item in items {
        let name = snapshot_proxy_item_name(item).unwrap_or("");
        if group_names.contains(name) {
            if let Some(next_group) = groups
                .iter()
                .find(|group| group.get("name").and_then(JsonValue::as_str) == Some(name))
            {
                collect_real_snapshot_items(
                    groups,
                    next_group,
                    group_names,
                    seen_groups,
                    seen_nodes,
                    out,
                );
            }
            continue;
        }
        if name.is_empty() || is_builtin_snapshot_proxy_item(item) {
            continue;
        }
        if seen_nodes.insert(name.to_string()) {
            out.push(item.clone());
        }
    }
}

fn all_real_snapshot_items(groups: &[JsonValue]) -> Vec<JsonValue> {
    let group_names = snapshot_group_names(groups);
    let mut seen_groups = HashSet::new();
    let mut seen_nodes = HashSet::new();
    let mut out = Vec::new();
    for group in groups {
        collect_real_snapshot_items(
            groups,
            group,
            &group_names,
            &mut seen_groups,
            &mut seen_nodes,
            &mut out,
        );
    }
    out
}

fn group_selected_name(group: &JsonValue, selected_map: &HashMap<String, String>) -> String {
    let group_name = group.get("name").and_then(JsonValue::as_str).unwrap_or("");
    selected_map
        .get(group_name)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .or_else(|| {
            group
                .get("now")
                .and_then(JsonValue::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

pub fn resolve_group_leaf(
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
        .find(|group| group.get("name").and_then(JsonValue::as_str) == Some(name))
    else {
        return name.to_string();
    };
    let selected = group_selected_name(group, selected_map);
    if selected.is_empty() || selected == name {
        return name.to_string();
    }
    resolve_group_leaf(groups, selected_map, &selected, depth + 1)
}

pub fn canonical_strategy_type(value: &str) -> String {
    match value
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace() && *ch != '-' && *ch != '_')
        .collect::<String>()
        .to_ascii_lowercase()
        .as_str()
    {
        "urltest" => "url-test".to_string(),
        "loadbalance" => "load-balance".to_string(),
        "fallback" => "fallback".to_string(),
        "select" => "select".to_string(),
        _ => value.to_string(),
    }
}

pub fn routing_group_rows(groups: &JsonValue, internal_group_names: &[&str]) -> JsonValue {
    json!(groups
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|group| {
            group
                .get("name")
                .and_then(JsonValue::as_str)
                .map(|name| !is_internal_routing_group_name(name, internal_group_names))
                .unwrap_or(true)
        })
        .map(|group| {
            let group_type_raw = group
                .get("type")
                .and_then(JsonValue::as_str)
                .unwrap_or("select");
            let group_type = canonical_strategy_type(group_type_raw);
            let item_count = group
                .get("items")
                .and_then(JsonValue::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            let name = group
                .get("name")
                .and_then(JsonValue::as_str)
                .unwrap_or("-");
            json!({
                "name": name,
                "type": group_type,
                "now": group.get("now").and_then(JsonValue::as_str).unwrap_or("-"),
                "items": group.get("items").cloned().unwrap_or_else(|| json!([])),
                "itemCount": item_count,
                "automatic": matches!(group_type.as_str(), "url-test" | "fallback" | "load-balance"),
                "editable": !is_internal_routing_group_name(name, internal_group_names)
            })
        })
        .collect::<Vec<_>>())
}

pub fn routing_group_counts(group_rows: &JsonValue) -> (usize, usize) {
    let Some(rows) = group_rows.as_array() else {
        return (0, 0);
    };
    let auto_count = rows
        .iter()
        .filter(|item| {
            item.get("automatic")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false)
        })
        .count();
    (rows.len(), auto_count)
}

fn is_internal_routing_group_name(name: &str, internal_group_names: &[&str]) -> bool {
    internal_group_names
        .iter()
        .any(|internal| name.eq_ignore_ascii_case(internal))
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

#[derive(Clone, Debug)]
pub struct CoreStartFailureContext {
    pub core_path: PathBuf,
    pub profile_name: Option<String>,
    pub profile_path: Option<String>,
    pub mixed_port: u16,
    pub controller_port: u16,
    pub recent_logs: String,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum CoreRuntimeStartAction {
    LaunchFresh,
    ReuseRunning,
    RestartForDrift,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum CoreRuntimeRestartAction {
    StartWithTakeover,
    StartStandby,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct CoreRuntimeRestartPlan {
    pub restore_system_proxy: bool,
    pub restore_takeover: bool,
    pub delay_ms: u64,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct CoreTrafficTakeoverPlan {
    pub requested_takeover: bool,
    pub tun_enabled: bool,
    pub should_apply_system_proxy: bool,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
pub struct SystemProxySnapshot {
    pub proxy_enable: bool,
    pub proxy_server: String,
    pub proxy_override: String,
    pub captured_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoreFirewallPolicyPlan {
    pub group_name: &'static str,
    pub rule_prefix: String,
    pub state_file_name: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoreSystemProxyTakeoverPlan {
    pub enable: bool,
    pub proxy_enable_value: u8,
    pub proxy_server: Option<String>,
    pub proxy_override: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WindowsSystemProxyScriptPlan {
    pub proxy_enable_value: u8,
    pub proxy_server_literal: Option<String>,
    pub proxy_override_literal: String,
    pub write_proxy_server: bool,
}

impl WindowsSystemProxyScriptPlan {
    pub fn should_write_proxy_server(&self) -> bool {
        self.write_proxy_server
    }
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

pub fn runtime_identity_matches(
    runtime_profile_id: Option<&str>,
    requested_profile_id: &str,
    runtime_config_digest: Option<&str>,
    requested_config_digest: &str,
) -> bool {
    runtime_profile_id == Some(requested_profile_id)
        && runtime_config_digest == Some(requested_config_digest)
}

pub fn decide_runtime_start(
    process_running: bool,
    identity_matches: bool,
    controller_ready: bool,
) -> CoreRuntimeStartAction {
    if !process_running {
        return CoreRuntimeStartAction::LaunchFresh;
    }
    if identity_matches && controller_ready {
        CoreRuntimeStartAction::ReuseRunning
    } else {
        CoreRuntimeStartAction::RestartForDrift
    }
}

impl CoreRuntimeRestartPlan {
    pub fn for_runtime_drift(
        system_proxy_enabled: bool,
        traffic_takeover: bool,
        requested_takeover: bool,
    ) -> Self {
        Self {
            restore_system_proxy: system_proxy_enabled,
            restore_takeover: traffic_takeover && requested_takeover,
            delay_ms: RUNTIME_RESTART_SETTLE_MS,
        }
    }

    pub fn preserving_proxy(
        system_proxy_enabled: bool,
        traffic_takeover: bool,
        delay_ms: u64,
    ) -> Self {
        Self {
            restore_system_proxy: system_proxy_enabled,
            restore_takeover: traffic_takeover,
            delay_ms,
        }
    }

    pub fn should_restore_proxy_preference(&self) -> bool {
        self.restore_takeover
    }

    pub fn next_action(&self) -> CoreRuntimeRestartAction {
        if self.restore_takeover {
            CoreRuntimeRestartAction::StartWithTakeover
        } else {
            CoreRuntimeRestartAction::StartStandby
        }
    }
}

impl CoreTrafficTakeoverPlan {
    pub fn after_core_ready(
        requested_takeover: bool,
        system_proxy_enabled: bool,
        start_with_system_proxy: bool,
        tun_enabled: bool,
    ) -> Self {
        Self {
            requested_takeover,
            tun_enabled,
            should_apply_system_proxy: requested_takeover
                && (system_proxy_enabled || start_with_system_proxy || !tun_enabled),
        }
    }

    pub fn optimistic_takeover_before_system_proxy(&self) -> bool {
        self.requested_takeover && self.should_apply_system_proxy
    }

    pub fn final_traffic_takeover(&self, system_proxy_applied: bool) -> bool {
        self.requested_takeover && (self.tun_enabled || system_proxy_applied)
    }
}

pub fn system_proxy_snapshot_points_to_aegos(
    snapshot: &SystemProxySnapshot,
    mixed_port: u16,
) -> bool {
    snapshot.proxy_enable
        && snapshot.proxy_server.split(';').any(|item| {
            item.trim()
                .eq_ignore_ascii_case(&format!("127.0.0.1:{mixed_port}"))
        })
}

pub fn should_capture_system_proxy_snapshot(
    snapshot_file_exists: bool,
    snapshot: &SystemProxySnapshot,
    mixed_port: u16,
) -> bool {
    !snapshot_file_exists && !system_proxy_snapshot_points_to_aegos(snapshot, mixed_port)
}

pub fn verify_system_proxy_snapshot(
    snapshot: &SystemProxySnapshot,
    expected_to_point_to_aegos: bool,
    mixed_port: u16,
) -> Result<(), String> {
    let points_to_aegos = system_proxy_snapshot_points_to_aegos(snapshot, mixed_port);
    if expected_to_point_to_aegos && !points_to_aegos {
        return Err(format!(
            "Windows system proxy verification failed: current '{}', expected {}",
            snapshot.proxy_server,
            windows_proxy_server(mixed_port)
        ));
    }
    if !expected_to_point_to_aegos && points_to_aegos {
        return Err(format!(
            "Windows system proxy restore verification failed: still points to '{}'",
            snapshot.proxy_server
        ));
    }
    Ok(())
}

impl CoreFirewallPolicyPlan {
    pub fn disconnect_protection() -> Self {
        Self {
            group_name: FIREWALL_DISCONNECT_PROTECTION_GROUP,
            rule_prefix: format!(
                "{FIREWALL_DISCONNECT_PROTECTION_GROUP}{FIREWALL_RULE_PREFIX_SUFFIX}"
            ),
            state_file_name: FIREWALL_PROFILE_SNAPSHOT_FILE,
        }
    }

    pub fn speed_test() -> Self {
        Self {
            group_name: FIREWALL_SPEED_TEST_GROUP,
            rule_prefix: format!("{FIREWALL_SPEED_TEST_GROUP}{FIREWALL_RULE_PREFIX_SUFFIX}"),
            state_file_name: FIREWALL_SPEED_TEST_MARKER_FILE,
        }
    }

    pub fn state_path(&self, user_data: &Path) -> PathBuf {
        user_data.join(self.state_file_name)
    }
}

pub fn powershell_single_quote_escape(value: impl AsRef<str>) -> String {
    value.as_ref().replace('\'', "''")
}

pub fn powershell_single_quoted_literal(value: impl AsRef<str>) -> String {
    format!("'{}'", powershell_single_quote_escape(value))
}

pub fn powershell_string_array_literal(items: &[String]) -> String {
    let quoted = items
        .iter()
        .map(powershell_single_quoted_literal)
        .collect::<Vec<_>>()
        .join(", ");
    format!("@({quoted})")
}

pub fn normalize_windows_program_path_text(path: &str) -> String {
    let mut text = path.replace('/', "\\");
    if text.starts_with("\\\\?\\UNC\\") {
        text = format!("\\\\{}", &text[8..]);
    } else if text.starts_with("\\\\?\\") {
        text = text[4..].to_string();
    }
    text
}

pub fn firewall_program_path(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let normalized = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Some(normalize_windows_program_path_text(
        &normalized.to_string_lossy(),
    ))
}

pub fn firewall_program_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .filter_map(|path| firewall_program_path(&path))
        .collect()
}

pub fn speed_test_firewall_enabled(disconnect_protection_enabled: bool) -> bool {
    disconnect_protection_enabled
}

pub fn speed_test_firewall_ports(disconnect_protection_enabled: bool, ports: &[u16]) -> Vec<u16> {
    if disconnect_protection_enabled {
        ports.to_vec()
    } else {
        Vec::new()
    }
}

pub fn firewall_remote_port_list(ports: &[u16]) -> String {
    ports
        .iter()
        .map(|port| port.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

pub fn windows_proxy_server(mixed_port: u16) -> String {
    format!("127.0.0.1:{mixed_port}")
}

pub fn windows_proxy_snapshot_script_plan(
    snapshot: &SystemProxySnapshot,
) -> WindowsSystemProxyScriptPlan {
    WindowsSystemProxyScriptPlan {
        proxy_enable_value: u8::from(snapshot.proxy_enable),
        proxy_server_literal: Some(powershell_single_quoted_literal(&snapshot.proxy_server)),
        proxy_override_literal: powershell_single_quoted_literal(&snapshot.proxy_override),
        write_proxy_server: true,
    }
}

pub fn windows_proxy_takeover_script_plan(
    enable: bool,
    mixed_port: u16,
) -> WindowsSystemProxyScriptPlan {
    let plan = CoreSystemProxyTakeoverPlan::new(enable, mixed_port);
    WindowsSystemProxyScriptPlan {
        proxy_enable_value: plan.proxy_enable_value,
        proxy_server_literal: plan
            .proxy_server
            .as_ref()
            .map(powershell_single_quoted_literal),
        proxy_override_literal: powershell_single_quoted_literal(plan.proxy_override),
        write_proxy_server: plan.should_write_proxy_server(),
    }
}

impl CoreSystemProxyTakeoverPlan {
    pub fn new(enable: bool, mixed_port: u16) -> Self {
        Self {
            enable,
            proxy_enable_value: if enable { 1 } else { 0 },
            proxy_server: enable.then(|| windows_proxy_server(mixed_port)),
            proxy_override: WINDOWS_PROXY_BYPASS_LIST,
        }
    }

    pub fn should_write_proxy_server(&self) -> bool {
        self.proxy_server.is_some()
    }
}

impl CoreStartFailureContext {
    pub fn new(
        core_path: PathBuf,
        profile_name: Option<String>,
        profile_path: Option<String>,
        mixed_port: u16,
        controller_port: u16,
        recent_logs: String,
    ) -> Self {
        Self {
            core_path,
            profile_name,
            profile_path,
            mixed_port,
            controller_port,
            recent_logs,
        }
    }

    pub fn message(&self, reason: &str) -> String {
        format!(
            "Core startup failed: {reason}; profile: {}; config: {}; core: {}; ports: mixed {} / controller {}; recent logs: {}",
            self.profile_name.as_deref().unwrap_or("no active profile"),
            self.profile_path.as_deref().unwrap_or("-"),
            self.core_path.display(),
            self.mixed_port,
            self.controller_port,
            self.recent_logs
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
        let start_failure = CoreStartFailureContext::new(
            core_path.clone(),
            Some("Profile A".to_string()),
            Some(r"C:\Users\Aegos\profile.yaml".to_string()),
            7897,
            19097,
            "[core] last line".to_string(),
        )
        .message("controller timeout");
        assert!(start_failure.contains("Core startup failed: controller timeout"));
        assert!(start_failure.contains("profile: Profile A"));
        assert!(start_failure.contains("ports: mixed 7897 / controller 19097"));
        assert!(start_failure.contains("recent logs: [core] last line"));
        assert!(CoreStartFailureContext::new(
            core_path,
            None,
            None,
            7897,
            19097,
            "No recent logs.".to_string(),
        )
        .message("missing profile")
        .contains("profile: no active profile"));
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

    #[test]
    fn runtime_start_reuse_decision_is_owned_by_runtime_boundary() {
        assert!(runtime_identity_matches(
            Some("profile-a"),
            "profile-a",
            Some("digest-a"),
            "digest-a"
        ));
        assert!(!runtime_identity_matches(
            Some("profile-a"),
            "profile-b",
            Some("digest-a"),
            "digest-a"
        ));
        assert!(!runtime_identity_matches(
            Some("profile-a"),
            "profile-a",
            Some("digest-a"),
            "digest-b"
        ));
        assert_eq!(
            decide_runtime_start(false, false, false),
            CoreRuntimeStartAction::LaunchFresh
        );
        assert_eq!(
            decide_runtime_start(true, true, true),
            CoreRuntimeStartAction::ReuseRunning
        );
        assert_eq!(
            decide_runtime_start(true, true, false),
            CoreRuntimeStartAction::RestartForDrift
        );
        assert_eq!(
            decide_runtime_start(true, false, false),
            CoreRuntimeStartAction::RestartForDrift
        );
    }

    #[test]
    fn runtime_restart_plan_preserves_takeover_intent_inside_runtime_boundary() {
        let drift = CoreRuntimeRestartPlan::for_runtime_drift(true, true, true);
        assert_eq!(drift.restore_system_proxy, true);
        assert_eq!(drift.restore_takeover, true);
        assert_eq!(drift.delay_ms, RUNTIME_RESTART_SETTLE_MS);
        assert!(drift.should_restore_proxy_preference());
        assert_eq!(
            drift.next_action(),
            CoreRuntimeRestartAction::StartWithTakeover
        );

        let standby_drift = CoreRuntimeRestartPlan::for_runtime_drift(true, true, false);
        assert_eq!(standby_drift.restore_takeover, false);
        assert!(!standby_drift.should_restore_proxy_preference());
        assert_eq!(
            standby_drift.next_action(),
            CoreRuntimeRestartAction::StartStandby
        );

        let manual_restart = CoreRuntimeRestartPlan::preserving_proxy(false, true, 350);
        assert_eq!(manual_restart.restore_system_proxy, false);
        assert_eq!(manual_restart.restore_takeover, true);
        assert_eq!(manual_restart.delay_ms, 350);
        assert_eq!(
            manual_restart.next_action(),
            CoreRuntimeRestartAction::StartWithTakeover
        );

        let standby_mutation = CoreRuntimeRestartPlan::preserving_proxy(true, false, 250);
        assert_eq!(
            standby_mutation.next_action(),
            CoreRuntimeRestartAction::StartStandby
        );
        assert!(!standby_mutation.should_restore_proxy_preference());
    }

    #[test]
    fn traffic_takeover_after_ready_is_owned_by_runtime_boundary() {
        let standby = CoreTrafficTakeoverPlan::after_core_ready(false, true, true, true);
        assert!(!standby.should_apply_system_proxy);
        assert!(!standby.optimistic_takeover_before_system_proxy());
        assert!(!standby.final_traffic_takeover(true));

        let tun_takeover = CoreTrafficTakeoverPlan::after_core_ready(true, false, false, true);
        assert!(!tun_takeover.should_apply_system_proxy);
        assert!(!tun_takeover.optimistic_takeover_before_system_proxy());
        assert!(tun_takeover.final_traffic_takeover(false));

        let system_proxy_takeover =
            CoreTrafficTakeoverPlan::after_core_ready(true, true, false, false);
        assert!(system_proxy_takeover.should_apply_system_proxy);
        assert!(system_proxy_takeover.optimistic_takeover_before_system_proxy());
        assert!(system_proxy_takeover.final_traffic_takeover(true));
        assert!(!system_proxy_takeover.final_traffic_takeover(false));

        let tun_off_requires_system_proxy =
            CoreTrafficTakeoverPlan::after_core_ready(true, false, false, false);
        assert!(tun_off_requires_system_proxy.should_apply_system_proxy);
        assert!(tun_off_requires_system_proxy.optimistic_takeover_before_system_proxy());
        assert!(!tun_off_requires_system_proxy.final_traffic_takeover(false));
    }

    #[test]
    fn system_proxy_snapshot_policy_is_owned_by_runtime_boundary() {
        let external = SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "127.0.0.1:7890;https=proxy.example:443".to_string(),
            proxy_override: "<local>".to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };
        assert!(!system_proxy_snapshot_points_to_aegos(&external, 7891));
        assert!(should_capture_system_proxy_snapshot(false, &external, 7891));
        assert!(!should_capture_system_proxy_snapshot(true, &external, 7891));

        let aegos = SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "http=127.0.0.1:7890;127.0.0.1:7891".to_string(),
            proxy_override: "<local>".to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };
        assert!(system_proxy_snapshot_points_to_aegos(&aegos, 7891));
        assert!(!should_capture_system_proxy_snapshot(false, &aegos, 7891));

        let disabled = SystemProxySnapshot {
            proxy_enable: false,
            proxy_server: "127.0.0.1:7891".to_string(),
            proxy_override: String::new(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };
        assert!(!system_proxy_snapshot_points_to_aegos(&disabled, 7891));
        assert!(should_capture_system_proxy_snapshot(false, &disabled, 7891));
    }

    #[test]
    fn firewall_policy_contract_is_owned_by_runtime_boundary() {
        let disconnect = CoreFirewallPolicyPlan::disconnect_protection();
        assert_eq!(disconnect.group_name, FIREWALL_DISCONNECT_PROTECTION_GROUP);
        assert_eq!(disconnect.rule_prefix, "Aegos Kill Switch Allow");
        assert_eq!(disconnect.state_file_name, FIREWALL_PROFILE_SNAPSHOT_FILE);
        assert_eq!(
            disconnect.state_path(Path::new("C:/Aegos")),
            PathBuf::from("C:/Aegos").join(FIREWALL_PROFILE_SNAPSHOT_FILE)
        );

        let speed = CoreFirewallPolicyPlan::speed_test();
        assert_eq!(speed.group_name, FIREWALL_SPEED_TEST_GROUP);
        assert_eq!(speed.rule_prefix, "Aegos Kill Switch Speed Test Allow");
        assert_eq!(speed.state_file_name, FIREWALL_SPEED_TEST_MARKER_FILE);
        assert_eq!(
            firewall_remote_port_list(&[443, 8443, 10015]),
            "443,8443,10015"
        );
        assert_eq!(speed_test_firewall_enabled(true), true);
        assert_eq!(speed_test_firewall_enabled(false), false);
        assert_eq!(
            speed_test_firewall_ports(true, &[443, 8443]),
            vec![443, 8443]
        );
        assert!(speed_test_firewall_ports(false, &[443, 8443]).is_empty());
        assert_eq!(
            powershell_single_quote_escape("Aegos' Core"),
            "Aegos'' Core"
        );
        assert_eq!(
            powershell_string_array_literal(&[
                "C:\\Program Files\\Aegos\\aegos.exe".to_string(),
                "C:\\Aegos' Core\\mihomo.exe".to_string(),
            ]),
            "@('C:\\Program Files\\Aegos\\aegos.exe', 'C:\\Aegos'' Core\\mihomo.exe')"
        );
        assert_eq!(
            normalize_windows_program_path_text("\\\\?\\C:/Aegos/mihomo.exe"),
            "C:\\Aegos\\mihomo.exe"
        );
        assert_eq!(
            normalize_windows_program_path_text("\\\\?\\UNC\\server/share/aegos.exe"),
            "\\\\server\\share\\aegos.exe"
        );
    }

    #[test]
    fn system_proxy_takeover_plan_is_owned_by_runtime_boundary() {
        assert_eq!(windows_proxy_server(7891), "127.0.0.1:7891");

        let enable = CoreSystemProxyTakeoverPlan::new(true, 7891);
        assert!(enable.enable);
        assert_eq!(enable.proxy_enable_value, 1);
        assert_eq!(enable.proxy_server.as_deref(), Some("127.0.0.1:7891"));
        assert_eq!(enable.proxy_override, WINDOWS_PROXY_BYPASS_LIST);
        assert!(enable.should_write_proxy_server());
        let enable_script = windows_proxy_takeover_script_plan(true, 7891);
        assert_eq!(enable_script.proxy_enable_value, 1);
        assert_eq!(
            enable_script.proxy_server_literal.as_deref(),
            Some("'127.0.0.1:7891'")
        );
        assert_eq!(
            enable_script.proxy_override_literal,
            powershell_single_quoted_literal(WINDOWS_PROXY_BYPASS_LIST)
        );
        assert!(enable_script.should_write_proxy_server());

        let disable = CoreSystemProxyTakeoverPlan::new(false, 7891);
        assert!(!disable.enable);
        assert_eq!(disable.proxy_enable_value, 0);
        assert!(disable.proxy_server.is_none());
        assert_eq!(disable.proxy_override, WINDOWS_PROXY_BYPASS_LIST);
        assert!(!disable.should_write_proxy_server());
        let disable_script = windows_proxy_takeover_script_plan(false, 7891);
        assert_eq!(disable_script.proxy_enable_value, 0);
        assert!(disable_script.proxy_server_literal.is_none());
        assert_eq!(
            disable_script.proxy_override_literal,
            powershell_single_quoted_literal(WINDOWS_PROXY_BYPASS_LIST)
        );
        assert!(!disable_script.should_write_proxy_server());
        let snapshot_script = windows_proxy_snapshot_script_plan(&SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "127.0.0.1:7890;http='quoted'".to_string(),
            proxy_override: "<local>;a'b".to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        });
        assert_eq!(snapshot_script.proxy_enable_value, 1);
        assert_eq!(
            snapshot_script.proxy_server_literal.as_deref(),
            Some("'127.0.0.1:7890;http=''quoted'''")
        );
        assert_eq!(snapshot_script.proxy_override_literal, "'<local>;a''b'");
        assert!(snapshot_script.should_write_proxy_server());
    }

    #[test]
    fn system_proxy_verification_is_owned_by_runtime_boundary() {
        let aegos = SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "127.0.0.1:7891".to_string(),
            proxy_override: WINDOWS_PROXY_BYPASS_LIST.to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };
        assert!(verify_system_proxy_snapshot(&aegos, true, 7891).is_ok());
        assert!(verify_system_proxy_snapshot(&aegos, false, 7891)
            .unwrap_err()
            .contains("restore verification failed"));

        let external = SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "127.0.0.1:7890".to_string(),
            proxy_override: "<local>".to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };
        assert!(verify_system_proxy_snapshot(&external, false, 7891).is_ok());
        let failure = verify_system_proxy_snapshot(&external, true, 7891).unwrap_err();
        assert!(failure.contains("verification failed"));
        assert!(failure.contains("expected 127.0.0.1:7891"));
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
    fn routing_group_rows_are_shaped_inside_runtime_boundary() {
        let groups = json!([
            {
                "name": "GLOBAL",
                "type": "select",
                "now": "HK 01",
                "items": ["HK 01"]
            },
            {
                "name": "Aegos Landing IP",
                "type": "select",
                "now": "HK 01",
                "items": ["HK 01"]
            },
            {
                "name": "Auto",
                "type": "URLTest",
                "now": "JP 01",
                "items": ["HK 01", "JP 01"]
            },
            {
                "name": "Manual",
                "type": "load_balance",
                "now": "US 01",
                "items": ["US 01"]
            }
        ]);

        let rows = routing_group_rows(&groups, &["Aegos Landing IP", "GLOBAL"]);
        let items = rows.as_array().expect("routing group rows");
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0].get("name").and_then(JsonValue::as_str),
            Some("Auto")
        );
        assert_eq!(
            items[0].get("type").and_then(JsonValue::as_str),
            Some("url-test")
        );
        assert_eq!(
            items[0].get("automatic").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            items[0].get("itemCount").and_then(JsonValue::as_u64),
            Some(2)
        );
        assert_eq!(
            items[1].get("type").and_then(JsonValue::as_str),
            Some("load-balance")
        );
        assert_eq!(routing_group_counts(&rows), (2, 2));
    }

    #[test]
    fn proxy_group_snapshot_defaults_are_shaped_inside_runtime_boundary() {
        let mut groups = json!([
            {
                "name": "Final",
                "type": "Selector",
                "now": "Auto",
                "items": [
                    { "name": "Auto", "type": "Group", "group": true },
                    { "name": "DIRECT", "type": "Direct", "builtin": true }
                ]
            },
            {
                "name": "Auto",
                "type": "URLTest",
                "now": "Node A",
                "items": [
                    { "name": "Node A", "type": "ss" },
                    { "name": "Node B", "type": "trojan" }
                ]
            }
        ]);
        normalize_proxy_groups_snapshot_defaults(&mut groups);
        let rows = groups.as_array().expect("groups");
        assert_eq!(
            rows[0].get("name").and_then(JsonValue::as_str),
            Some("Proxies")
        );
        assert_eq!(
            rows[1].get("name").and_then(JsonValue::as_str),
            Some(AEGOS_AUTO_SELECT_GROUP_NAME)
        );
        assert_eq!(
            rows[0]
                .get("items")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn proxy_group_resolution_and_manual_flags_are_runtime_shaped() {
        let mut groups = json!([
            {
                "name": "Final",
                "type": "Selector",
                "now": "Auto",
                "items": [{ "name": "Auto", "type": "Group", "group": true }]
            },
            {
                "name": "Auto",
                "type": "URLTest",
                "now": "Node A",
                "items": [
                    { "name": "Node A", "type": "ss" },
                    { "name": "Node B", "type": "trojan" }
                ]
            }
        ]);
        let mut selected = HashMap::new();
        selected.insert("Final".to_string(), "Auto".to_string());
        selected.insert("Auto".to_string(), "Node B".to_string());
        assert_eq!(
            resolve_group_leaf(groups.as_array().unwrap(), &selected, "Final", 0),
            "Node B"
        );

        apply_group_resolution_with_selected_map(&mut groups, &selected);
        let final_group_item = groups
            .as_array()
            .and_then(|groups| groups.first())
            .and_then(|group| group.get("items"))
            .and_then(JsonValue::as_array)
            .and_then(|items| items.first())
            .expect("group reference item");
        assert_eq!(
            final_group_item
                .get("realProxyName")
                .and_then(JsonValue::as_str),
            Some("Node B")
        );

        annotate_manual_groups_with_names(&mut groups, &HashSet::from(["Node B".to_string()]));
        let manual_item = groups
            .as_array()
            .and_then(|groups| groups.get(1))
            .and_then(|group| group.get("items"))
            .and_then(JsonValue::as_array)
            .and_then(|items| items.get(1))
            .expect("manual item");
        assert_eq!(
            manual_item.get("manual").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            manual_item.get("source").and_then(JsonValue::as_str),
            Some("manual")
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
    fn status_surface_json_is_runtime_shaped_without_mojibake_permissions() {
        let status = status_surface_json(
            json!({ "engine": ENGINE }),
            true,
            true,
            json!({ "up": 1, "down": 2, "upTotal": 3, "downTotal": 4 }),
            "rule",
            true,
            7891,
            "192.168.1.7",
            "203.0.113.9",
            true,
            json!({ "name": "profile" }),
            json!({ "running": false }),
            json!({ "mixedPort": 7891 }),
            connection_status_json(true, true, true, false),
            protection_status_json(true, true, true, false, true),
            network_availability_json(true, true, "203.0.113.9", 100, 120),
            json!([]),
        );
        assert_eq!(
            status
                .pointer("/network/proxyEndpoint")
                .and_then(JsonValue::as_str),
            Some("127.0.0.1:7891")
        );
        assert_eq!(
            status.get("runtime").and_then(JsonValue::as_str),
            Some(ENGINE)
        );
        assert_eq!(
            status
                .pointer("/permissions/requiresAdminFor/1")
                .and_then(JsonValue::as_str),
            Some("Disconnect protection")
        );
        assert_eq!(
            status
                .pointer("/connection/phase")
                .and_then(JsonValue::as_str),
            Some("connected-system-proxy")
        );
        assert_eq!(
            status
                .pointer("/protection/level")
                .and_then(JsonValue::as_str),
            Some("guarded")
        );
        assert_eq!(
            status
                .pointer("/network/availability/state")
                .and_then(JsonValue::as_str),
            Some("available")
        );
    }

    #[test]
    fn status_surface_snapshot_covers_stage_one_state_matrix() {
        let make_status = |running: bool,
                           takeover: bool,
                           system_proxy: bool,
                           tun: bool,
                           outbound_ip: &str,
                           checked_at: u64,
                           now: u64| {
            status_surface_json(
                json!({ "engine": ENGINE }),
                running,
                takeover,
                json!({ "up": 0, "down": 0, "upTotal": 0, "downTotal": 0 }),
                "rule",
                system_proxy,
                7891,
                "192.168.1.7",
                outbound_ip,
                false,
                json!({ "name": "profile" }),
                json!({ "running": false }),
                json!({ "systemProxy": system_proxy, "tunEnabled": tun }),
                connection_status_json(running, takeover, system_proxy, tun),
                protection_status_json(running, takeover, false, tun, system_proxy),
                network_availability_json(running, takeover, outbound_ip, checked_at, now),
                json!([]),
            )
        };

        let stopped = make_status(false, false, false, false, "-", 0, 120);
        assert_eq!(
            stopped.get("coreReady").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            stopped
                .pointer("/connection/phase")
                .and_then(JsonValue::as_str),
            Some("disconnected")
        );
        assert_eq!(
            stopped
                .pointer("/network/availability/state")
                .and_then(JsonValue::as_str),
            Some("unverified")
        );

        let standby = make_status(true, false, true, false, "-", 0, 120);
        assert_eq!(
            standby.get("standby").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            standby
                .pointer("/connection/systemProxyWanted")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            standby
                .pointer("/connection/systemProxyApplied")
                .and_then(JsonValue::as_bool),
            Some(false)
        );

        let available = make_status(true, true, true, false, "203.0.113.9", 100, 120);
        assert_eq!(
            available
                .pointer("/connection/phase")
                .and_then(JsonValue::as_str),
            Some("connected-system-proxy")
        );
        assert_eq!(
            available
                .pointer("/network/availability/state")
                .and_then(JsonValue::as_str),
            Some("available")
        );
        assert_eq!(
            available
                .pointer("/network/availability/networkUsable")
                .and_then(JsonValue::as_bool),
            Some(true)
        );

        let stale = make_status(true, true, true, false, "203.0.113.9", 100, 900);
        assert_eq!(
            stale
                .pointer("/network/availability/state")
                .and_then(JsonValue::as_str),
            Some("stale")
        );

        let unavailable = make_status(true, true, true, false, "-", 100, 120);
        assert_eq!(
            unavailable
                .pointer("/network/availability/state")
                .and_then(JsonValue::as_str),
            Some("unavailable")
        );
        assert_eq!(
            unavailable
                .pointer("/network/availability/networkUsable")
                .and_then(JsonValue::as_bool),
            Some(false)
        );
    }

    #[test]
    fn network_availability_separates_runtime_from_usable_network() {
        let stopped = network_availability_json(false, false, "-", 0, 10);
        assert_eq!(
            stopped.get("state").and_then(JsonValue::as_str),
            Some("unverified")
        );
        assert_eq!(
            stopped.get("softwareReady").and_then(JsonValue::as_bool),
            Some(false)
        );

        let standby = network_availability_json(true, false, "-", 0, 10);
        assert_eq!(
            standby.get("state").and_then(JsonValue::as_str),
            Some("unverified")
        );
        assert_eq!(
            standby.get("softwareReady").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            standby.get("networkUsable").and_then(JsonValue::as_bool),
            Some(false)
        );

        let available = network_availability_json(true, true, "203.0.113.9", 100, 120);
        assert_eq!(
            available.get("state").and_then(JsonValue::as_str),
            Some("available")
        );
        assert_eq!(
            available.get("networkUsable").and_then(JsonValue::as_bool),
            Some(true)
        );

        let stale = network_availability_json(true, true, "203.0.113.9", 100, 900);
        assert_eq!(
            stale.get("state").and_then(JsonValue::as_str),
            Some("stale")
        );
        assert_eq!(
            stale.get("networkUsable").and_then(JsonValue::as_bool),
            Some(true)
        );

        let failed = network_availability_json(true, true, "-", 100, 120);
        assert_eq!(
            failed.get("state").and_then(JsonValue::as_str),
            Some("unavailable")
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
    fn core_power_results_are_runtime_shaped() {
        let connection = connection_closure_json(
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
        let started = core_start_result_json(None, false, true, connection.clone());
        assert_eq!(started.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(
            started.get("standby").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            started.get("trafficTakeover").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(started.get("connection"), Some(&connection));
        assert!(started.get("message").is_none());

        let reused = core_start_result_json(
            Some("Core already running"),
            true,
            false,
            connection.clone(),
        );
        assert_eq!(
            reused.get("message").and_then(JsonValue::as_str),
            Some("Core already running")
        );
        assert_eq!(
            reused.get("standby").and_then(JsonValue::as_bool),
            Some(true)
        );

        let stopped = core_stop_result_json();
        assert_eq!(stopped.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(stopped.as_object().map(|map| map.len()), Some(1));
    }

    #[test]
    fn recovery_results_are_runtime_shaped() {
        let probe = recovery_probe_result_json(true, "https://api.ipify.org", 200, "");
        assert_eq!(probe.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(probe.get("status").and_then(JsonValue::as_u64), Some(200));

        let suggestions = json!([{"group": "Proxies", "proxy": "HK 01"}]);
        let settings = json!({"reliability": {"failures": 0}});
        let healthy =
            recovery_healthy_result_json(0, probe.clone(), suggestions.clone(), settings.clone());
        assert_eq!(healthy.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(
            healthy.get("action").and_then(JsonValue::as_str),
            Some("none")
        );
        assert_eq!(healthy.get("suggestions"), Some(&suggestions));

        let observe = recovery_observe_result_json(
            1,
            3,
            recovery_probe_result_json(false, "", 0, "timeout"),
            suggestions.clone(),
            settings.clone(),
        );
        assert_eq!(observe.get("ok").and_then(JsonValue::as_bool), Some(false));
        assert_eq!(
            observe.get("action").and_then(JsonValue::as_str),
            Some("observe")
        );
        assert_eq!(
            observe.get("threshold").and_then(JsonValue::as_u64),
            Some(3)
        );

        let switch_result =
            recovery_switch_proxy_result_json("Proxies", "HK 01", 88, probe.clone());
        assert_eq!(
            switch_result.get("action").and_then(JsonValue::as_str),
            Some("switchProxy")
        );
        assert_eq!(
            switch_result.get("proxy").and_then(JsonValue::as_str),
            Some("HK 01")
        );

        let proxy_switched = recovery_proxy_switched_result_json(
            0,
            switch_result.clone(),
            suggestions.clone(),
            settings.clone(),
        );
        assert_eq!(
            proxy_switched
                .get("profileChanged")
                .and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(proxy_switched.get("result"), Some(&switch_result));

        let profile = json!({"id": "profile-b", "name": "Backup"});
        let profile_switched = recovery_profile_switched_result_json(
            0,
            profile.clone(),
            switch_result,
            suggestions.clone(),
            settings.clone(),
        );
        assert_eq!(
            profile_switched
                .get("profileChanged")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(profile_switched.get("profile"), Some(&profile));

        let failed = recovery_failed_result_json(
            4,
            recovery_probe_result_json(false, "", 0, "network"),
            suggestions,
            settings,
        );
        assert_eq!(failed.get("ok").and_then(JsonValue::as_bool), Some(false));
        assert_eq!(
            failed.get("action").and_then(JsonValue::as_str),
            Some("failed")
        );
        assert_eq!(failed.get("failures").and_then(JsonValue::as_u64), Some(4));
    }

    #[test]
    fn recovery_candidate_plan_filters_and_orders_runtime_candidates() {
        let groups = json!([
            {
                "name": "Other",
                "now": "OTHER NOW",
                "items": [
                    { "name": "Other 01", "type": "vless" },
                    { "name": "DIRECT", "type": "direct" }
                ]
            },
            {
                "name": "Proxies",
                "now": "HK Current",
                "items": [
                    { "name": "HK Current", "type": "ss" },
                    { "name": "PASS", "type": "direct" },
                    { "name": "剩余流量 1024G", "type": "ss" },
                    { "name": "Nested Group", "type": "group" },
                    { "name": "Group Flag", "group": true },
                    { "name": "HK 02", "type": "ss" },
                    { "name": "HK 02", "type": "ss" },
                    { "name": "JP 01", "protocol": "tuic" }
                ]
            },
            {
                "name": "GLOBAL",
                "now": "US Current",
                "items": [
                    { "name": "US Current", "type": "trojan" },
                    { "name": "US 01", "type": "trojan" }
                ]
            }
        ]);

        let plan = recovery_candidate_plan(&groups, 3);

        assert_eq!(
            plan,
            vec![
                RecoveryCandidatePlan {
                    group_name: "GLOBAL".to_string(),
                    proxy_name: "US 01".to_string(),
                    protocol: "trojan".to_string(),
                },
                RecoveryCandidatePlan {
                    group_name: "Proxies".to_string(),
                    proxy_name: "HK 02".to_string(),
                    protocol: "ss".to_string(),
                },
                RecoveryCandidatePlan {
                    group_name: "Proxies".to_string(),
                    proxy_name: "JP 01".to_string(),
                    protocol: "tuic".to_string(),
                },
            ]
        );
    }

    #[test]
    fn recovery_profile_failover_plan_filters_runtime_candidates() {
        let profiles = json!([
            { "id": "active", "name": "Active", "type": "url" },
            { "id": "direct", "name": "Direct", "type": "builtin" },
            { "id": "builtin-a", "name": "Builtin", "type": "builtin" },
            { "id": "", "name": "No id", "type": "url" },
            { "id": "backup-a", "name": "Backup A", "type": "url" },
            { "id": "backup-a", "name": "Backup A Duplicate", "type": "url" },
            { "id": "backup-b", "name": "", "profile_type": "file" }
        ]);

        let plan = recovery_profile_failover_plan(&profiles, "active");

        assert_eq!(
            plan,
            vec![
                RecoveryProfileFailoverPlan {
                    id: "backup-a".to_string(),
                    name: "Backup A".to_string(),
                    profile_type: "url".to_string(),
                },
                RecoveryProfileFailoverPlan {
                    id: "backup-b".to_string(),
                    name: "backup-b".to_string(),
                    profile_type: "file".to_string(),
                },
            ]
        );
    }

    #[test]
    fn protection_status_is_runtime_shaped_without_mojibake_labels() {
        let cases = [
            (false, false, false, false, false, "idle", "Not taken over"),
            (true, false, false, false, true, "standby", "Core standby"),
            (true, true, true, true, true, "strict", "Protected"),
            (
                true,
                true,
                true,
                false,
                true,
                "guarded",
                "Disconnect protected",
            ),
            (true, true, false, true, false, "tunnel", "TUN tunnel"),
            (true, true, false, false, true, "proxy", "System proxy"),
            (true, true, false, false, false, "partial", "Core only"),
        ];
        for (running, takeover, protection, tun, system_proxy, level, label) in cases {
            let status = protection_status_json(running, takeover, protection, tun, system_proxy);
            assert_eq!(status.get("level").and_then(JsonValue::as_str), Some(level));
            assert_eq!(status.get("label").and_then(JsonValue::as_str), Some(label));
            assert!(status
                .get("label")
                .and_then(JsonValue::as_str)
                .is_some_and(str::is_ascii));
        }
    }

    #[test]
    fn proxy_takeover_status_is_runtime_shaped() {
        let standby = proxy_takeover_status_json(7891, true, false, true);
        assert_eq!(
            standby.get("endpoint").and_then(JsonValue::as_str),
            Some("127.0.0.1:7891")
        );
        assert_eq!(
            standby.get("active").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            standby.get("standby").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            standby.get("snapshotCaptured").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            standby
                .get("restoresPreviousProxy")
                .and_then(JsonValue::as_bool),
            Some(true)
        );

        let active = proxy_takeover_status_json(7892, true, true, false);
        assert_eq!(
            active.get("endpoint").and_then(JsonValue::as_str),
            Some("127.0.0.1:7892")
        );
        assert_eq!(
            active.get("active").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            active.get("standby").and_then(JsonValue::as_bool),
            Some(false)
        );
    }

    #[test]
    fn proxy_takeover_integrity_is_runtime_shaped() {
        let aegos = SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "127.0.0.1:7891".to_string(),
            proxy_override: "<local>".to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };
        let external = SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "127.0.0.1:7890".to_string(),
            proxy_override: "<local>".to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };

        let disabled =
            proxy_takeover_integrity_json(false, false, false, Some(&external), None, 7891);
        assert_eq!(disabled.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(
            disabled.get("level").and_then(JsonValue::as_str),
            Some("ok")
        );

        let pending =
            proxy_takeover_integrity_json(true, false, false, Some(&external), None, 7891);
        assert_eq!(pending.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(
            pending.get("level").and_then(JsonValue::as_str),
            Some("info")
        );

        let healthy = proxy_takeover_integrity_json(true, true, true, Some(&aegos), None, 7891);
        assert_eq!(healthy.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(healthy.get("level").and_then(JsonValue::as_str), Some("ok"));
        assert_eq!(
            healthy.get("expectedEndpoint").and_then(JsonValue::as_str),
            Some("127.0.0.1:7891")
        );

        let no_snapshot =
            proxy_takeover_integrity_json(true, true, false, Some(&aegos), None, 7891);
        assert_eq!(
            no_snapshot.get("ok").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            no_snapshot.get("level").and_then(JsonValue::as_str),
            Some("warning")
        );

        let read_failed =
            proxy_takeover_integrity_json(true, true, false, None, Some("registry denied"), 7891);
        assert_eq!(
            read_failed.get("level").and_then(JsonValue::as_str),
            Some("warning")
        );
        assert!(read_failed
            .get("detail")
            .and_then(JsonValue::as_str)
            .is_some_and(|detail| detail.contains("registry denied")));

        let mismatch = proxy_takeover_integrity_json(true, true, true, Some(&external), None, 7891);
        assert_eq!(mismatch.get("ok").and_then(JsonValue::as_bool), Some(false));
        assert_eq!(
            mismatch.get("level").and_then(JsonValue::as_str),
            Some("error")
        );
        assert_eq!(
            mismatch.get("currentServer").and_then(JsonValue::as_str),
            Some("127.0.0.1:7890")
        );
    }

    #[test]
    fn system_proxy_repair_result_is_runtime_shaped() {
        let snapshot = SystemProxySnapshot {
            proxy_enable: true,
            proxy_server: "127.0.0.1:7891".to_string(),
            proxy_override: "<local>".to_string(),
            captured_at: "2026-07-15T00:00:00Z".to_string(),
        };
        let result = system_proxy_repair_result_json(7891, &snapshot);
        assert_eq!(result.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(
            result.get("endpoint").and_then(JsonValue::as_str),
            Some("127.0.0.1:7891")
        );
        assert_eq!(
            result
                .pointer("/current/proxy_server")
                .and_then(JsonValue::as_str),
            Some("127.0.0.1:7891")
        );
    }

    #[test]
    fn runtime_config_unchanged_result_is_runtime_shaped() {
        let result = runtime_config_unchanged_result_json("abc123");
        assert_eq!(result.get("ok").and_then(JsonValue::as_bool), Some(true));
        assert_eq!(
            result.get("skipped").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            result.get("reason").and_then(JsonValue::as_str),
            Some("unchanged runtime config digest")
        );
        assert_eq!(
            result.get("digest").and_then(JsonValue::as_str),
            Some("abc123")
        );
    }

    #[test]
    fn public_settings_surface_json_is_runtime_shaped() {
        let settings = public_settings_surface_json(
            "profile-1",
            7891,
            19091,
            json!([{ "id": "profile-1", "name": "Demo" }]),
            false,
            true,
            true,
            false,
            "gvisor",
            true,
            false,
            false,
            "warning",
            json!({ "Proxies": "HK 1" }),
            json!([{ "name": "Manual" }]),
            true,
            true,
            3,
            800,
            24,
            2,
            true,
            true,
            false,
            true,
        );
        assert_eq!(
            settings.get("activeProfileId").and_then(JsonValue::as_str),
            Some("profile-1")
        );
        assert_eq!(
            settings
                .pointer("/reservedPorts/mixed/0")
                .and_then(JsonValue::as_u64),
            Some(7890)
        );
        assert_eq!(
            settings
                .pointer("/reservedPorts/reason")
                .and_then(JsonValue::as_str),
            Some(RESERVED_MIXED_PORTS_REASON)
        );
        assert_eq!(
            settings
                .pointer("/runtimes/mihomo")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            settings
                .pointer("/reliability/failures")
                .and_then(JsonValue::as_u64),
            Some(2)
        );
        assert_eq!(
            settings
                .pointer("/proxyTakeover/standby")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
    }

    #[test]
    fn runtime_port_policy_is_owned_by_runtime_boundary() {
        assert_eq!(
            port_from_value(&json!(7891), 7000, "Mixed proxy port").unwrap(),
            7891
        );
        assert_eq!(
            port_from_value(&JsonValue::Null, 7891, "Mixed proxy port").unwrap(),
            7891
        );
        assert!(port_from_value(&json!(1023), 7891, "Mixed proxy port")
            .unwrap_err()
            .contains("between 1024 and 65535"));
        assert!(mixed_port_from_value(&json!(7890), 7891)
            .unwrap_err()
            .contains(RESERVED_MIXED_PORTS_REASON));
        assert!(validate_runtime_ports(7891, 19091).is_ok());
        assert!(validate_runtime_ports(7890, 19091)
            .unwrap_err()
            .contains("reserved"));
        assert!(validate_runtime_ports(7891, 7891)
            .unwrap_err()
            .contains("cannot equal controller port"));
    }

    #[test]
    fn diagnostic_check_and_summary_are_runtime_shaped() {
        let checks = vec![
            diagnostic_check_json("Runtime", true, "ready", "error", "runtime", "restart"),
            diagnostic_check_json("Port", false, "occupied", "error", "network", "change port"),
            diagnostic_check_json(
                "Permission",
                false,
                "not elevated",
                "warning",
                "permission",
                "restart as admin",
            ),
            diagnostic_check_json("Logs", false, "warning", "warning", "logs", "open logs"),
            diagnostic_check_json("Extra", false, "warning", "warning", "logs", "extra"),
        ];
        assert_eq!(
            checks[0].get("severity").and_then(JsonValue::as_str),
            Some("ok")
        );
        assert_eq!(
            checks[0].get("actionable").and_then(JsonValue::as_bool),
            Some(false)
        );
        let summary = diagnostic_summary_json(&checks);
        assert_eq!(summary.get("total").and_then(JsonValue::as_u64), Some(5));
        assert_eq!(summary.get("failed").and_then(JsonValue::as_u64), Some(4));
        assert_eq!(summary.get("errors").and_then(JsonValue::as_u64), Some(1));
        assert_eq!(summary.get("warnings").and_then(JsonValue::as_u64), Some(3));
        assert_eq!(
            summary
                .get("nextActions")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(3)
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
    fn controller_status_traffic_snapshot_uses_runtime_idle_and_fallback_contract() {
        let controller = CoreController::new(0, "");
        let previous = json!({ "up": 7, "down": 8, "upTotal": 70, "downTotal": 80 });
        assert_eq!(
            controller.status_traffic_snapshot_or_idle(false, &previous),
            idle_traffic_snapshot()
        );
        assert_eq!(
            controller.status_traffic_snapshot_or_idle(true, &previous),
            previous
        );
    }

    #[test]
    fn controller_runtime_reuse_ready_owns_ready_reuse_probe_contract() {
        assert_eq!(READY_REUSE_PROBE_TIMEOUT_MS, 900);
        let controller = CoreController::new(0, "");
        assert!(!controller.runtime_reuse_ready());
    }

    #[test]
    fn controller_proxy_selection_cleanup_is_owned_by_runtime_boundary() {
        let controller = CoreController::new(0, "");
        assert!(controller
            .apply_proxy_selection_with_cleanup("Proxy", "HK 01")
            .is_err());
        assert_eq!(STALE_CONNECTION_CLEANUP_TIMEOUT_MS, 1500);
    }

    #[test]
    fn controller_mode_apply_running_guard_is_owned_by_runtime_boundary() {
        let controller = CoreController::new(0, "");
        assert!(controller.apply_mode_if_running(false, "rule").is_none());
        assert!(controller
            .apply_mode_if_running(true, "rule")
            .is_some_and(|result| result.is_err()));
    }

    #[test]
    fn controller_auxiliary_proxy_selection_running_guard_is_owned_by_runtime_boundary() {
        let controller = CoreController::new(0, "");
        assert!(controller
            .apply_auxiliary_proxy_selection_if_running(false, "Aegos Landing IP", "HK 01")
            .is_none());
        assert!(controller
            .apply_auxiliary_proxy_selection_if_running(true, "Aegos Landing IP", "HK 01")
            .is_some_and(|result| result.is_err()));
    }

    #[test]
    fn controller_proxy_groups_snapshot_fallback_is_owned_by_runtime_boundary() {
        let controller = CoreController::new(0, "");
        let fallback = json!([{ "name": "Proxies", "items": [{ "name": "HK 01" }] }]);
        assert_eq!(
            controller.ui_proxy_groups_snapshot_or_else(false, &[], || fallback.clone()),
            fallback
        );
        assert_eq!(
            controller.ui_proxy_groups_snapshot_or_else(true, &[], || fallback.clone()),
            fallback
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

    #[test]
    fn runtime_failure_reason_classifier_covers_common_connection_failures() {
        assert_eq!(classify_failure_reason("dial tcp: i/o timeout"), "timeout");
        assert_eq!(classify_failure_reason("dns lookup failed"), "dns");
        assert_eq!(
            classify_failure_reason("server resolved to 198.18.0.1 fake-ip"),
            "dns-fake-ip"
        );
        assert_eq!(classify_failure_reason("tls handshake failed"), "tls");
        assert_eq!(classify_failure_reason("HTTP 401 unauthorized"), "auth");
        assert_eq!(
            classify_failure_reason("blocked by disconnect protection firewall"),
            "protection-blocked"
        );
        assert_eq!(
            classify_failure_reason("connect: network unreachable"),
            "node-connect"
        );
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
}
