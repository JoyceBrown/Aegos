use std::sync::{Arc, Mutex};

use serde_json::{json, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use tauri::State;

use super::{config_pipeline, AppState, CoreManager, Settings, AEGOS_OUTBOUND_IP_GROUP};

pub(super) fn apply_candidate_value(
    settings: &mut Settings,
    key: &str,
    value: &JsonValue,
) -> Result<(), String> {
    match key {
        "dnsMode" => {
            let mode = value
                .as_str()
                .filter(|mode| matches!(*mode, "auto" | "secure" | "system" | "custom"))
                .ok_or_else(|| {
                    "DNS mode must be one of: auto, secure, system, custom".to_string()
                })?;
            settings.dns_mode = mode.to_string();
            if mode == "system" {
                settings.dns_hijack_enabled = false;
            } else if mode == "secure" {
                settings.dns_hijack_enabled = true;
            }
        }
        "dnsCustomNameservers" => {
            settings.dns_custom_nameservers = custom_nameservers_from_value(value)?;
        }
        "tunEnabled" => settings.tun_enabled = value.as_bool().unwrap_or(false),
        "dnsHijackEnabled" => {
            settings.dns_hijack_enabled = value
                .as_bool()
                .ok_or_else(|| "DNS takeover state must be true or false.".to_string())?;
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn validate_candidate(settings: &Settings) -> Result<(), String> {
    if settings.dns_mode == "custom" && settings.dns_custom_nameservers.is_empty() {
        return Err("Custom DNS mode requires at least one encrypted resolver".to_string());
    }
    if settings.dns_mode == "system" && settings.tun_enabled {
        return Err(
            "System DNS mode cannot be used with TUN; choose Auto, Secure, or Custom DNS"
                .to_string(),
        );
    }
    if settings.dns_mode == "system" && settings.dns_hijack_enabled {
        return Err("System DNS mode cannot enable DNS hijacking".to_string());
    }
    if settings.dns_mode == "secure" && !settings.dns_hijack_enabled {
        return Err("Secure DNS takeover requires DNS hijacking".to_string());
    }
    Ok(())
}

fn custom_nameservers_from_value(value: &JsonValue) -> Result<Vec<String>, String> {
    let values = value
        .as_array()
        .ok_or_else(|| "Custom DNS resolvers must be an array".to_string())?;
    if values.is_empty() || values.len() > 4 {
        return Err("Custom DNS requires between 1 and 4 encrypted resolvers".to_string());
    }
    let mut resolvers = Vec::with_capacity(values.len());
    for (index, value) in values.iter().enumerate() {
        let resolver = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Custom DNS resolver {} must be non-empty text", index + 1))?;
        if !(resolver.starts_with("https://") || resolver.starts_with("tls://"))
            || config_pipeline::is_local_or_fake_nameserver(resolver)
        {
            return Err(format!(
                "Custom DNS resolver {} must use https:// or tls:// and cannot be local",
                index + 1
            ));
        }
        if !resolvers.iter().any(|item| item == resolver) {
            resolvers.push(resolver.to_string());
        }
    }
    if resolvers.is_empty() {
        return Err("Custom DNS requires at least one encrypted resolver".to_string());
    }
    Ok(resolvers)
}

pub(super) fn from_runtime_config(
    config: &YamlValue,
    settings: &Settings,
    profile_id: &str,
    running: bool,
) -> Result<JsonValue, String> {
    let route = config_pipeline::runtime_dns_route(config)?;
    let fixed_node = config.as_mapping().is_some_and(|map| {
        config_pipeline::fixed_node_is_selected(map, settings, Some(profile_id))
    });
    let remote = route == AEGOS_OUTBOUND_IP_GROUP;
    let hijack_configured = config_pipeline::runtime_dns_hijack_enabled(config);
    let hijack_effective = running && settings.tun_enabled && hijack_configured;
    let requested_mode = settings.dns_mode.as_str();
    let effective_mode = if !running {
        "inactive"
    } else if requested_mode == "system" {
        "system"
    } else if fixed_node {
        "fixed-remote"
    } else {
        requested_mode
    };
    let protection_state = if !running {
        "ready"
    } else if requested_mode == "system" {
        "compatibility"
    } else if (requested_mode == "secure" || fixed_node) && !hijack_effective {
        "needs-tun"
    } else if hijack_effective {
        "protected"
    } else {
        "encrypted"
    };
    let hijack_locked = requested_mode == "system"
        || requested_mode == "secure"
        || (fixed_node && settings.tun_enabled);
    Ok(json!({
        "mode": requested_mode,
        "requestedMode": requested_mode,
        "effectiveMode": effective_mode,
        "protectionState": protection_state,
        "route": route,
        "fixedNode": fixed_node,
        "remote": remote,
        "tunEnabled": settings.tun_enabled,
        "hijackRequested": settings.dns_hijack_enabled,
        "hijackConfigured": hijack_configured,
        "hijackEffective": hijack_effective,
        "hijackLocked": hijack_locked,
        "requiresTun": (fixed_node || requested_mode == "secure") && !settings.tun_enabled,
        "running": running
    }))
}

impl CoreManager {
    pub(super) fn dns_policy_snapshot(&self) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "no active profile".to_string())?;
        let plan = self.render_runtime_profile(&profile)?;
        from_runtime_config(
            plan.runtime_catalog().config(),
            &self.settings,
            &profile.id,
            self.process.is_some(),
        )
    }
}

fn snapshot_detached(core: Arc<Mutex<CoreManager>>) -> Result<JsonValue, String> {
    core.lock()
        .map_err(|_| "core state lock poisoned".to_string())?
        .dns_policy_snapshot()
}

#[tauri::command]
pub(super) async fn dns_policy_snapshot(state: State<'_, AppState>) -> Result<JsonValue, String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || snapshot_detached(core))
        .await
        .map_err(|err| format!("DNS policy worker stopped: {err}"))?
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;
    use serde_yaml::Value as YamlValue;

    use super::{apply_candidate_value, from_runtime_config, validate_candidate};
    use crate::{
        config_domain::ManualNodeConfig, config_pipeline, default_settings, AEGOS_OUTBOUND_IP_GROUP,
    };

    fn source_config() -> YamlValue {
        serde_yaml::from_str(
            r#"
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
    proxies: [Node A]
rules: ["MATCH,GLOBAL"]
"#,
        )
        .expect("source")
    }

    #[test]
    fn mode_candidate_applies_locked_hijack_contract() {
        let mut settings = default_settings();
        apply_candidate_value(&mut settings, "dnsMode", &json!("secure")).expect("secure");
        assert_eq!(settings.dns_mode, "secure");
        assert!(settings.dns_hijack_enabled);
        validate_candidate(&settings).expect("secure candidate");

        apply_candidate_value(&mut settings, "dnsMode", &json!("system")).expect("system");
        assert_eq!(settings.dns_mode, "system");
        assert!(!settings.dns_hijack_enabled);
        validate_candidate(&settings).expect("system candidate without TUN");

        apply_candidate_value(&mut settings, "tunEnabled", &json!(true)).expect("TUN");
        assert!(validate_candidate(&settings)
            .expect_err("system and TUN must conflict")
            .contains("cannot be used with TUN"));
    }

    #[test]
    fn custom_resolver_validation_does_not_echo_sensitive_input() {
        let mut settings = default_settings();
        let sensitive = "http://private-resolver.example.invalid/token";
        let error =
            apply_candidate_value(&mut settings, "dnsCustomNameservers", &json!([sensitive]))
                .expect_err("unencrypted resolver");
        assert!(!error.contains(sensitive));
        assert!(!error.contains("private-resolver"));
        assert!(error.contains("resolver 1"));
    }

    #[test]
    fn snapshot_separates_requested_mode_from_effective_protection() {
        let mut settings = default_settings();
        settings.dns_mode = "secure".to_string();
        settings.dns_hijack_enabled = true;
        settings.tun_enabled = false;
        let secure_config = config_pipeline::patch_config(source_config(), &settings, Some("test"))
            .expect("secure config");
        let secure =
            from_runtime_config(&secure_config, &settings, "test", true).expect("secure policy");
        assert_eq!(secure["requestedMode"], "secure");
        assert_eq!(secure["effectiveMode"], "secure");
        assert_eq!(secure["protectionState"], "needs-tun");
        assert_eq!(secure["requiresTun"], true);
        assert_eq!(secure["hijackLocked"], true);

        settings.dns_mode = "system".to_string();
        settings.dns_hijack_enabled = false;
        let system_config = config_pipeline::patch_config(source_config(), &settings, Some("test"))
            .expect("system config");
        let system =
            from_runtime_config(&system_config, &settings, "test", true).expect("system policy");
        assert_eq!(system["requestedMode"], "system");
        assert_eq!(system["effectiveMode"], "system");
        assert_eq!(system["protectionState"], "compatibility");
        assert_eq!(system["hijackLocked"], true);
    }

    #[test]
    fn fixed_node_dns_snapshot_uses_selected_custom_group_over_generated_proxies_group() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: Fixture VLESS
    type: ss
    server: fixture.example.com
    port: 443
    cipher: aes-128-gcm
    password: fixture-password
proxy-groups:
  - name: Fixture
    type: select
    proxies: [Fixture VLESS]
rules: ["MATCH,Fixture"]
"#,
        )
        .expect("source config");
        let fixed_node = ManualNodeConfig::from_input(
            &json!({
                "name": "Fixture Fixed",
                "type": "socks5",
                "server": "198.51.100.10",
                "port": 1080
            }),
            "socks5".to_string(),
        )
        .expect("fixed node");
        let mut settings = default_settings();
        settings
            .selected_proxy_map
            .insert("Fixture".to_string(), "Fixture Fixed".to_string());
        settings.manual_nodes.insert(
            "test".to_string(),
            HashMap::from([("Fixture Fixed".to_string(), fixed_node)]),
        );

        let runtime =
            config_pipeline::patch_config(source, &settings, Some("test")).expect("runtime config");
        let snapshot =
            from_runtime_config(&runtime, &settings, "test", true).expect("DNS snapshot");

        assert_eq!(snapshot["fixedNode"], true);
        assert_eq!(snapshot["effectiveMode"], "fixed-remote");
        assert_eq!(snapshot["route"], AEGOS_OUTBOUND_IP_GROUP);
    }
}
