use std::collections::HashSet;

use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};

use crate::{
    core_runtime, patch_config_with_settings, preflight_runtime_config, Profile, Settings,
};

pub(crate) struct RuntimePreflight {
    pub(crate) config: YamlValue,
    pub(crate) report: JsonValue,
}

pub(crate) const AEGOS_DNS_LISTEN: &str = "127.0.0.1:1054";
const AEGOS_DIRECT_NAMESERVERS: [&str; 3] = [
    "https://223.5.5.5/dns-query",
    "https://1.1.1.1/dns-query",
    "tls://8.8.8.8:853",
];

pub(crate) fn patch_config(
    source: YamlValue,
    settings: &Settings,
    profile_id: Option<&str>,
) -> Result<YamlValue, String> {
    patch_config_with_settings(source, settings, profile_id)
}

pub(crate) fn patch_direct_profile(settings: &Settings) -> Result<YamlValue, String> {
    patch_config(
        YamlValue::Mapping(Default::default()),
        settings,
        Some("direct"),
    )
}

pub(crate) fn patch_profile_source(
    source: YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<YamlValue, String> {
    patch_config(source, settings, Some(&profile.id))
}

pub(crate) fn patch_speed_test_source(
    source: YamlValue,
    profile: &Profile,
    standby_settings: &Settings,
) -> Result<YamlValue, String> {
    patch_profile_source(source, profile, standby_settings)
}

fn yaml_key(key: &str) -> YamlValue {
    YamlValue::String(key.to_string())
}

fn yaml_str(value: impl Into<String>) -> YamlValue {
    YamlValue::String(value.into())
}

fn yaml_string_sequence(values: &[&str]) -> YamlValue {
    YamlValue::Sequence(
        values
            .iter()
            .map(|value| YamlValue::String((*value).to_string()))
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

fn yaml_sequence<'a>(config: &'a YamlValue, key: &str) -> Option<&'a Vec<YamlValue>> {
    config
        .get(yaml_key(key))
        .and_then(|value| value.as_sequence())
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
    let Some(index) = groups.iter().position(|group| {
        yaml_mapping_name(group)
            .map(core_runtime::is_aegos_auto_select_group_name)
            .unwrap_or(false)
    }) else {
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
            url_test_proxy_group(
                core_runtime::LEGACY_AEGOS_AUTO_SELECT_GROUP_NAME,
                proxy_names,
            ),
        );
        return;
    };
    let Some(map) = groups[index].as_mapping_mut() else {
        groups[index] = url_test_proxy_group(
            core_runtime::LEGACY_AEGOS_AUTO_SELECT_GROUP_NAME,
            proxy_names,
        );
        return;
    };
    set_yaml(map, "type", yaml_str("url-test"));
    set_yaml(map, "url", yaml_str("https://www.gstatic.com/generate_204"));
    set_yaml(map, "interval", YamlValue::Number(300.into()));
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
    let nameservers = yaml_value_strings(dns.get(yaml_key("nameserver")));
    let has_direct_upstream = AEGOS_DIRECT_NAMESERVERS
        .iter()
        .all(|expected| nameservers.iter().any(|value| value == expected));
    if !has_direct_upstream {
        return Err(format!(
            "direct upstream DNS set is incomplete: {}",
            nameservers.join(", ")
        ));
    }
    Ok(format!(
        "listen={}, proxy-server-nameserver={}",
        listen,
        proxy_nameservers.join(", ")
    ))
}

pub(crate) fn harden_runtime_dns(config: &mut Mapping) {
    let nameservers = AEGOS_DIRECT_NAMESERVERS
        .iter()
        .copied()
        .filter(|value| !is_local_or_fake_nameserver(value))
        .collect::<Vec<_>>();
    let dns = config
        .entry(yaml_key("dns"))
        .or_insert_with(|| YamlValue::Mapping(Mapping::new()));
    let dns_map = get_mapping_mut(dns);
    set_yaml(dns_map, "enable", YamlValue::Bool(true));
    set_yaml(dns_map, "ipv6", YamlValue::Bool(false));
    set_yaml(dns_map, "listen", yaml_str(AEGOS_DNS_LISTEN));
    set_yaml(dns_map, "enhanced-mode", yaml_str("fake-ip"));
    set_yaml(dns_map, "nameserver", yaml_string_sequence(&nameservers));
    set_yaml(
        dns_map,
        "proxy-server-nameserver",
        yaml_string_sequence(&nameservers),
    );
}

pub(crate) fn speed_test_firewall_ports_from_source(
    source: YamlValue,
    profile: &Profile,
    standby_settings: &Settings,
) -> Result<Vec<u16>, String> {
    let patched = patch_speed_test_source(source, profile, standby_settings)?;
    let mut ports = HashSet::new();
    for proxy in yaml_sequence(&patched, "proxies")
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
    Ok(ports)
}

pub(crate) fn preflight_config(
    config: &YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<JsonValue, String> {
    preflight_runtime_config(config, profile, settings)
}

pub(crate) fn patch_and_preflight(
    source: YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<RuntimePreflight, String> {
    let config = patch_config(source, settings, Some(&profile.id))?;
    let report = preflight_config(&config, profile, settings)?;
    Ok(RuntimePreflight { config, report })
}

pub(crate) fn preflight_profile_source(
    source: YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<RuntimePreflight, String> {
    patch_and_preflight(source, profile, settings)
}
