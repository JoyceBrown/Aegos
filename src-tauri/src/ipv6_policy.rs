use std::{
    net::{IpAddr, UdpSocket},
    sync::{Arc, Mutex},
};

use serde_json::{json, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use tauri::State;

use super::{
    config_pipeline, egress_identity, profile_compiler, query_outbound_ip_family, AppState,
    CoreManager, Settings,
};

fn local_capability() -> JsonValue {
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
                "state": if usable { "available" } else { "unavailable" },
                "routed": routed,
                "localAddress": if usable { local } else { "-".to_string() },
                "method": "udp-route-probe",
                "changesConnection": false
            })
        }
        Err(_) => json!({
            "available": false,
            "state": "unavailable",
            "routed": false,
            "localAddress": "-",
            "method": "udp-route-probe",
            "changesConnection": false
        }),
    }
}

fn runtime_ipv6_enabled(config: &YamlValue) -> Option<bool> {
    config
        .as_mapping()
        .and_then(|map| map.get(YamlValue::String("ipv6".to_string())))
        .and_then(YamlValue::as_bool)
}

fn snapshot_context_is_current(start_generation: u64, current_generation: u64) -> bool {
    start_generation == current_generation
}

fn from_parts(
    local: JsonValue,
    ipv4_outlet: Result<String, String>,
    ipv6_outlet: Result<String, String>,
    dns_safety: Result<String, String>,
    runtime_ipv6_configured: Option<bool>,
    settings: &Settings,
    running: bool,
) -> JsonValue {
    let requested = settings.ipv6_enabled;
    let local_available = local
        .get("available")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let ipv4_ok = ipv4_outlet.is_ok();
    let ipv6_ok = ipv6_outlet.is_ok();
    let node_capability = if !running {
        "unknown"
    } else if ipv6_ok {
        "supported"
    } else {
        "unsupported"
    };
    let runtime_state = if !running {
        "inactive"
    } else {
        match runtime_ipv6_configured {
            Some(true) => "enabled",
            Some(false) => "disabled",
            None => "unknown",
        }
    };
    let effective_state = if !running {
        "inactive"
    } else if !requested {
        "disabled"
    } else if !local_available {
        "local-unavailable"
    } else if runtime_ipv6_configured != Some(true) {
        "config-mismatch"
    } else if ipv6_ok {
        "active"
    } else {
        "blocked"
    };
    let leak_level = if !running || !local_available || ipv6_ok {
        "none"
    } else if requested {
        "risk"
    } else {
        "blocked"
    };
    let action = if !running {
        "wait-connection"
    } else if !local_available {
        "local-ipv6-unavailable"
    } else if requested && ipv6_ok {
        "use-ipv6"
    } else if requested {
        "block-ipv6-leak"
    } else if ipv6_ok {
        "enable-available"
    } else {
        "fallback-ipv4"
    };
    let plain_prompt = match action {
        "wait-connection" => "连接后检测当前节点的 IPv6 能力；请求状态不代表已经生效。",
        "use-ipv6" => "IPv6 已请求，运行配置和当前出口均已验证生效。",
        "enable-available" => "本机和当前节点支持 IPv6；可按需启用。",
        "block-ipv6-leak" => "当前节点不支持 IPv6；保持阻断以避免绕过当前线路。",
        "fallback-ipv4" => "当前节点不支持 IPv6；Aegos 正在使用 IPv4。",
        _ => "本机 IPv6 不可用；Aegos 正在使用 IPv4。",
    };
    let can_change_requested = requested || (running && local_available && ipv6_ok);
    json!({
        "mode": if requested { "enabled" } else { "disabled" },
        "requested": {
            "enabled": requested,
            "state": if requested { "enabled" } else { "disabled" }
        },
        "localCapability": {
            "state": if local_available { "available" } else { "unavailable" },
            "available": local_available
        },
        "nodeCapability": {
            "state": node_capability,
            "tested": running
        },
        "runtimeConfig": {
            "state": runtime_state,
            "compiledEnabled": runtime_ipv6_configured,
            "deployed": running
        },
        "effective": {
            "state": effective_state,
            "active": effective_state == "active"
        },
        "canChangeRequested": can_change_requested,
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
        "nodeIpv6Support": node_capability,
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
        "checkedAt": super::now_secs()
    })
}

fn snapshot_detached(core_state: Arc<Mutex<CoreManager>>) -> Result<JsonValue, String> {
    let (running, mixed_port, settings, active_profile, identity, dns_policy, query_generation) = {
        let core = core_state
            .lock()
            .map_err(|_| "core state lock poisoned".to_string())?;
        (
            core.process.is_some(),
            core.settings.mixed_port,
            core.settings.clone(),
            core.active_profile(),
            core.egress_identity_snapshot(),
            core.dns_policy_snapshot().ok(),
            core.outbound_ip_query_generation,
        )
    };
    let local = local_capability();
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
    let runtime_plan = active_profile
        .as_ref()
        .ok_or_else(|| "no active profile".to_string())
        .and_then(|profile| profile_compiler::compile_profile_file(profile, &settings));
    let runtime_ipv6_configured = runtime_plan
        .as_ref()
        .ok()
        .and_then(|plan| runtime_ipv6_enabled(plan.runtime_catalog().config()));
    let dns_safety = runtime_plan
        .as_ref()
        .map_err(|err| err.clone())
        .and_then(|plan| {
            config_pipeline::runtime_dns_safety_report(plan.runtime_catalog().config())
        });
    let current_generation = core_state
        .lock()
        .map_err(|_| "core state lock poisoned".to_string())?
        .outbound_ip_query_generation;
    if !snapshot_context_is_current(query_generation, current_generation) {
        return Err("IPv6/DNS snapshot expired after the route identity changed.".to_string());
    }
    let mut snapshot = from_parts(
        local,
        ipv4_outlet,
        ipv6_outlet,
        dns_safety,
        runtime_ipv6_configured,
        &settings,
        running,
    );
    let consistency =
        egress_identity::consistency_report(&identity, dns_policy.as_ref(), &snapshot);
    if let Some(map) = snapshot.as_object_mut() {
        map.insert("egressConsistency".to_string(), consistency);
    }
    Ok(snapshot)
}

#[tauri::command]
pub(super) async fn ipv6_dns_safety_snapshot(
    state: State<'_, AppState>,
) -> Result<JsonValue, String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || snapshot_detached(core))
        .await
        .map_err(|err| format!("IPv6/DNS check worker stopped: {err}"))?
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value as JsonValue};

    use super::{from_parts, snapshot_context_is_current};
    use crate::default_settings;

    #[test]
    fn snapshot_separates_request_capability_runtime_and_effective_state() {
        let mut settings = default_settings();
        settings.ipv6_enabled = false;
        settings.dns_hijack_enabled = true;
        let report = from_parts(
            json!({ "available": true, "routed": true, "localAddress": "2001:db8::10" }),
            Ok("198.51.100.10".to_string()),
            Ok("2001:db8::20".to_string()),
            Ok("listen=127.0.0.1:1054".to_string()),
            Some(false),
            &settings,
            true,
        );
        assert_eq!(report["requested"]["state"], "disabled");
        assert_eq!(report["localCapability"]["state"], "available");
        assert_eq!(report["nodeCapability"]["state"], "supported");
        assert_eq!(report["runtimeConfig"]["state"], "disabled");
        assert_eq!(report["effective"]["state"], "disabled");
        assert_eq!(report["canChangeRequested"], true);
    }

    #[test]
    fn unsupported_node_falls_back_without_changing_connection() {
        let mut settings = default_settings();
        settings.ipv6_enabled = false;
        let report = from_parts(
            json!({ "available": true, "routed": true, "localAddress": "2001:db8::10" }),
            Ok("198.51.100.10".to_string()),
            Err("ipv6 outlet unavailable".to_string()),
            Ok("listen=127.0.0.1:1054".to_string()),
            Some(false),
            &settings,
            true,
        );
        assert_eq!(
            report.get("changesConnection").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(report["nodeCapability"]["state"], "unsupported");
        assert_eq!(report["ipv6Leak"]["action"], "fallback-ipv4");
        assert_eq!(report["canChangeRequested"], false);
        assert!(report["plainPrompt"]
            .as_str()
            .unwrap_or("")
            .contains("IPv4"));
    }

    #[test]
    fn route_identity_change_expires_slow_snapshot() {
        assert!(snapshot_context_is_current(7, 7));
        assert!(!snapshot_context_is_current(7, 8));
    }
}
