//! Aegos-owned persisted product configuration.
//!
//! These types express user intent. They deliberately contain no Mihomo
//! controller DTOs or process state; the profile compiler translates them to
//! the active dataplane format.

use crate::config_domain::ManualNodeConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub(crate) fn default_reliability_auto() -> bool {
    true
}

pub(crate) fn default_dns_mode() -> String {
    "auto".to_string()
}

pub(crate) fn default_reliability_profile_failover() -> bool {
    true
}

pub(crate) fn default_reliability_failure_threshold() -> u64 {
    2
}

pub(crate) fn default_reliability_max_delay_ms() -> u64 {
    800
}

pub(crate) fn default_reliability_candidate_limit() -> u64 {
    24
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Profile {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) profile_type: String,
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) source_url: Option<String>,
    #[serde(default)]
    pub(crate) node_count: usize,
    #[serde(default)]
    pub(crate) proxy_group_count: usize,
    pub(crate) updated_at: String,
    pub(crate) digest: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Settings {
    pub(crate) active_profile_id: String,
    pub(crate) mixed_port: u16,
    pub(crate) controller_port: u16,
    pub(crate) secret: String,
    pub(crate) mode: String,
    pub(crate) system_proxy: bool,
    pub(crate) start_with_system_proxy: bool,
    pub(crate) kill_switch_enabled: bool,
    pub(crate) tun_enabled: bool,
    pub(crate) tun_stack: String,
    pub(crate) dns_hijack_enabled: bool,
    #[serde(default = "default_dns_mode")]
    pub(crate) dns_mode: String,
    #[serde(default)]
    pub(crate) dns_custom_nameservers: Vec<String>,
    pub(crate) ipv6_enabled: bool,
    pub(crate) allow_lan: bool,
    pub(crate) log_level: String,
    #[serde(default = "default_reliability_auto")]
    pub(crate) reliability_auto: bool,
    #[serde(default = "default_reliability_profile_failover")]
    pub(crate) reliability_profile_failover: bool,
    #[serde(default = "default_reliability_failure_threshold")]
    pub(crate) reliability_failure_threshold: u64,
    #[serde(default = "default_reliability_max_delay_ms")]
    pub(crate) reliability_max_delay_ms: u64,
    #[serde(default = "default_reliability_candidate_limit")]
    pub(crate) reliability_candidate_limit: u64,
    #[serde(default)]
    pub(crate) selected_proxy_map: HashMap<String, String>,
    #[serde(default)]
    pub(crate) manual_nodes: HashMap<String, HashMap<String, ManualNodeConfig>>,
    pub(crate) profiles: Vec<Profile>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_model_is_aegos_product_state_without_runtime_fields() {
        let source = serde_json::json!({
            "active_profile_id": "direct",
            "mixed_port": 7891,
            "controller_port": 19091,
            "secret": "fixture",
            "mode": "rule",
            "system_proxy": false,
            "start_with_system_proxy": true,
            "kill_switch_enabled": false,
            "tun_enabled": false,
            "tun_stack": "mixed",
            "dns_hijack_enabled": true,
            "ipv6_enabled": false,
            "allow_lan": false,
            "log_level": "info",
            "profiles": []
        });
        let settings: Settings = serde_json::from_value(source).expect("settings");
        let encoded = serde_json::to_value(settings).expect("encoded settings");
        assert_eq!(encoded["dns_mode"], "auto");
        assert!(encoded.get("mihomo").is_none());
        assert!(encoded.get("runtime_process").is_none());
    }
}
