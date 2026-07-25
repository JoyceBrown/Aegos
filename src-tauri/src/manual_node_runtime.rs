use super::*;

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

fn dialer_proxy_groups(profile: &Profile, node_name: &str) -> Result<Vec<String>, String> {
    let raw = fs::read_to_string(&profile.path)
        .map_err(|err| format!("Fixed node relay groups could not be read: {err}"))?;
    let config: YamlValue = serde_yaml::from_str(&raw)
        .map_err(|err| format!("Fixed node relay groups could not be parsed: {err}"))?;
    let groups = yaml_sequence(&config, "proxy-groups")
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(|item| {
            let map = item.as_mapping()?;
            let name = map.get(yaml_key("name"))?.as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let group_type = map
                .get(yaml_key("type"))
                .and_then(YamlValue::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            let members = map
                .get(yaml_key("proxies"))
                .and_then(YamlValue::as_sequence)
                .into_iter()
                .flat_map(|items| items.iter())
                .filter_map(YamlValue::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            Some((name, group_type, members))
        })
        .collect::<Vec<_>>();

    // A fixed node is inserted into the primary selection group. That group,
    // groups containing this node, and their dependants would create a cycle.
    let mut forbidden = HashSet::new();
    if let Some((name, _, _)) = groups.iter().find(|(name, group_type, _)| {
        matches!(name.as_str(), "GLOBAL" | "Proxies" | "Proxy")
            || matches!(
                group_type.as_str(),
                "select" | "url-test" | "fallback" | "load-balance"
            )
    }) {
        forbidden.insert(name.clone());
    }
    for (name, _, members) in &groups {
        if members.iter().any(|member| member == node_name) {
            forbidden.insert(name.clone());
        }
    }
    loop {
        let before = forbidden.len();
        for (name, _, members) in &groups {
            if members.iter().any(|member| forbidden.contains(member)) {
                forbidden.insert(name.clone());
            }
        }
        if forbidden.len() == before {
            break;
        }
    }

    Ok(groups
        .into_iter()
        .map(|(name, _, _)| name)
        .filter(|name| !forbidden.contains(name))
        .collect())
}

impl CoreManager {
    pub(super) fn manual_node_editor(&self, name: &str) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "Import or enable a profile before editing a fixed node.".to_string())?;
        let name = name.trim();
        let node = if name.is_empty() {
            JsonValue::Null
        } else {
            let node = self
                .settings
                .manual_nodes
                .get(&profile.id)
                .and_then(|nodes| nodes.get(name))
                .ok_or_else(|| format!("Fixed node no longer exists: {name}"))?;
            serde_json::to_value(node)
                .map_err(|err| format!("Fixed node editor data could not be prepared: {err}"))?
        };
        let dialer_proxy_groups = dialer_proxy_groups(&profile, name)?;
        Ok(json!({
            "node": node,
            "profileId": profile.id,
            "dialerProxyGroups": dialer_proxy_groups
        }))
    }

    pub(super) fn save_manual_node(&mut self, input: JsonValue) -> Result<JsonValue, String> {
        let profile = self
            .active_profile()
            .ok_or_else(|| "Import or enable a profile before adding a fixed node.".to_string())?;
        let node = normalize_manual_node(&input)?;
        let name = node
            .product_json()
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Fixed node name is required.".to_string())?
            .to_string();
        let original_name = input
            .get("originalName")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let dialer_proxy = input
            .get("dialer-proxy")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .trim();
        if !dialer_proxy.is_empty()
            && !dialer_proxy_groups(&profile, &name)?
                .iter()
                .any(|group| group == dialer_proxy)
        {
            return Err(format!(
                "The selected fixed node relay group is unavailable or would create a loop: {dialer_proxy}"
            ));
        }
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
                let message = match rollback_runtime {
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
        Ok(json!({
            "node": node.product_json(),
            "profileId": profile.id,
            "settings": self.public_settings()
        }))
    }

    pub(super) fn delete_manual_node(&mut self, name: &str) -> Result<JsonValue, String> {
        let profile = self.active_profile().ok_or_else(|| {
            "Import or enable a profile before deleting a fixed node.".to_string()
        })?;
        let name = name.trim();
        if name.is_empty() {
            return Err("Fixed node name is required.".to_string());
        }
        let previous_settings = self.settings.clone();
        let profile_nodes = self
            .settings
            .manual_nodes
            .get_mut(&profile.id)
            .ok_or_else(|| format!("Fixed node no longer exists: {name}"))?;
        if profile_nodes.remove(name).is_none() {
            return Err(format!("Fixed node no longer exists: {name}"));
        }
        if profile_nodes.is_empty() {
            self.settings.manual_nodes.remove(&profile.id);
        }
        let mut deployment = match self.stage_settings_deployment("Fixed node delete") {
            Ok(deployment) => deployment,
            Err(err) => {
                self.settings = previous_settings;
                return Err(format!(
                    "Fixed node delete candidate preparation failed: {err}"
                ));
            }
        };
        if let Err(err) = deployment.promote() {
            self.settings = previous_settings;
            return Err(format!(
                "Fixed node delete candidate promotion failed: {err}"
            ));
        }
        let runtime_was_active =
            self.process.is_some() && self.settings.active_profile_id == profile.id;
        if runtime_was_active {
            if let Err(err) = self.hot_reload_profile(&profile) {
                self.settings = previous_settings.clone();
                let rollback_runtime = deployment
                    .rollback_with_runtime("fixed node delete runtime reload failed", || {
                        self.hot_reload_profile(&profile).map(|_| ())
                    });
                let message = match rollback_runtime {
                    Ok(_) => format!("Fixed node delete hot reload failed; settings and runtime were rolled back: {err}"),
                    Err(rollback_err) => format!("Fixed node delete hot reload failed: {err}; rollback also failed: {rollback_err}"),
                };
                self.add_log(&message, "error");
                return Err(message);
            }
        }
        let _ = deployment.complete_verified(
            "Fixed node deletion promoted and active runtime verification completed.",
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
            format!("Manual fixed node deleted: {} / {}", profile.name, name),
            "info",
        );
        Ok(json!({
            "deleted": name,
            "profileId": profile.id,
            "settings": self.public_settings()
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fixture(name: &str, content: &str) -> PathBuf {
        let root = std::env::temp_dir();
        let path = root.join(format!("{name}-{}.yaml", hex_random(8)));
        atomic_write_text_confined(&path, &root, content).expect("fixture write");
        path
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
    fn dialer_groups_exclude_insertion_group_and_dependents() {
        let root = std::env::temp_dir();
        let path = write_fixture(
            "aegos-fixed-node-dialer-groups",
            "proxies:\n  - name: HK 01\n    type: ss\n    server: hk.example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: fixture\nproxy-groups:\n  - name: Proxies\n    type: select\n    proxies: [HK 01]\n  - name: HK Relay\n    type: select\n    proxies: [HK 01]\n  - name: Chained Primary\n    type: select\n    proxies: [Proxies]\nrules: [MATCH,Proxies]\n",
        );
        let profile = Profile {
            id: "test".to_string(),
            name: "Test".to_string(),
            profile_type: "file".to_string(),
            path: path.to_string_lossy().to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 3,
            rule_count: 0,
            source_format: "test".to_string(),
            subscription_usage: Default::default(),
            updated_at: "now".to_string(),
            digest: "digest".to_string(),
        };
        assert_eq!(
            dialer_proxy_groups(&profile, "Fixed US").unwrap(),
            vec!["HK Relay"]
        );
        remove_file_confined(&path, &root).expect("fixture cleanup");
    }

    #[test]
    fn standby_snapshot_restores_persisted_manual_nodes() {
        let root = std::env::temp_dir();
        let path = write_fixture(
            "aegos-manual-snapshot",
            "proxies:\n  - name: Subscription Node\n    type: ss\n    server: subscription.example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: fixture\nproxy-groups:\n  - name: Proxies\n    type: select\n    proxies: [Subscription Node]\nrules: [MATCH,Proxies]\n",
        );
        let profile = Profile {
            id: "manual-snapshot".to_string(),
            name: "Manual snapshot".to_string(),
            profile_type: "url".to_string(),
            path: path.to_string_lossy().to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            rule_count: 0,
            source_format: "test".to_string(),
            subscription_usage: Default::default(),
            updated_at: "test".to_string(),
            digest: "test".to_string(),
        };
        let manual = ManualNodeConfig::from_input(
            &json!({
                "name": "Fixed SOCKS5",
                "server": "198.51.100.10",
                "port": 1080,
                "username": "fixture-user",
                "password": "fixture-password"
            }),
            "socks5".to_string(),
        )
        .expect("manual node");
        let manual_nodes = HashMap::from([(manual.name.clone(), manual)]);
        let groups = profile_proxy_groups_for_profile_snapshot(
            &profile,
            &HashMap::new(),
            true,
            &manual_nodes,
        )
        .expect("standby catalog");
        let item = groups
            .as_array()
            .and_then(|groups| groups.first())
            .and_then(|group| group.get("items"))
            .and_then(JsonValue::as_array)
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("name").and_then(JsonValue::as_str) == Some("Fixed SOCKS5")
                })
            })
            .expect("manual node restored into standby catalog");
        assert_eq!(
            item.get("server").and_then(JsonValue::as_str),
            Some("198.51.100.10")
        );
        let catalog = core_runtime::shape_proxy_catalog_model(
            ProxyCatalog::from_product_json(&groups).expect("product catalog"),
            &HashMap::new(),
            &HashSet::from(["Fixed SOCKS5".to_string()]),
        );
        let product = catalog.into_product_json();
        let restored = product
            .as_array()
            .and_then(|groups| groups.first())
            .and_then(|group| group.get("items"))
            .and_then(JsonValue::as_array)
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("name").and_then(JsonValue::as_str) == Some("Fixed SOCKS5")
                })
            })
            .expect("manual product node");
        assert_eq!(
            restored.get("manual").and_then(JsonValue::as_bool),
            Some(true)
        );
        remove_file_confined(&path, &root).expect("fixture cleanup");
    }
}
