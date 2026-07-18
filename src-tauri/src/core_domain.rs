use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TrafficSnapshot {
    pub up: u64,
    pub down: u64,
    pub up_total: u64,
    pub down_total: u64,
}

pub fn traffic_snapshot_from_controller_line(line: &str) -> Result<TrafficSnapshot, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err("Controller traffic response was empty".to_string());
    }
    let payload: JsonValue = serde_json::from_str(trimmed)
        .map_err(|err| format!("Controller traffic response was invalid: {err}"))?;
    if !payload.is_object() {
        return Err("Controller traffic response was not an object".to_string());
    }
    serde_json::from_value(payload)
        .map_err(|err| format!("Controller traffic fields were invalid: {err}"))
}

fn default_proxy_alive() -> bool {
    true
}

fn default_proxy_delay() -> i64 {
    -1
}

fn default_proxy_protocol() -> String {
    "Unknown".to_string()
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_zero_i64(value: &i64) -> bool {
    *value == 0
}

fn is_zero_u64(value: &u64) -> bool {
    *value == 0
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyNodeSnapshot {
    pub name: String,
    #[serde(rename = "type", default = "default_proxy_protocol")]
    pub protocol: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub server: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub speed_protocol: String,
    #[serde(default = "default_proxy_alive")]
    pub alive: bool,
    #[serde(default = "default_proxy_delay")]
    pub delay: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub udp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xudp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tfo: Option<bool>,
    #[serde(skip_serializing_if = "is_false")]
    pub group: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub real_proxy_name: String,
    #[serde(skip_serializing_if = "is_false")]
    pub builtin: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub manual: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub fixed: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub r#static: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub source: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub profile_type: String,
    #[serde(skip_serializing_if = "is_false")]
    pub residential: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub health_status: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub health_confidence: String,
    #[serde(skip_serializing_if = "is_zero_u64")]
    pub last_tested_at: u64,
    #[serde(skip_serializing_if = "is_zero_u64")]
    pub last_success_at: u64,
    #[serde(skip_serializing_if = "is_zero_u64")]
    pub result_age_secs: u64,
    #[serde(skip_serializing_if = "is_zero_i64")]
    pub median_delay: i64,
    #[serde(skip_serializing_if = "is_zero_i64")]
    pub jitter: i64,
    #[serde(skip_serializing_if = "is_zero_u64")]
    pub failure_streak: u64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub last_failure_reason: String,
    #[serde(skip_serializing_if = "is_zero_i64")]
    pub health_score: i64,
    #[serde(skip_serializing_if = "is_zero_u64")]
    pub cooldown_until: u64,
    #[serde(skip_serializing_if = "is_false")]
    pub recommended: bool,
}

impl ProxyNodeSnapshot {
    fn effective_name(&self) -> &str {
        if self.real_proxy_name.trim().is_empty() {
            &self.name
        } else {
            &self.real_proxy_name
        }
    }

    fn is_builtin(&self) -> bool {
        let name = self.name.to_ascii_uppercase();
        let protocol = self.protocol.to_ascii_uppercase();
        self.builtin
            || matches!(
                name.as_str(),
                "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE"
            )
            || matches!(
                protocol.as_str(),
                "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE"
            )
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyGroupSnapshot {
    pub name: String,
    #[serde(rename = "type")]
    pub strategy_type: String,
    pub now: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub test_url: String,
    pub items: Vec<ProxyNodeSnapshot>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProxyCatalog {
    groups: Vec<ProxyGroupSnapshot>,
}

impl ProxyCatalog {
    pub fn new(groups: Vec<ProxyGroupSnapshot>) -> Self {
        Self { groups }
    }

    pub fn from_product_json(value: &JsonValue) -> Result<Self, String> {
        if !value.is_array() {
            return Err("Aegos proxy catalog was not an array".to_string());
        }
        serde_json::from_value::<Vec<ProxyGroupSnapshot>>(value.clone())
            .map(Self::new)
            .map_err(|err| format!("Aegos proxy catalog fields were invalid: {err}"))
    }

    pub fn into_product_json(self) -> JsonValue {
        serde_json::to_value(self.groups).unwrap_or_else(|_| JsonValue::Array(Vec::new()))
    }

    pub fn groups(&self) -> &[ProxyGroupSnapshot] {
        &self.groups
    }

    pub fn nodes_mut(&mut self) -> impl Iterator<Item = &mut ProxyNodeSnapshot> {
        self.groups
            .iter_mut()
            .flat_map(|group| group.items.iter_mut())
    }

    pub fn ensure_default_groups<F, G>(
        &mut self,
        is_main_group: F,
        is_auto_group: G,
        auto_name: &str,
    ) where
        F: Fn(&str) -> bool,
        G: Fn(&str) -> bool,
    {
        if self.groups.is_empty() {
            return;
        }
        let all_items = self.all_real_nodes();
        if all_items.is_empty() {
            return;
        }
        let first_name = all_items[0].effective_name().to_string();
        if !self.groups.iter().any(|group| is_main_group(&group.name)) {
            self.groups.insert(
                0,
                ProxyGroupSnapshot {
                    name: "Proxies".to_string(),
                    strategy_type: "Selector".to_string(),
                    now: first_name.clone(),
                    items: all_items.clone(),
                    ..ProxyGroupSnapshot::default()
                },
            );
        }
        if all_items.len() >= 2 && !self.groups.iter().any(|group| is_auto_group(&group.name)) {
            let insert_index = self
                .groups
                .iter()
                .position(|group| is_main_group(&group.name))
                .map(|index| index.saturating_add(1))
                .unwrap_or(0);
            self.groups.insert(
                insert_index,
                ProxyGroupSnapshot {
                    name: auto_name.to_string(),
                    strategy_type: "URLTest".to_string(),
                    now: first_name,
                    items: all_items,
                    ..ProxyGroupSnapshot::default()
                },
            );
        }
    }

    pub fn apply_selected_map(&mut self, selected_map: &HashMap<String, String>) {
        let snapshot = self.groups.clone();
        let group_names = snapshot
            .iter()
            .map(|group| group.name.clone())
            .collect::<HashSet<_>>();
        for group in &mut self.groups {
            if let Some(selected) = selected_map
                .get(&group.name)
                .filter(|value| !value.trim().is_empty())
            {
                group.now = selected.clone();
            }
            for item in &mut group.items {
                if !group_names.contains(&item.name) {
                    continue;
                }
                item.group = true;
                item.protocol = "Group".to_string();
                item.real_proxy_name =
                    Self::resolve_leaf_in(&snapshot, selected_map, &item.name, 0);
            }
        }
    }

    pub fn annotate_manual_nodes(&mut self, names: &HashSet<String>) {
        if names.is_empty() {
            return;
        }
        for item in self.groups.iter_mut().flat_map(|group| &mut group.items) {
            if names.contains(&item.name) {
                item.manual = true;
                item.fixed = true;
                item.r#static = true;
                item.source = "manual".to_string();
            }
        }
    }

    #[cfg(test)]
    pub fn resolve_leaf(&self, selected_map: &HashMap<String, String>, name: &str) -> String {
        Self::resolve_leaf_in(&self.groups, selected_map, name, 0)
    }

    pub fn resolve_runtime_leaf(&self, preferred_groups: &[&str]) -> Option<String> {
        let group_names = self
            .groups
            .iter()
            .map(|group| group.name.as_str())
            .collect::<HashSet<_>>();
        let primary = preferred_groups
            .iter()
            .find(|name| group_names.contains(**name))?;
        let leaf = Self::resolve_leaf_in(&self.groups, &HashMap::new(), primary, 0);
        (!leaf.trim().is_empty() && !group_names.contains(leaf.as_str())).then_some(leaf)
    }

    pub fn group_contains_leaf(&self, group_name: &str, leaf: &str) -> bool {
        self.groups
            .iter()
            .find(|group| group.name == group_name)
            .is_some_and(|group| {
                group
                    .items
                    .iter()
                    .any(|item| !item.group && (item.name == leaf || item.real_proxy_name == leaf))
            })
    }

    fn resolve_leaf_in(
        groups: &[ProxyGroupSnapshot],
        selected_map: &HashMap<String, String>,
        name: &str,
        depth: usize,
    ) -> String {
        if depth > 8 {
            return name.to_string();
        }
        let Some(group) = groups.iter().find(|group| group.name == name) else {
            return name.to_string();
        };
        let selected = selected_map
            .get(&group.name)
            .filter(|value| !value.trim().is_empty())
            .map(String::as_str)
            .unwrap_or(group.now.as_str());
        if selected.trim().is_empty() || selected == name {
            return name.to_string();
        }
        Self::resolve_leaf_in(groups, selected_map, selected, depth + 1)
    }

    fn all_real_nodes(&self) -> Vec<ProxyNodeSnapshot> {
        let group_names = self
            .groups
            .iter()
            .map(|group| group.name.clone())
            .collect::<HashSet<_>>();
        let mut seen_groups = HashSet::new();
        let mut seen_nodes = HashSet::new();
        let mut nodes = Vec::new();
        for group in &self.groups {
            self.collect_real_nodes(
                group,
                &group_names,
                &mut seen_groups,
                &mut seen_nodes,
                &mut nodes,
            );
        }
        nodes
    }

    fn collect_real_nodes(
        &self,
        group: &ProxyGroupSnapshot,
        group_names: &HashSet<String>,
        seen_groups: &mut HashSet<String>,
        seen_nodes: &mut HashSet<String>,
        nodes: &mut Vec<ProxyNodeSnapshot>,
    ) {
        if !group.name.is_empty() && !seen_groups.insert(group.name.clone()) {
            return;
        }
        for item in &group.items {
            if group_names.contains(&item.name) {
                if let Some(next_group) = self.groups.iter().find(|group| group.name == item.name) {
                    self.collect_real_nodes(
                        next_group,
                        group_names,
                        seen_groups,
                        seen_nodes,
                        nodes,
                    );
                }
                continue;
            }
            let name = item.effective_name();
            if name.trim().is_empty() || item.is_builtin() || !seen_nodes.insert(name.to_string()) {
                continue;
            }
            nodes.push(item.clone());
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
struct ControllerProxyHistory {
    delay: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
struct ControllerProxyRecord {
    name: String,
    #[serde(rename = "type")]
    proxy_type: String,
    now: String,
    all: Vec<String>,
    alive: Option<bool>,
    delay: Option<i64>,
    history: Vec<ControllerProxyHistory>,
    udp: Option<bool>,
    xudp: Option<bool>,
    tfo: Option<bool>,
}

impl ControllerProxyRecord {
    fn is_group(&self) -> bool {
        matches!(
            self.proxy_type.as_str(),
            "Selector" | "URLTest" | "Fallback" | "LoadBalance" | "Relay"
        )
    }

    fn effective_delay(&self) -> i64 {
        self.delay
            .or_else(|| self.history.last().map(|item| item.delay))
            .unwrap_or(-1)
    }

    fn product_node(&self, fallback_name: &str) -> ProxyNodeSnapshot {
        let delay = self.effective_delay();
        ProxyNodeSnapshot {
            name: if self.name.trim().is_empty() {
                fallback_name.to_string()
            } else {
                self.name.clone()
            },
            protocol: if self.proxy_type.trim().is_empty() {
                "Unknown".to_string()
            } else {
                self.proxy_type.clone()
            },
            alive: self.alive.unwrap_or(delay >= 0),
            delay,
            udp: self.udp,
            xudp: self.xudp,
            tfo: self.tfo,
            ..ProxyNodeSnapshot::default()
        }
    }
}

fn missing_proxy_node(name: &str) -> ProxyNodeSnapshot {
    ProxyNodeSnapshot {
        name: name.to_string(),
        protocol: "Unknown".to_string(),
        alive: true,
        delay: -1,
        udp: None,
        xudp: None,
        tfo: None,
        ..ProxyNodeSnapshot::default()
    }
}

pub fn proxy_groups_from_controller(
    payload: &JsonValue,
    hidden_group_names: &[&str],
) -> Result<Vec<ProxyGroupSnapshot>, String> {
    let proxies = payload
        .get("proxies")
        .and_then(JsonValue::as_object)
        .ok_or_else(|| "Controller proxies response missing proxies object".to_string())?;
    let mut ordered = Vec::with_capacity(proxies.len());
    let mut by_name = HashMap::with_capacity(proxies.len());
    for (key, value) in proxies {
        let mut record: ControllerProxyRecord = serde_json::from_value(value.clone())
            .map_err(|err| format!("Controller proxy record '{key}' was invalid: {err}"))?;
        if record.name.trim().is_empty() {
            record.name = key.clone();
        }
        by_name.insert(key.clone(), record.clone());
        ordered.push(record);
    }

    Ok(ordered
        .into_iter()
        .filter(ControllerProxyRecord::is_group)
        .filter(|group| {
            !hidden_group_names
                .iter()
                .any(|hidden| group.name == *hidden)
        })
        .filter(|group| !group.all.is_empty())
        .map(|group| ProxyGroupSnapshot {
            name: group.name,
            strategy_type: if group.proxy_type.trim().is_empty() {
                "Selector".to_string()
            } else {
                group.proxy_type
            },
            now: group.now,
            test_url: String::new(),
            items: group
                .all
                .iter()
                .map(|name| {
                    by_name
                        .get(name)
                        .map(|record| record.product_node(name))
                        .unwrap_or_else(|| missing_proxy_node(name))
                })
                .collect(),
        })
        .collect())
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DelayProbeSnapshot {
    pub delay: i64,
    pub detail: String,
}

pub fn delay_probe_from_controller(payload: &JsonValue) -> Result<DelayProbeSnapshot, String> {
    if !payload.is_object() {
        return Err("Controller delay response was not an object".to_string());
    }
    Ok(DelayProbeSnapshot {
        delay: payload
            .get("delay")
            .and_then(JsonValue::as_i64)
            .unwrap_or(-1),
        detail: payload
            .get("message")
            .or_else(|| payload.get("error"))
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVersionSnapshot {
    pub version: String,
    pub meta: bool,
}

pub fn runtime_version_from_controller(
    payload: &JsonValue,
) -> Result<RuntimeVersionSnapshot, String> {
    if !payload.is_object() {
        return Err("Controller version response was not an object".to_string());
    }
    let version = payload
        .get("version")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .trim();
    if version.is_empty() {
        return Err("Controller version response did not include a version".to_string());
    }
    Ok(RuntimeVersionSnapshot {
        version: version.to_string(),
        meta: payload
            .get("meta")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false),
    })
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    pub id: String,
    pub target: String,
    pub rule: String,
    pub route: Vec<String>,
    pub upload: u64,
    pub download: u64,
    pub process: String,
    pub network: String,
    pub protocol: String,
}

fn text_field<'a>(value: &'a JsonValue, key: &str) -> &'a str {
    value.get(key).and_then(JsonValue::as_str).unwrap_or("")
}

pub fn connection_snapshots_from_controller<F>(
    payload: &JsonValue,
    sanitize: F,
) -> Result<Vec<ConnectionSnapshot>, String>
where
    F: Fn(&str) -> String,
{
    let items = payload
        .get("connections")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| "Controller connections response missing connections array".to_string())?;
    Ok(items
        .iter()
        .map(|item| {
            let metadata = item.get("metadata").unwrap_or(&JsonValue::Null);
            let id = sanitize(text_field(item, "id"));
            let host = text_field(metadata, "host");
            let destination = text_field(metadata, "destinationIP");
            let target = sanitize(if !host.trim().is_empty() {
                host
            } else if !destination.trim().is_empty() {
                destination
            } else {
                &id
            });
            let process = ["process", "processPath"]
                .iter()
                .find_map(|key| {
                    let value = text_field(metadata, key);
                    (!value.trim().is_empty()).then_some(value)
                })
                .map(&sanitize)
                .unwrap_or_default();
            let route = item
                .get("chains")
                .and_then(JsonValue::as_array)
                .into_iter()
                .flatten()
                .filter_map(JsonValue::as_str)
                .map(&sanitize)
                .filter(|value| !value.trim().is_empty())
                .collect::<Vec<_>>();
            ConnectionSnapshot {
                id,
                target: if target.trim().is_empty() {
                    "-".to_string()
                } else {
                    target
                },
                rule: {
                    let rule = sanitize(text_field(item, "rule"));
                    if rule.trim().is_empty() {
                        "MATCH".to_string()
                    } else {
                        rule
                    }
                },
                route,
                upload: item.get("upload").and_then(JsonValue::as_u64).unwrap_or(0),
                download: item
                    .get("download")
                    .and_then(JsonValue::as_u64)
                    .unwrap_or(0),
                process,
                network: sanitize(text_field(metadata, "network")),
                protocol: sanitize(text_field(metadata, "type")),
            }
        })
        .collect())
}

pub fn recent_rule_hits(
    connections: &[ConnectionSnapshot],
    limit: usize,
) -> Vec<(String, usize, String)> {
    let mut rows: Vec<(String, usize, String)> = Vec::new();
    for item in connections {
        let rule = if item.rule.trim().is_empty() {
            "MATCH".to_string()
        } else {
            item.rule.clone()
        };
        let route_text = if item.route.is_empty() {
            "-".to_string()
        } else {
            item.route.join(" > ")
        };
        if let Some((_, count, _)) = rows.iter_mut().find(|(existing, _, _)| existing == &rule) {
            *count += 1;
        } else {
            rows.push((rule, 1, route_text));
        }
    }
    rows.into_iter().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn identity(value: &str) -> String {
        value.to_string()
    }

    #[test]
    fn traffic_payload_is_normalized_into_aegos_snapshot() {
        let traffic = traffic_snapshot_from_controller_line(
            r#"{"up":12,"down":34,"upTotal":56,"downTotal":78,"ignored":true}"#,
        )
        .expect("traffic snapshot");
        assert_eq!(
            traffic,
            TrafficSnapshot {
                up: 12,
                down: 34,
                up_total: 56,
                down_total: 78,
            }
        );
    }

    #[test]
    fn partial_traffic_payload_uses_safe_defaults() {
        let traffic = traffic_snapshot_from_controller_line(r#"{"down":9}"#)
            .expect("partial traffic snapshot");
        assert_eq!(traffic.down, 9);
        assert_eq!(traffic.up, 0);
        assert_eq!(traffic.up_total, 0);
    }

    #[test]
    fn empty_or_invalid_traffic_payload_is_rejected_at_boundary() {
        assert!(traffic_snapshot_from_controller_line(" ").is_err());
        assert!(traffic_snapshot_from_controller_line("[]").is_err());
    }

    #[test]
    fn proxy_groups_keep_stable_map_order_and_normalize_latest_delay() {
        let payload = json!({
            "proxies": {
                "HK 01": {
                    "name": "HK 01", "type": "ss", "udp": true, "password": "must-not-leak",
                    "history": [{ "delay": 120 }, { "delay": 42 }]
                },
                "Proxies": {
                    "name": "Proxies", "type": "Selector", "now": "HK 01",
                    "all": ["HK 01", "Missing node"]
                },
                "Automatic": {
                    "name": "Automatic", "type": "URLTest", "now": "HK 01",
                    "all": ["HK 01"]
                }
            }
        });
        let groups = proxy_groups_from_controller(&payload, &[]).expect("proxy groups");
        assert_eq!(
            groups
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["Automatic", "Proxies"]
        );
        assert_eq!(groups[1].items[0].delay, 42);
        assert!(groups[1].items[0].alive);
        assert_eq!(groups[1].items[0].udp, Some(true));
        assert_eq!(groups[1].items[1], missing_proxy_node("Missing node"));
        let product = serde_json::to_value(&groups).expect("serialized product groups");
        assert_eq!(
            product
                .pointer("/1/items/0/type")
                .and_then(JsonValue::as_str),
            Some("ss")
        );
        assert!(product.pointer("/1/items/0/history").is_none());
        assert!(product.pointer("/1/items/0/password").is_none());
    }

    #[test]
    fn proxy_groups_hide_internal_and_empty_groups() {
        let payload = json!({
            "proxies": {
                "Node": { "name": "Node", "type": "trojan", "delay": 80 },
                "Visible": { "name": "Visible", "type": "Selector", "all": ["Node"] },
                "Hidden": { "name": "Hidden", "type": "Selector", "all": ["Node"] },
                "Empty": { "name": "Empty", "type": "Selector", "all": [] }
            }
        });
        let groups = proxy_groups_from_controller(&payload, &["Hidden"]).expect("proxy groups");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "Visible");
        assert_eq!(groups[0].items[0].delay, 80);
    }

    #[test]
    fn malformed_proxy_envelope_is_rejected_at_boundary() {
        assert!(proxy_groups_from_controller(&json!({ "proxies": [] }), &[]).is_err());
    }

    #[test]
    fn product_proxy_catalog_owns_defaults_selection_and_manual_metadata() {
        let input = json!([
            {
                "name": "Final",
                "type": "Selector",
                "now": "Automatic",
                "items": [
                    { "name": "Automatic", "type": "Group", "group": true },
                    { "name": "DIRECT", "type": "Direct", "builtin": true }
                ]
            },
            {
                "name": "Automatic",
                "type": "URLTest",
                "now": "HK 01",
                "testUrl": "https://example.com/generate_204",
                "items": [
                    {
                        "name": "HK 01",
                        "type": "ss",
                        "server": "hk.example.com",
                        "speedProtocol": "ss-obfs",
                        "password": "must-not-cross-product-boundary",
                        "history": [{ "delay": 20 }]
                    },
                    { "name": "JP 01", "type": "trojan", "server": "jp.example.com" }
                ]
            }
        ]);
        let mut catalog = ProxyCatalog::from_product_json(&input).expect("catalog");
        catalog.ensure_default_groups(
            |name| name.eq_ignore_ascii_case("Proxies"),
            |name| name == "Automatic",
            "Aegos Auto Select",
        );
        let selected = HashMap::from([
            ("Final".to_string(), "Automatic".to_string()),
            ("Automatic".to_string(), "JP 01".to_string()),
        ]);
        catalog.apply_selected_map(&selected);
        catalog.annotate_manual_nodes(&HashSet::from(["JP 01".to_string()]));
        let product = catalog.into_product_json();

        assert_eq!(
            product.pointer("/0/name").and_then(JsonValue::as_str),
            Some("Proxies")
        );
        let groups = product.as_array().expect("product groups");
        let final_group = groups
            .iter()
            .find(|group| group.get("name").and_then(JsonValue::as_str) == Some("Final"))
            .expect("Final group");
        assert_eq!(
            final_group
                .pointer("/items/0/realProxyName")
                .and_then(JsonValue::as_str),
            Some("JP 01")
        );
        let automatic = groups
            .iter()
            .find(|group| group.get("name").and_then(JsonValue::as_str) == Some("Automatic"))
            .expect("Automatic group");
        assert_eq!(
            automatic
                .pointer("/items/0/speedProtocol")
                .and_then(JsonValue::as_str),
            Some("ss-obfs")
        );
        assert_eq!(
            automatic
                .pointer("/items/1/source")
                .and_then(JsonValue::as_str),
            Some("manual")
        );
        assert!(automatic.pointer("/items/0/password").is_none());
        assert!(automatic.pointer("/items/0/history").is_none());
    }

    #[test]
    fn product_proxy_catalog_bounds_cyclic_group_resolution() {
        let input = json!([
            { "name": "A", "type": "Selector", "now": "B", "items": [{ "name": "B", "type": "Group" }] },
            { "name": "B", "type": "Selector", "now": "A", "items": [{ "name": "A", "type": "Group" }] }
        ]);
        let catalog = ProxyCatalog::from_product_json(&input).expect("catalog");
        assert!(matches!(
            catalog.resolve_leaf(&HashMap::new(), "A").as_str(),
            "A" | "B"
        ));
    }

    #[test]
    fn runtime_leaf_uses_controller_selection_instead_of_stale_preferences() {
        let input = json!([
            { "name": "Final", "type": "Selector", "now": "Proxies", "items": [{ "name": "Proxies", "type": "Group", "group": true }] },
            { "name": "Proxies", "type": "Selector", "now": "HK 01", "items": [{ "name": "HK", "type": "Group", "group": true }, { "name": "HK 01", "type": "Shadowsocks" }] },
            { "name": "HK", "type": "Selector", "now": "HK 02", "items": [{ "name": "HK 02", "type": "Shadowsocks" }] },
            { "name": "Aegos Landing IP", "type": "Selector", "now": "HK 01", "items": [{ "name": "HK 01", "type": "Shadowsocks" }, { "name": "HK 02", "type": "Shadowsocks" }] }
        ]);
        let catalog = ProxyCatalog::from_product_json(&input).expect("catalog");
        let stale = HashMap::from([("Proxies".to_string(), "HK".to_string())]);
        assert_eq!(catalog.resolve_leaf(&stale, "Final"), "HK 02");
        assert_eq!(
            catalog.resolve_runtime_leaf(&["GLOBAL", "Final", "Proxies"]),
            Some("HK 01".to_string())
        );
        assert!(catalog.group_contains_leaf("Aegos Landing IP", "HK 01"));
        assert!(!catalog.group_contains_leaf("Aegos Landing IP", "HK"));
    }

    #[test]
    fn product_proxy_catalog_rejects_non_array_envelopes() {
        assert!(ProxyCatalog::from_product_json(&json!({ "groups": [] })).is_err());
    }

    #[test]
    fn delay_probe_normalizes_success_and_failure_envelopes() {
        assert_eq!(
            delay_probe_from_controller(&json!({ "delay": 78 })).expect("delay success"),
            DelayProbeSnapshot {
                delay: 78,
                detail: String::new(),
            }
        );
        assert_eq!(
            delay_probe_from_controller(&json!({ "message": "tls handshake failed" }))
                .expect("delay failure"),
            DelayProbeSnapshot {
                delay: -1,
                detail: "tls handshake failed".to_string(),
            }
        );
        assert!(delay_probe_from_controller(&json!([])).is_err());
    }

    #[test]
    fn runtime_version_requires_a_typed_nonempty_version() {
        assert_eq!(
            runtime_version_from_controller(&json!({ "version": "v1.19.28", "meta": true }))
                .expect("runtime version"),
            RuntimeVersionSnapshot {
                version: "v1.19.28".to_string(),
                meta: true,
            }
        );
        assert!(runtime_version_from_controller(&json!({})).is_err());
        assert!(runtime_version_from_controller(&json!([])).is_err());
    }

    #[test]
    fn controller_metadata_is_normalized_into_aegos_fields() {
        let payload = json!({
            "connections": [{
                "id": "connection-1",
                "metadata": {
                    "host": "example.com",
                    "destinationIP": "203.0.113.10",
                    "process": "browser.exe",
                    "network": "tcp",
                    "type": "HTTPS"
                },
                "rule": "DomainSuffix",
                "chains": ["Proxies", "HK 01"],
                "upload": 12,
                "download": 34
            }]
        });
        let rows = connection_snapshots_from_controller(&payload, identity).expect("connections");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].target, "example.com");
        assert_eq!(rows[0].route, ["Proxies", "HK 01"]);
        assert_eq!(rows[0].upload, 12);
        assert_eq!(rows[0].process, "browser.exe");
    }

    #[test]
    fn destination_and_safe_defaults_cover_partial_controller_rows() {
        let payload = json!({
            "connections": [{
                "id": "connection-2",
                "metadata": { "destinationIP": "198.51.100.8" }
            }]
        });
        let rows = connection_snapshots_from_controller(&payload, identity).expect("connections");
        assert_eq!(rows[0].target, "198.51.100.8");
        assert_eq!(rows[0].rule, "MATCH");
        assert!(rows[0].route.is_empty());
    }

    #[test]
    fn malformed_envelope_is_rejected_at_the_core_boundary() {
        let error = connection_snapshots_from_controller(&json!({ "connections": {} }), identity)
            .expect_err("invalid envelope");
        assert!(error.contains("connections array"));
    }

    #[test]
    fn recent_hits_do_not_reprocess_normalized_sensitive_text() {
        let connections = vec![ConnectionSnapshot {
            rule: "DomainSuffix,example.com?token=[redacted]".to_string(),
            route: vec!["HK password=[redacted]".to_string()],
            ..ConnectionSnapshot::default()
        }];
        let rows = recent_rule_hits(&connections, 10);
        assert_eq!(
            rows,
            vec![(
                "DomainSuffix,example.com?token=[redacted]".to_string(),
                1,
                "HK password=[redacted]".to_string()
            )]
        );
    }
}
