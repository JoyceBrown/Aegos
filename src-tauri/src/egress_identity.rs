use super::{now_secs, AppState, CoreManager, JsonValue};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::State;

const OBSERVATION_FRESH_SECS: u64 = 600;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct EgressObservation {
    ip: String,
    checked_at: u64,
    profile_id: String,
    mode: String,
    runtime_node: String,
}

impl EgressObservation {
    pub(super) fn visible_ip(&self) -> String {
        if self.ip.trim().is_empty() {
            "-".to_string()
        } else {
            self.ip.clone()
        }
    }

    pub(super) fn checked_at(&self) -> u64 {
        self.checked_at
    }

    pub(super) fn record(
        &mut self,
        ip: String,
        checked_at: u64,
        profile_id: &str,
        mode: &str,
        runtime_node: &str,
    ) {
        self.ip = ip;
        self.checked_at = checked_at;
        self.profile_id = profile_id.to_string();
        self.mode = mode.to_string();
        self.runtime_node = runtime_node.to_string();
    }

    pub(super) fn invalidate(&mut self) {
        self.checked_at = 0;
    }

    pub(super) fn matches_context(&self, profile_id: &str, mode: &str, runtime_node: &str) -> bool {
        self.checked_at > 0
            && self.profile_id == profile_id
            && self.mode == mode
            && self.runtime_node == runtime_node
    }

    fn product_json(
        &self,
        profile_id: &str,
        mode: &str,
        requested_node: Option<&str>,
        runtime_node: Option<&str>,
        fixed_node: bool,
        running: bool,
        traffic_takeover: bool,
        observed_at: u64,
    ) -> JsonValue {
        let runtime_node = runtime_node.unwrap_or("");
        let has_ip = !self.ip.trim().is_empty() && self.ip != "-";
        let context_matches = self.matches_context(profile_id, mode, runtime_node);
        let fresh = context_matches
            && observed_at.saturating_sub(self.checked_at) <= OBSERVATION_FRESH_SECS;
        let freshness = if !has_ip {
            "missing"
        } else if fresh {
            "current"
        } else {
            "stale"
        };
        let identity_state = if !running || !traffic_takeover {
            "inactive"
        } else if !has_ip {
            "unverified"
        } else if !context_matches {
            "mismatch"
        } else if !fresh {
            "stale"
        } else {
            "verified"
        };
        json!({
            "profileId": profile_id,
            "mode": mode,
            "requested": {
                "node": requested_node.unwrap_or(""),
                "kind": requested_node.map(|_| "selected").unwrap_or("unknown")
            },
            "runtime": {
                "node": runtime_node,
                "kind": if runtime_node.is_empty() { "unknown" } else if fixed_node { "fixed" } else { "ordinary" },
                "active": running
            },
            "observed": {
                "ip": self.visible_ip(),
                "checkedAt": self.checked_at,
                "freshness": freshness,
                "contextMatches": context_matches
            },
            "identityState": identity_state,
            "fixedEgressVerified": identity_state == "verified" && fixed_node,
            "trafficTakeover": traffic_takeover,
            "generatedAt": observed_at
        })
    }
}

pub(super) fn consistency_report(
    identity: &JsonValue,
    dns_policy: Option<&JsonValue>,
    ipv6: &JsonValue,
) -> JsonValue {
    let identity_state = identity
        .get("identityState")
        .and_then(JsonValue::as_str)
        .unwrap_or("unverified");
    let fixed_node = identity
        .pointer("/runtime/kind")
        .and_then(JsonValue::as_str)
        == Some("fixed");
    let observed_ipv4 = identity
        .pointer("/observed/ip")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty() && *value != "-");
    let probed_ipv4 = ipv6
        .pointer("/currentNodeIpv4/ip")
        .and_then(JsonValue::as_str);
    let ipv4_matches = observed_ipv4.is_some() && observed_ipv4 == probed_ipv4;
    let dns_route_consistent = dns_policy.is_some_and(|policy| {
        let policy_fixed = policy
            .get("fixedNode")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        let remote = policy
            .get("remote")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        if fixed_node {
            policy_fixed && remote
        } else {
            !policy_fixed && !remote
        }
    });
    let tun_enabled = dns_policy
        .and_then(|policy| policy.get("tunEnabled"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let dns_protected = dns_policy
        .and_then(|policy| policy.get("hijackEffective"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let ipv6_requested = ipv6
        .pointer("/requested/enabled")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let ipv6_effective = ipv6
        .pointer("/effective/state")
        .and_then(JsonValue::as_str)
        .unwrap_or("unknown");
    let ipv6_leak = ipv6
        .pointer("/ipv6Leak/level")
        .and_then(JsonValue::as_str)
        .unwrap_or("unknown");
    let ipv6_consistent = if ipv6_requested {
        ipv6_effective == "active"
    } else {
        ipv6_leak != "risk" && ipv6_effective != "config-mismatch"
    };
    let identity_current = identity_state == "verified";
    let risk = identity_current && (!ipv4_matches || !dns_route_consistent || !ipv6_consistent);
    let partial = identity_current && fixed_node && (!tun_enabled || !dns_protected);
    let state = if identity_state == "inactive" {
        "inactive"
    } else if !identity_current {
        "pending"
    } else if risk {
        "risk"
    } else if partial {
        "partial"
    } else {
        "consistent"
    };
    let prompt = match state {
        "consistent" if fixed_node => "固定出口、实际 IPv4、远程 DNS、TUN 与 IPv6 策略已共同验证。",
        "consistent" => "普通出口、实际 IPv4、DNS 路由与 IPv6 策略已共同验证。",
        "partial" => "固定出口和远程 DNS 已确认；开启 TUN 后才能阻止应用绕过 DNS 接管。",
        "risk" if !ipv4_matches => "两次出口观测不一致，请刷新后再判断固定出口是否生效。",
        "risk" if !dns_route_consistent => {
            "DNS 路由与当前出口类型不一致，当前不能确认固定出口保护。"
        }
        "risk" => "IPv6 运行状态与当前出口策略不一致，请检查泄漏风险。",
        "inactive" => "连接后才会验证固定出口、DNS、TUN 与 IPv6 一致性。",
        _ => "出口身份或观测已变化，正在等待当前节点的新证据。",
    };
    json!({
        "state": state,
        "label": match state {
            "consistent" if fixed_node => "固定出口已验证",
            "consistent" => "普通出口已验证",
            "partial" => "部分保护",
            "risk" => "存在不一致",
            "inactive" => "未连接",
            _ => "待验证"
        },
        "fixedNode": fixed_node,
        "fixedEgressVerified": state == "consistent" && fixed_node,
        "identity": identity,
        "evidence": {
            "ipv4Matches": ipv4_matches,
            "dnsRouteConsistent": dns_route_consistent,
            "tunEnabled": tun_enabled,
            "dnsProtected": dns_protected,
            "ipv6Requested": ipv6_requested,
            "ipv6Effective": ipv6_effective,
            "ipv6Consistent": ipv6_consistent
        },
        "plainPrompt": prompt,
        "generatedAt": now_secs()
    })
}

impl CoreManager {
    pub(super) fn invalidate_egress_observation(&mut self) {
        self.outbound_ip_query_generation = self.outbound_ip_query_generation.saturating_add(1);
        self.outbound_observation.invalidate();
    }

    fn requested_outbound_node(&self) -> Option<&str> {
        let primary_groups = if self.settings.mode.eq_ignore_ascii_case("global") {
            super::OUTBOUND_IP_GLOBAL_PRIMARY_GROUPS
        } else {
            super::OUTBOUND_IP_RULE_PRIMARY_GROUPS
        };
        primary_groups
            .iter()
            .find_map(|group| self.settings.selected_proxy_map.get(*group))
            .map(String::as_str)
    }

    pub(super) fn egress_identity_snapshot(&self) -> JsonValue {
        let groups = self.proxy_groups();
        let runtime_node = self.current_outbound_ip_proxy_name(&groups);
        let fixed_node = runtime_node
            .as_ref()
            .is_some_and(|node| self.active_manual_nodes().contains_key(node));
        self.outbound_observation.product_json(
            &self.settings.active_profile_id,
            &self.settings.mode,
            self.requested_outbound_node(),
            runtime_node.as_deref(),
            fixed_node,
            self.process.is_some(),
            self.traffic_takeover,
            now_secs(),
        )
    }
}

fn snapshot_detached(core: Arc<Mutex<CoreManager>>) -> Result<JsonValue, String> {
    core.lock()
        .map_err(|_| "core state lock poisoned".to_string())
        .map(|core| core.egress_identity_snapshot())
}

#[tauri::command]
pub(super) async fn egress_identity_snapshot(
    state: State<'_, AppState>,
) -> Result<JsonValue, String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || snapshot_detached(core))
        .await
        .map_err(|err| format!("egress identity worker failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observation_is_current_only_for_the_recorded_identity() {
        let mut observation = EgressObservation::default();
        observation.record(
            "203.0.113.8".to_string(),
            100,
            "profile-a",
            "rule",
            "Fixed A",
        );
        assert!(observation.matches_context("profile-a", "rule", "Fixed A"));
        assert!(!observation.matches_context("profile-b", "rule", "Fixed A"));
        assert!(!observation.matches_context("profile-a", "global", "Fixed A"));
        assert!(!observation.matches_context("profile-a", "rule", "Fixed B"));
    }

    #[test]
    fn invalidation_retains_evidence_but_makes_it_stale() {
        let mut observation = EgressObservation::default();
        observation.record(
            "203.0.113.8".to_string(),
            100,
            "profile-a",
            "rule",
            "Fixed A",
        );
        observation.invalidate();
        let snapshot = observation.product_json(
            "profile-a",
            "rule",
            Some("Fixed A"),
            Some("Fixed A"),
            true,
            true,
            true,
            101,
        );
        assert_eq!(snapshot["observed"]["ip"], "203.0.113.8");
        assert_eq!(snapshot["observed"]["freshness"], "stale");
        assert_eq!(snapshot["identityState"], "mismatch");
        assert_eq!(snapshot["fixedEgressVerified"], false);
    }

    #[test]
    fn fixed_egress_requires_current_observation_and_takeover() {
        let mut observation = EgressObservation::default();
        observation.record(
            "203.0.113.8".to_string(),
            100,
            "profile-a",
            "rule",
            "Fixed A",
        );
        let verified = observation.product_json(
            "profile-a",
            "rule",
            Some("Fixed A"),
            Some("Fixed A"),
            true,
            true,
            true,
            101,
        );
        assert_eq!(verified["identityState"], "verified");
        assert_eq!(verified["fixedEgressVerified"], true);

        let standby = observation.product_json(
            "profile-a",
            "rule",
            Some("Fixed A"),
            Some("Fixed A"),
            true,
            true,
            false,
            101,
        );
        assert_eq!(standby["identityState"], "inactive");
        assert_eq!(standby["fixedEgressVerified"], false);
    }

    #[test]
    fn consistency_requires_matching_outlet_dns_tun_and_ipv6() {
        let identity = json!({
            "identityState": "verified",
            "runtime": { "kind": "fixed" },
            "observed": { "ip": "203.0.113.8" }
        });
        let dns = json!({
            "fixedNode": true,
            "remote": true,
            "tunEnabled": true,
            "hijackEffective": true
        });
        let ipv6 = json!({
            "requested": { "enabled": false },
            "effective": { "state": "disabled" },
            "currentNodeIpv4": { "ip": "203.0.113.8" },
            "ipv6Leak": { "level": "blocked" }
        });
        let report = consistency_report(&identity, Some(&dns), &ipv6);
        assert_eq!(report["state"], "consistent");
        assert_eq!(report["fixedEgressVerified"], true);
    }

    #[test]
    fn fixed_route_without_tun_is_partial_not_verified() {
        let identity = json!({
            "identityState": "verified",
            "runtime": { "kind": "fixed" },
            "observed": { "ip": "203.0.113.8" }
        });
        let dns = json!({
            "fixedNode": true,
            "remote": true,
            "tunEnabled": false,
            "hijackEffective": false
        });
        let ipv6 = json!({
            "requested": { "enabled": false },
            "effective": { "state": "disabled" },
            "currentNodeIpv4": { "ip": "203.0.113.8" },
            "ipv6Leak": { "level": "blocked" }
        });
        let report = consistency_report(&identity, Some(&dns), &ipv6);
        assert_eq!(report["state"], "partial");
        assert_eq!(report["fixedEgressVerified"], false);
    }

    #[test]
    fn outlet_mismatch_is_reported_as_risk() {
        let identity = json!({
            "identityState": "verified",
            "runtime": { "kind": "ordinary" },
            "observed": { "ip": "203.0.113.8" }
        });
        let dns = json!({
            "fixedNode": false,
            "remote": false,
            "tunEnabled": false,
            "hijackEffective": false
        });
        let ipv6 = json!({
            "requested": { "enabled": false },
            "effective": { "state": "disabled" },
            "currentNodeIpv4": { "ip": "203.0.113.9" },
            "ipv6Leak": { "level": "blocked" }
        });
        let report = consistency_report(&identity, Some(&dns), &ipv6);
        assert_eq!(report["state"], "risk");
        assert_eq!(report["evidence"]["ipv4Matches"], false);
    }
}
