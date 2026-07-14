use std::collections::HashSet;

use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};

use crate::{patch_config_with_settings, preflight_runtime_config, Profile, Settings};

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
    patch_config(YamlValue::Mapping(Default::default()), settings, Some("direct"))
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
