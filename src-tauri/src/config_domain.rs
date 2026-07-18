use serde::{Deserialize, Serialize};
use serde_json::{json, Map as JsonMap, Value as JsonValue};
use serde_yaml::Value as YamlValue;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProxy {
    pub name: String,
    pub protocol: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGroup {
    pub name: String,
    pub strategy_type: String,
    pub members: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCatalogSummary {
    pub profile_id: String,
    pub profile_name: String,
    pub profile_type: String,
    pub proxy_count: usize,
    pub proxy_group_count: usize,
    pub rule_count: usize,
}

#[derive(Clone, Debug)]
pub struct ProfileCatalog {
    config: YamlValue,
    proxies: Vec<CatalogProxy>,
    groups: Vec<CatalogGroup>,
    summary: ProfileCatalogSummary,
}

impl ProfileCatalog {
    pub fn from_yaml(
        config: YamlValue,
        profile_id: &str,
        profile_name: &str,
        profile_type: &str,
    ) -> Result<Self, String> {
        if !config.is_mapping() {
            return Err("Profile catalog root must be a YAML object".to_string());
        }
        let proxies = yaml_sequence(&config, "proxies")
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let map = item.as_mapping()?;
                Some(CatalogProxy {
                    name: map
                        .get(yaml_key("name"))
                        .and_then(YamlValue::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                    protocol: map
                        .get(yaml_key("type"))
                        .and_then(YamlValue::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                })
            })
            .collect::<Vec<_>>();
        let groups = yaml_sequence(&config, "proxy-groups")
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let map = item.as_mapping()?;
                Some(CatalogGroup {
                    name: map
                        .get(yaml_key("name"))
                        .and_then(YamlValue::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                    strategy_type: map
                        .get(yaml_key("type"))
                        .and_then(YamlValue::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                    members: map
                        .get(yaml_key("proxies"))
                        .and_then(YamlValue::as_sequence)
                        .into_iter()
                        .flatten()
                        .filter_map(YamlValue::as_str)
                        .map(str::to_string)
                        .collect(),
                })
            })
            .collect::<Vec<_>>();
        let rule_count = yaml_sequence(&config, "rules")
            .map(Vec::len)
            .unwrap_or_default();
        Ok(Self {
            config,
            summary: ProfileCatalogSummary {
                profile_id: profile_id.to_string(),
                profile_name: profile_name.to_string(),
                profile_type: profile_type.to_string(),
                proxy_count: proxies.len(),
                proxy_group_count: groups.len(),
                rule_count,
            },
            proxies,
            groups,
        })
    }

    pub fn config(&self) -> &YamlValue {
        &self.config
    }

    pub fn proxies(&self) -> &[CatalogProxy] {
        &self.proxies
    }

    pub fn groups(&self) -> &[CatalogGroup] {
        &self.groups
    }

    pub fn summary(&self) -> &ProfileCatalogSummary {
        &self.summary
    }

    pub fn summary_json(&self) -> JsonValue {
        serde_json::to_value(&self.summary).unwrap_or_else(|_| json!({}))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RuntimeConfigReport {
    pub ok: bool,
    pub profile: String,
    pub proxies: usize,
    pub proxy_groups: usize,
    pub rules: usize,
    pub mixed_port: u16,
    pub controller_port: u16,
    pub protocol_capabilities: JsonValue,
}

impl RuntimeConfigReport {
    pub fn to_json(&self) -> JsonValue {
        serde_json::to_value(self).unwrap_or_else(|_| json!({}))
    }
}

fn default_manual_udp() -> bool {
    true
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct ManualNodeConfig {
    pub name: String,
    #[serde(rename = "type")]
    pub protocol: String,
    pub server: String,
    pub port: u16,
    #[serde(default = "default_manual_udp")]
    pub udp: bool,
    #[serde(flatten)]
    options: JsonMap<String, JsonValue>,
}

impl ManualNodeConfig {
    pub fn from_input(input: &JsonValue, normalized_protocol: String) -> Result<Self, String> {
        let map = input
            .as_object()
            .ok_or_else(|| "Manual node must be an object".to_string())?;
        let name = text_value(map, "name");
        let server = text_value(map, "server");
        let port = map
            .get("port")
            .and_then(JsonValue::as_u64)
            .or_else(|| {
                map.get("port")
                    .and_then(JsonValue::as_str)
                    .and_then(|value| value.trim().parse::<u64>().ok())
            })
            .ok_or_else(|| "Manual node port is required".to_string())?;
        if name.is_empty() {
            return Err("Manual node name is required".to_string());
        }
        if server.is_empty() {
            return Err("Manual node server is required".to_string());
        }
        if port == 0 || port > u64::from(u16::MAX) {
            return Err("Manual node port must be between 1 and 65535".to_string());
        }
        let mut options = JsonMap::new();
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
                    options.insert(key.to_string(), value.clone());
                }
            }
        }
        if let Some(value) = map.get("tls").and_then(JsonValue::as_bool) {
            options.insert("tls".to_string(), JsonValue::Bool(value));
        }
        Ok(Self {
            name,
            protocol: normalized_protocol,
            server,
            port: port as u16,
            udp: map.get("udp").and_then(JsonValue::as_bool).unwrap_or(true),
            options,
        })
    }

    pub fn runtime_yaml(&self) -> Result<YamlValue, String> {
        let mut value = serde_json::to_value(self).map_err(|err| err.to_string())?;
        let map = value
            .as_object_mut()
            .ok_or_else(|| "Manual node serialization did not produce an object".to_string())?;
        for key in [
            "manual",
            "fixed",
            "static",
            "residential",
            "source",
            "profileType",
            "originalName",
        ] {
            map.remove(key);
        }
        serde_yaml::to_value(value).map_err(|err| err.to_string())
    }

    pub fn product_json(&self) -> JsonValue {
        let mut value = self
            .runtime_yaml()
            .and_then(|runtime| serde_json::to_value(runtime).map_err(|err| err.to_string()))
            .unwrap_or_else(|_| json!({}));
        if let Some(map) = value.as_object_mut() {
            map.insert("manual".to_string(), JsonValue::Bool(true));
            map.insert("fixed".to_string(), JsonValue::Bool(true));
            map.insert("static".to_string(), JsonValue::Bool(true));
            map.insert("source".to_string(), json!("manual"));
        }
        value
    }
}

pub fn is_subscription_metadata_node_name(name: &str) -> bool {
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

fn text_value(map: &JsonMap<String, JsonValue>, key: &str) -> String {
    map.get(key)
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn yaml_key(name: &str) -> YamlValue {
    YamlValue::String(name.to_string())
}

fn yaml_sequence<'a>(config: &'a YamlValue, key: &str) -> Option<&'a Vec<YamlValue>> {
    config.get(yaml_key(key)).and_then(YamlValue::as_sequence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_catalog_extracts_only_product_metadata() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: HK 01
    type: ss
    server: hk.example.com
    password: must-not-leak
proxy-groups:
  - name: Proxies
    type: select
    proxies: [HK 01, DIRECT]
rules:
  - MATCH,Proxies
"#,
        )
        .expect("source");
        let catalog =
            ProfileCatalog::from_yaml(source, "test", "Test", "url").expect("profile catalog");
        assert_eq!(catalog.proxies()[0].name, "HK 01");
        assert_eq!(catalog.groups()[0].members, ["HK 01", "DIRECT"]);
        assert_eq!(catalog.summary().rule_count, 1);
        let summary = catalog.summary_json().to_string();
        assert!(!summary.contains("must-not-leak"));
        assert!(!summary.contains("hk.example.com"));
    }

    #[test]
    fn profile_catalog_rejects_non_mapping_root() {
        assert!(
            ProfileCatalog::from_yaml(YamlValue::Sequence(Vec::new()), "test", "Test", "url")
                .is_err()
        );
    }

    #[test]
    fn manual_node_model_separates_runtime_fields_from_product_metadata() {
        let input = json!({
            "name": "Fixed TUIC",
            "type": "tuic",
            "server": "tuic.example.com",
            "port": "443",
            "uuid": "00000000-0000-4000-8000-000000000000",
            "tls": true,
            "manual": true,
            "fixed": true,
            "source": "manual"
        });
        let node =
            ManualNodeConfig::from_input(&input, "tuic".to_string()).expect("manual node model");
        let runtime = serde_yaml::to_string(&node.runtime_yaml().expect("runtime YAML"))
            .expect("runtime text");
        assert!(runtime.contains("uuid:"));
        assert!(!runtime.contains("manual:"));
        assert!(!runtime.contains("fixed:"));
        assert!(!runtime.contains("source:"));
        let product = node.product_json();
        assert_eq!(
            product.get("manual").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(product.get("port").and_then(JsonValue::as_u64), Some(443));
    }

    #[test]
    fn old_manual_node_metadata_is_filtered_when_settings_are_loaded() {
        let node: ManualNodeConfig = serde_json::from_value(json!({
            "name": "Legacy",
            "type": "ss",
            "server": "legacy.example.com",
            "port": 443,
            "password": "secret",
            "manual": true,
            "fixed": true,
            "static": true,
            "source": "manual"
        }))
        .expect("legacy settings node");
        let runtime = serde_yaml::to_string(&node.runtime_yaml().expect("runtime YAML"))
            .expect("runtime text");
        assert!(runtime.contains("password: secret"));
        assert!(!runtime.contains("manual:"));
        assert!(!runtime.contains("fixed:"));
        assert!(!runtime.contains("static:"));
        assert!(!runtime.contains("source:"));
    }
}
