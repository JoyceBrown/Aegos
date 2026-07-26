use std::collections::{HashMap, HashSet};

use serde_yaml::{Mapping, Value as YamlValue};

use crate::{
    app_config::{Profile, Settings},
    config_domain::{ManualNodeConfig, ProfileCatalog, RuntimeConfigReport},
    config_extensions, core_runtime, routing_domain, subscription_runtime, AEGOS_OUTBOUND_IP_GROUP,
    OUTBOUND_IP_RULE_DOMAINS,
};

pub(crate) struct RuntimeConfigPlan {
    pub(crate) catalog: ProfileCatalog,
    pub(crate) validation: RuntimeConfigReport,
}

pub(crate) const AEGOS_DNS_LISTEN: &str = "127.0.0.1:1054";
const AEGOS_BOOTSTRAP_NAMESERVERS: [&str; 3] = [
    "https://223.5.5.5/dns-query",
    "https://1.1.1.1/dns-query",
    "tls://8.8.8.8:853",
];
const AEGOS_REMOTE_NAMESERVERS: [&str; 2] =
    ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"];

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

fn terminal_rule_group_name(config: &Mapping, groups: &[String]) -> Option<String> {
    config
        .get(yaml_key("rules"))
        .and_then(YamlValue::as_sequence)
        .into_iter()
        .flatten()
        .rev()
        .filter_map(YamlValue::as_str)
        .find_map(|rule| {
            let mut fields = rule.split(',').map(str::trim);
            let kind = fields.next()?;
            let target = fields.next()?;
            (kind.eq_ignore_ascii_case("MATCH") && groups.iter().any(|group| group == target))
                .then(|| target.to_string())
        })
}

pub(crate) fn outbound_ip_primary_group_name(
    config: &Mapping,
    settings: &Settings,
) -> Option<String> {
    let groups = proxy_group_names(config);
    if !settings.mode.eq_ignore_ascii_case("global") {
        if let Some(group) = terminal_rule_group_name(config, &groups) {
            return Some(group);
        }
    }
    for preferred in ["GLOBAL", "Final", "Proxy"] {
        if groups.iter().any(|name| name == preferred) {
            return Some(preferred.to_string());
        }
    }
    for group in &groups {
        if settings.selected_proxy_map.contains_key(group) {
            return Some(group.clone());
        }
    }
    if groups.iter().any(|name| name == "Proxies") {
        return Some("Proxies".to_string());
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

fn sanitize_subscription_metadata_nodes(config: &mut Mapping) -> usize {
    let mut removed = HashSet::new();
    if let Some(YamlValue::Sequence(proxies)) = config.get_mut(yaml_key("proxies")) {
        proxies.retain(|proxy| {
            let keep = proxy
                .as_mapping()
                .and_then(|map| map.get(yaml_key("name")))
                .and_then(|value| value.as_str())
                .map(|name| !crate::config_domain::is_subscription_metadata_node_name(name))
                .unwrap_or(true);
            if !keep {
                if let Some(name) = proxy
                    .as_mapping()
                    .and_then(|map| map.get(yaml_key("name")))
                    .and_then(|value| value.as_str())
                {
                    removed.insert(name.to_string());
                }
            }
            keep
        });
    }
    if removed.is_empty() {
        return 0;
    }
    if let Some(YamlValue::Sequence(groups)) = config.get_mut(yaml_key("proxy-groups")) {
        for group in groups {
            let Some(map) = group.as_mapping_mut() else {
                continue;
            };
            if let Some(YamlValue::Sequence(items)) = map.get_mut(yaml_key("proxies")) {
                items.retain(|item| {
                    item.as_str()
                        .map(|name| !removed.contains(name))
                        .unwrap_or(true)
                });
            }
        }
    }
    removed.len()
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
    node: &ManualNodeConfig,
    original_name: Option<&str>,
) -> Result<(), String> {
    let name = node.name.as_str();
    let original = original_name.unwrap_or(name);
    let proxy = node.runtime_yaml()?;
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
    apply_manual_nodes_to_catalog(config, nodes)
}

pub(crate) fn apply_manual_nodes_to_catalog(
    config: &mut Mapping,
    nodes: &HashMap<String, ManualNodeConfig>,
) -> Result<(), String> {
    for node in nodes.values() {
        insert_manual_node_into_config(config, node, None)?;
    }
    Ok(())
}

pub(crate) fn fixed_node_is_selected(
    config: &Mapping,
    settings: &Settings,
    profile_id: Option<&str>,
) -> bool {
    let Some(manual_nodes) = profile_id.and_then(|id| settings.manual_nodes.get(id)) else {
        return false;
    };
    let groups = config
        .get(yaml_key("proxy-groups"))
        .and_then(YamlValue::as_sequence)
        .cloned()
        .unwrap_or_default();
    outbound_ip_primary_group_name(config, settings)
        .map(|group| resolve_yaml_group_leaf(&groups, settings, &group, 0))
        .is_some_and(|selected| manual_nodes.contains_key(&selected))
}

pub(crate) fn patch_config(
    source: YamlValue,
    settings: &Settings,
    profile_id: Option<&str>,
) -> Result<YamlValue, String> {
    let mut config = match source {
        YamlValue::Mapping(map) => map,
        _ => Mapping::new(),
    };
    config_extensions::apply_to_runtime(&mut config, settings)?;
    if let Some(profile_id) = profile_id {
        apply_manual_nodes(&mut config, settings, profile_id)?;
    }
    let strict_fixed_dns = fixed_node_is_selected(&config, settings, profile_id);
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
    harden_runtime_dns(&mut config, settings, strict_fixed_dns)?;
    sanitize_subscription_metadata_nodes(&mut config);

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
        set_yaml(tun_map, "device", YamlValue::String("Aegos".to_string()));
        set_yaml(
            tun_map,
            "dns-hijack",
            if settings.dns_mode == "secure"
                || (settings.dns_mode != "system"
                    && (settings.dns_hijack_enabled || strict_fixed_dns))
            {
                YamlValue::Sequence(vec![YamlValue::String("any:53".to_string())])
            } else {
                YamlValue::Sequence(Vec::new())
            },
        );
    } else if let Some(tun) = config.get_mut(yaml_key("tun")) {
        set_yaml(get_mapping_mut(tun), "enable", YamlValue::Bool(false));
    }

    let proxy_name_strings = proxy_node_names(&config);
    let proxy_names: Vec<YamlValue> = proxy_name_strings
        .iter()
        .map(|name| yaml_str(name))
        .collect();
    normalize_runtime_proxy_groups_for_display(&mut config);

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

pub(crate) fn patch_direct_profile(settings: &Settings) -> Result<YamlValue, String> {
    patch_config(
        YamlValue::Mapping(Default::default()),
        settings,
        Some("direct"),
    )
}

fn yaml_key(key: &str) -> YamlValue {
    YamlValue::String(key.to_string())
}

fn yaml_str(value: impl Into<String>) -> YamlValue {
    YamlValue::String(value.into())
}

fn yaml_string_sequence<T: AsRef<str>>(values: &[T]) -> YamlValue {
    YamlValue::Sequence(
        values
            .iter()
            .map(|value| YamlValue::String(value.as_ref().to_string()))
            .collect(),
    )
}

fn yaml_string_values(values: &[String]) -> YamlValue {
    YamlValue::Sequence(values.iter().map(|value| yaml_str(value)).collect())
}

fn set_yaml(config: &mut Mapping, key: &str, value: YamlValue) {
    config.insert(yaml_key(key), value);
}

fn get_mapping_mut(value: &mut YamlValue) -> &mut Mapping {
    if !matches!(value, YamlValue::Mapping(_)) {
        *value = YamlValue::Mapping(Mapping::new());
    }
    value.as_mapping_mut().expect("mapping")
}

fn yaml_mapping_name(value: &YamlValue) -> Option<&str> {
    value
        .as_mapping()
        .and_then(|map| map.get(yaml_key("name")))
        .and_then(YamlValue::as_str)
}

fn select_proxy_group(name: &str, values: &[String]) -> YamlValue {
    let mut group = Mapping::new();
    set_yaml(&mut group, "name", yaml_str(name));
    set_yaml(&mut group, "type", yaml_str("select"));
    set_yaml(&mut group, "proxies", yaml_string_values(values));
    YamlValue::Mapping(group)
}

fn url_test_proxy_group(name: &str, values: &[String]) -> YamlValue {
    let mut group = Mapping::new();
    set_yaml(&mut group, "name", yaml_str(name));
    set_yaml(&mut group, "type", yaml_str("url-test"));
    set_yaml(
        &mut group,
        "url",
        yaml_str("https://www.gstatic.com/generate_204"),
    );
    set_yaml(&mut group, "interval", YamlValue::Number(300.into()));
    set_yaml(&mut group, "lazy", YamlValue::Bool(true));
    set_yaml(&mut group, "proxies", yaml_string_values(values));
    YamlValue::Mapping(group)
}

fn proxy_node_names(config: &Mapping) -> Vec<String> {
    config
        .get(yaml_key("proxies"))
        .and_then(YamlValue::as_sequence)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get(yaml_key("name"))
                        .and_then(YamlValue::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn is_internal_proxy_group_name(name: &str) -> bool {
    name == crate::AEGOS_OUTBOUND_IP_GROUP || name.eq_ignore_ascii_case("GLOBAL")
}

fn synthesize_default_proxy_groups_if_needed(config: &mut Mapping, proxy_names: &[String]) {
    if proxy_names.is_empty() {
        return;
    }
    let existing_groups = config
        .get(yaml_key("proxy-groups"))
        .and_then(YamlValue::as_sequence)
        .cloned()
        .unwrap_or_default();
    let visible_count = existing_groups
        .iter()
        .filter(|group| {
            yaml_mapping_name(group)
                .map(|name| !is_internal_proxy_group_name(name))
                .unwrap_or(false)
        })
        .count();
    if visible_count > 1 {
        return;
    }
    let mut all_with_direct = proxy_names.to_vec();
    all_with_direct.push("DIRECT".to_string());
    if visible_count == 1 {
        // A single subscription-defined group can be the target of its own
        // rules. Keep it intact and add Aegos' default route alongside it;
        // replacing it leaves a syntactically accepted but unrunnable config.
        if existing_groups
            .iter()
            .any(|group| yaml_mapping_name(group) == Some("GLOBAL"))
        {
            return;
        }
        let mut groups = existing_groups;
        let insert_index = groups
            .iter()
            .position(|group| {
                yaml_mapping_name(group)
                    .map(is_internal_proxy_group_name)
                    .unwrap_or(false)
            })
            .unwrap_or(0);
        groups.insert(insert_index, select_proxy_group("GLOBAL", &all_with_direct));
        set_yaml(config, "proxy-groups", YamlValue::Sequence(groups));
        return;
    }
    set_yaml(
        config,
        "proxy-groups",
        YamlValue::Sequence(vec![
            select_proxy_group("GLOBAL", &all_with_direct),
            select_proxy_group("Proxies", &all_with_direct),
        ]),
    );
}

fn ensure_proxies_group_contains_all_nodes(config: &mut Mapping, proxy_names: &[String]) {
    if proxy_names.is_empty() {
        return;
    }
    let mut all_with_direct = proxy_names.to_vec();
    all_with_direct.push("DIRECT".to_string());
    let groups = config
        .entry(yaml_key("proxy-groups"))
        .or_insert_with(|| YamlValue::Sequence(Vec::new()));
    if !matches!(groups, YamlValue::Sequence(_)) {
        *groups = YamlValue::Sequence(Vec::new());
    }
    let Some(groups) = groups.as_sequence_mut() else {
        return;
    };
    let Some(index) = groups.iter().position(|group| {
        yaml_mapping_name(group)
            .map(core_runtime::is_proxies_group_name)
            .unwrap_or(false)
    }) else {
        let insert_index = groups
            .iter()
            .position(|group| {
                yaml_mapping_name(group)
                    .map(is_internal_proxy_group_name)
                    .unwrap_or(false)
            })
            .map(|index| index.saturating_add(1))
            .unwrap_or(0);
        groups.insert(
            insert_index,
            select_proxy_group("Proxies", &all_with_direct),
        );
        return;
    };
    let Some(map) = groups[index].as_mapping_mut() else {
        groups[index] = select_proxy_group("Proxies", &all_with_direct);
        return;
    };
    set_yaml(map, "type", yaml_str("select"));
    let list = map
        .entry(yaml_key("proxies"))
        .or_insert_with(|| YamlValue::Sequence(Vec::new()));
    if !matches!(list, YamlValue::Sequence(_)) {
        *list = YamlValue::Sequence(Vec::new());
    }
    let Some(items) = list.as_sequence_mut() else {
        return;
    };
    let mut seen = items
        .iter()
        .filter_map(YamlValue::as_str)
        .map(str::to_string)
        .collect::<HashSet<_>>();
    for name in all_with_direct {
        if seen.insert(name.clone()) {
            items.push(yaml_str(name));
        }
    }
}

fn ensure_auto_select_group_contains_all_nodes(config: &mut Mapping, proxy_names: &[String]) {
    if proxy_names.len() < 2 {
        return;
    }
    let groups = config
        .entry(yaml_key("proxy-groups"))
        .or_insert_with(|| YamlValue::Sequence(Vec::new()));
    if !matches!(groups, YamlValue::Sequence(_)) {
        *groups = YamlValue::Sequence(Vec::new());
    }
    let Some(groups) = groups.as_sequence_mut() else {
        return;
    };
    let matching_indices = groups
        .iter()
        .enumerate()
        .filter_map(|(index, group)| {
            yaml_mapping_name(group)
                .filter(|name| core_runtime::is_aegos_auto_select_group_name(name))
                .map(|_| index)
        })
        .collect::<Vec<_>>();
    let Some(index) = matching_indices.first().copied() else {
        let insert_index = groups
            .iter()
            .position(|group| {
                yaml_mapping_name(group)
                    .map(core_runtime::is_proxies_group_name)
                    .unwrap_or(false)
            })
            .map(|index| index.saturating_add(1))
            .unwrap_or(0);
        groups.insert(
            insert_index,
            url_test_proxy_group(core_runtime::AEGOS_AUTO_SELECT_GROUP_NAME, proxy_names),
        );
        return;
    };
    for duplicate_index in matching_indices.into_iter().skip(1).rev() {
        groups.remove(duplicate_index);
    }
    let Some(map) = groups[index].as_mapping_mut() else {
        groups[index] =
            url_test_proxy_group(core_runtime::AEGOS_AUTO_SELECT_GROUP_NAME, proxy_names);
        return;
    };
    set_yaml(
        map,
        "name",
        yaml_str(core_runtime::AEGOS_AUTO_SELECT_GROUP_NAME),
    );
    set_yaml(map, "type", yaml_str("url-test"));
    set_yaml(map, "url", yaml_str("https://www.gstatic.com/generate_204"));
    set_yaml(map, "interval", YamlValue::Number(300.into()));
    set_yaml(map, "lazy", YamlValue::Bool(true));
    set_yaml(map, "proxies", yaml_string_values(proxy_names));
}

pub(crate) fn normalize_runtime_proxy_groups_for_display(config: &mut Mapping) {
    let proxy_names = proxy_node_names(config);
    let proxy_values = proxy_names
        .iter()
        .map(|name| yaml_str(name))
        .collect::<Vec<_>>();
    let has_proxy_group = matches!(
        config.get(yaml_key("proxy-groups")),
        Some(YamlValue::Sequence(items)) if !items.is_empty()
    );
    if !proxy_values.is_empty() && !has_proxy_group {
        let mut group = Mapping::new();
        set_yaml(&mut group, "name", yaml_str("GLOBAL"));
        set_yaml(&mut group, "type", yaml_str("select"));
        set_yaml(&mut group, "proxies", YamlValue::Sequence(proxy_values));
        set_yaml(
            config,
            "proxy-groups",
            YamlValue::Sequence(vec![YamlValue::Mapping(group)]),
        );
    }
    synthesize_default_proxy_groups_if_needed(config, &proxy_names);
    ensure_proxies_group_contains_all_nodes(config, &proxy_names);
    ensure_auto_select_group_contains_all_nodes(config, &proxy_names);
}

fn yaml_value_strings(value: Option<&YamlValue>) -> Vec<String> {
    match value {
        Some(YamlValue::Sequence(items)) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        Some(YamlValue::String(item)) => vec![item.to_string()],
        _ => Vec::new(),
    }
}

pub(crate) fn is_local_or_fake_nameserver(value: &str) -> bool {
    let text = value.trim().to_ascii_lowercase();
    text.is_empty()
        || text.contains("127.0.0.1")
        || text.contains("localhost")
        || text.contains("198.18.")
        || text.contains("198.19.")
}

pub(crate) fn runtime_dns_safety_report(config: &YamlValue) -> Result<String, String> {
    let dns = config
        .get(yaml_key("dns"))
        .and_then(YamlValue::as_mapping)
        .ok_or_else(|| "runtime DNS block missing".to_string())?;
    let listen = dns
        .get(yaml_key("listen"))
        .and_then(YamlValue::as_str)
        .unwrap_or("");
    if dns.get(yaml_key("enable")).and_then(YamlValue::as_bool) == Some(false) {
        return Ok("system DNS compatibility mode".to_string());
    }
    if listen != AEGOS_DNS_LISTEN {
        return Err(format!(
            "runtime DNS listen should be {AEGOS_DNS_LISTEN}, got {listen}"
        ));
    }
    let proxy_nameservers = yaml_value_strings(dns.get(yaml_key("proxy-server-nameserver")));
    if proxy_nameservers.is_empty() {
        return Err("proxy-server-nameserver is empty".to_string());
    }
    if proxy_nameservers
        .iter()
        .any(|value| is_local_or_fake_nameserver(value))
    {
        return Err(format!(
            "proxy-server-nameserver contains unsafe local/fake-ip resolver: {}",
            proxy_nameservers.join(", ")
        ));
    }
    let bootstrap_complete = AEGOS_BOOTSTRAP_NAMESERVERS
        .iter()
        .all(|expected| proxy_nameservers.iter().any(|value| value == expected));
    if !bootstrap_complete {
        return Err(format!(
            "bootstrap DNS set is incomplete: {}",
            proxy_nameservers.join(", ")
        ));
    }
    let encrypted_route = runtime_dns_route(config)?;
    Ok(format!(
        "listen={}, encrypted-route={}, proxy-server-nameserver={}",
        listen,
        encrypted_route,
        proxy_nameservers.join(", ")
    ))
}

pub(crate) fn runtime_dns_route(config: &YamlValue) -> Result<String, String> {
    let dns = config
        .get(yaml_key("dns"))
        .and_then(YamlValue::as_mapping)
        .ok_or_else(|| "runtime DNS block missing".to_string())?;
    if dns.get(yaml_key("enable")).and_then(YamlValue::as_bool) == Some(false) {
        return Ok("SYSTEM".to_string());
    }
    let nameservers = yaml_value_strings(dns.get(yaml_key("nameserver")));
    let route_tag = format!("#{AEGOS_OUTBOUND_IP_GROUP}");
    let all_remote =
        !nameservers.is_empty() && nameservers.iter().all(|value| value.ends_with(&route_tag));
    let all_direct =
        !nameservers.is_empty() && nameservers.iter().all(|value| value.ends_with("#DIRECT"));
    if all_remote {
        Ok(AEGOS_OUTBOUND_IP_GROUP.to_string())
    } else if all_direct {
        Ok("DIRECT".to_string())
    } else {
        Err(format!(
            "encrypted DNS routes are mixed or incomplete: {}",
            nameservers.join(", ")
        ))
    }
}

pub(crate) fn runtime_dns_hijack_enabled(config: &YamlValue) -> bool {
    config
        .get(yaml_key("tun"))
        .and_then(|tun| tun.get(yaml_key("dns-hijack")))
        .and_then(YamlValue::as_sequence)
        .is_some_and(|items| items.iter().any(|item| item.as_str() == Some("any:53")))
}

fn nameserver_through_route(value: &str, route: &str) -> String {
    let resolver = value.split_once('#').map(|(base, _)| base).unwrap_or(value);
    format!("{resolver}#{route}")
}

pub(crate) fn harden_runtime_dns(
    config: &mut Mapping,
    settings: &Settings,
    strict_fixed_dns: bool,
) -> Result<(), String> {
    let bootstrap_nameservers = AEGOS_BOOTSTRAP_NAMESERVERS
        .iter()
        .copied()
        .filter(|value| !is_local_or_fake_nameserver(value))
        .collect::<Vec<_>>();
    let dns = config
        .entry(yaml_key("dns"))
        .or_insert_with(|| YamlValue::Mapping(Mapping::new()));
    let dns_map = get_mapping_mut(dns);
    if settings.dns_mode == "system" {
        set_yaml(dns_map, "enable", YamlValue::Bool(false));
        set_yaml(dns_map, "listen", yaml_str(AEGOS_DNS_LISTEN));
        set_yaml(dns_map, "nameserver", YamlValue::Sequence(Vec::new()));
        set_yaml(
            dns_map,
            "proxy-server-nameserver",
            YamlValue::Sequence(Vec::new()),
        );
        return Ok(());
    }
    let nameservers: Vec<String> = if settings.dns_mode == "custom" {
        if settings.dns_custom_nameservers.is_empty() {
            return Err("Custom DNS mode requires at least one encrypted resolver".to_string());
        }
        settings
            .dns_custom_nameservers
            .iter()
            .map(|value| nameserver_through_route(value, AEGOS_OUTBOUND_IP_GROUP))
            .collect()
    } else if strict_fixed_dns {
        AEGOS_REMOTE_NAMESERVERS
            .iter()
            .map(|value| nameserver_through_route(value, AEGOS_OUTBOUND_IP_GROUP))
            .collect()
    } else {
        AEGOS_BOOTSTRAP_NAMESERVERS
            .iter()
            .map(|value| nameserver_through_route(value, "DIRECT"))
            .collect()
    };
    set_yaml(dns_map, "enable", YamlValue::Bool(true));
    set_yaml(dns_map, "ipv6", YamlValue::Bool(false));
    set_yaml(dns_map, "listen", yaml_str(AEGOS_DNS_LISTEN));
    set_yaml(dns_map, "enhanced-mode", yaml_str("fake-ip"));
    set_yaml(dns_map, "respect-rules", YamlValue::Bool(true));
    set_yaml(dns_map, "prefer-h3", YamlValue::Bool(false));
    set_yaml(dns_map, "nameserver", yaml_string_sequence(&nameservers));
    set_yaml(
        dns_map,
        "proxy-server-nameserver",
        yaml_string_sequence(&bootstrap_nameservers),
    );
    Ok(())
}

fn preflight_config(
    config: &YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<RuntimeConfigReport, String> {
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

fn validate_compiled_rule_targets(config: &YamlValue) -> Result<(), String> {
    let mapping = config
        .as_mapping()
        .ok_or_else(|| "Config preflight failed: root YAML value must be an object".to_string())?;
    let proxy_names = proxy_node_names(mapping)
        .into_iter()
        .collect::<HashSet<_>>();
    let proxy_group_names = proxy_group_names(mapping)
        .into_iter()
        .collect::<HashSet<_>>();
    let rules = config
        .get(yaml_key("rules"))
        .and_then(YamlValue::as_sequence)
        .cloned()
        .unwrap_or_default();
    routing_domain::validate_runtime_rule_targets(
        rules
            .iter()
            .enumerate()
            .filter_map(|(index, rule)| rule.as_str().map(|raw| (index, raw))),
        &proxy_names,
        &proxy_group_names,
    )
}

pub(crate) fn compile_runtime_catalog(
    source: YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<RuntimeConfigPlan, String> {
    let config = patch_config(source, settings, Some(&profile.id))?;
    let catalog =
        ProfileCatalog::from_yaml(config, &profile.id, &profile.name, &profile.profile_type)?;
    validate_compiled_rule_targets(catalog.config())?;
    let validation = preflight_config(catalog.config(), profile, settings)?;
    if validation.proxies != catalog.proxies().len()
        || validation.proxy_groups != catalog.groups().len()
        || validation.rules != catalog.summary().rule_count
    {
        return Err(
            "Runtime config plan validation counts do not match the Aegos profile catalog"
                .to_string(),
        );
    }
    Ok(RuntimeConfigPlan {
        catalog,
        validation,
    })
}
