use std::collections::HashSet;

use serde_json::{json, Value as JsonValue};
use serde_yaml::{Mapping, Value as YamlValue};

use crate::app_config::Settings;

const MAX_ADDITIONAL_RULES: usize = 512;
const MAX_RULE_LENGTH: usize = 2048;
const MAX_OVERRIDE_BYTES: usize = 128 * 1024;
const MAX_OVERRIDE_DEPTH: usize = 12;
const MAX_OVERRIDE_NODES: usize = 4096;

const PROTECTED_ROOT_KEYS: [&str; 17] = [
    "port",
    "socks-port",
    "redir-port",
    "tproxy-port",
    "mixed-port",
    "external-controller",
    "secret",
    "allow-lan",
    "bind-address",
    "mode",
    "log-level",
    "ipv6",
    "tun",
    "dns",
    "rules",
    "find-process-mode",
    "profile",
];

pub(crate) fn is_setting_key(key: &str) -> bool {
    matches!(
        key,
        "additionalRulesEnabled" | "additionalRules" | "overrideScriptEnabled" | "overrideScript"
    )
}

pub(crate) fn apply_candidate_value(
    settings: &mut Settings,
    key: &str,
    value: &JsonValue,
) -> Result<(), String> {
    match key {
        "additionalRulesEnabled" => {
            settings.additional_rules_enabled = value.as_bool().ok_or_else(|| {
                "Additional Rules enabled state must be true or false.".to_string()
            })?;
        }
        "additionalRules" => {
            let values = value
                .as_array()
                .ok_or_else(|| "Additional Rules must be a list of rule lines.".to_string())?;
            settings.additional_rules = values
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_string)
                        .ok_or_else(|| "Each Additional Rule must be text.".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
        }
        "overrideScriptEnabled" => {
            settings.override_script_enabled = value.as_bool().ok_or_else(|| {
                "Override Script enabled state must be true or false.".to_string()
            })?;
        }
        "overrideScript" => {
            settings.override_script = value
                .as_str()
                .ok_or_else(|| "Override Script must be YAML text.".to_string())?
                .to_string();
        }
        _ => return Ok(()),
    }
    validate_settings(settings)
}

pub(crate) fn public_surface(settings: &Settings) -> JsonValue {
    json!({
        "additionalRulesEnabled": settings.additional_rules_enabled,
        "additionalRules": &settings.additional_rules,
        "overrideScriptEnabled": settings.override_script_enabled,
        "overrideScript": &settings.override_script,
        "format": "yaml"
    })
}

pub(crate) fn diagnostic_surface(settings: &Settings) -> JsonValue {
    json!({
        "additionalRulesEnabled": settings.additional_rules_enabled,
        "additionalRuleCount": settings.additional_rules.len(),
        "overrideScriptEnabled": settings.override_script_enabled,
        "overrideScriptConfigured": !settings.override_script.trim().is_empty(),
        "format": "yaml"
    })
}

pub(crate) fn validate_settings(settings: &Settings) -> Result<(), String> {
    normalized_additional_rules(settings)?;
    parse_override_script(settings)?;
    Ok(())
}

pub(crate) fn apply_to_runtime(config: &mut Mapping, settings: &Settings) -> Result<(), String> {
    if let Some(overlay) = parse_override_script(settings)? {
        merge_mapping(config, overlay);
    }
    apply_additional_rules(config, &normalized_additional_rules(settings)?)
}

fn normalized_additional_rules(settings: &Settings) -> Result<Vec<String>, String> {
    if !settings.additional_rules_enabled {
        return Ok(Vec::new());
    }
    if settings.additional_rules.len() > MAX_ADDITIONAL_RULES {
        return Err(format!(
            "Additional rules are limited to {MAX_ADDITIONAL_RULES} entries."
        ));
    }
    let mut seen = HashSet::new();
    let mut rules = Vec::new();
    for (index, raw) in settings.additional_rules.iter().enumerate() {
        let rule = raw.trim();
        if rule.is_empty() || rule.starts_with('#') {
            continue;
        }
        if rule.len() > MAX_RULE_LENGTH {
            return Err(format!(
                "Additional rule {} exceeds {MAX_RULE_LENGTH} characters.",
                index + 1
            ));
        }
        if rule.contains(['\r', '\n', '\0']) || !rule.contains(',') {
            return Err(format!(
                "Additional rule {} is not a valid single-line rule.",
                index + 1
            ));
        }
        let kind = rule
            .split(',')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_uppercase();
        if matches!(kind.as_str(), "MATCH" | "FINAL") {
            return Err(format!(
                "Additional rule {} cannot be MATCH or FINAL; Aegos keeps the existing fallback rule last.",
                index + 1
            ));
        }
        if seen.insert(rule.to_string()) {
            rules.push(rule.to_string());
        }
    }
    Ok(rules)
}

fn parse_override_script(settings: &Settings) -> Result<Option<Mapping>, String> {
    if !settings.override_script_enabled || settings.override_script.trim().is_empty() {
        return Ok(None);
    }
    if settings.override_script.len() > MAX_OVERRIDE_BYTES {
        return Err(format!(
            "Override YAML is limited to {} KiB.",
            MAX_OVERRIDE_BYTES / 1024
        ));
    }
    let value: YamlValue = serde_yaml::from_str(&settings.override_script)
        .map_err(|err| format!("Override YAML is invalid: {err}"))?;
    let mapping = value
        .as_mapping()
        .cloned()
        .ok_or_else(|| "Override YAML root must be an object.".to_string())?;
    validate_override_shape(&YamlValue::Mapping(mapping.clone()), 0, &mut 0)?;
    for key in mapping.keys().filter_map(YamlValue::as_str) {
        if PROTECTED_ROOT_KEYS
            .iter()
            .any(|protected| key.eq_ignore_ascii_case(protected))
        {
            return Err(format!(
                "Override key '{key}' is managed by Aegos. Use the matching setting or Additional Rules instead."
            ));
        }
    }
    Ok(Some(mapping))
}

fn validate_override_shape(
    value: &YamlValue,
    depth: usize,
    nodes: &mut usize,
) -> Result<(), String> {
    if depth > MAX_OVERRIDE_DEPTH {
        return Err(format!(
            "Override YAML nesting is limited to {MAX_OVERRIDE_DEPTH} levels."
        ));
    }
    *nodes += 1;
    if *nodes > MAX_OVERRIDE_NODES {
        return Err(format!(
            "Override YAML is limited to {MAX_OVERRIDE_NODES} values."
        ));
    }
    match value {
        YamlValue::Mapping(mapping) => {
            for (key, item) in mapping {
                if !matches!(key, YamlValue::String(_)) {
                    return Err("Override YAML object keys must be text.".to_string());
                }
                validate_override_shape(item, depth + 1, nodes)?;
            }
        }
        YamlValue::Sequence(items) => {
            for item in items {
                validate_override_shape(item, depth + 1, nodes)?;
            }
        }
        YamlValue::Tagged(_) => {
            return Err("Override YAML tags are not supported.".to_string());
        }
        _ => {}
    }
    Ok(())
}

fn merge_mapping(target: &mut Mapping, overlay: Mapping) {
    for (key, value) in overlay {
        if value.is_null() {
            target.remove(&key);
            continue;
        }
        if let Some(existing) = target.get_mut(&key) {
            merge_value(existing, value);
        } else {
            target.insert(key, value);
        }
    }
}

fn merge_value(target: &mut YamlValue, overlay: YamlValue) {
    match (target, overlay) {
        (YamlValue::Mapping(target), YamlValue::Mapping(overlay)) => {
            merge_mapping(target, overlay);
        }
        (target, overlay) => *target = overlay,
    }
}

fn apply_additional_rules(config: &mut Mapping, additional: &[String]) -> Result<(), String> {
    if additional.is_empty() {
        return Ok(());
    }
    let key = YamlValue::String("rules".to_string());
    let rules = config
        .entry(key)
        .or_insert_with(|| YamlValue::Sequence(Vec::new()))
        .as_sequence_mut()
        .ok_or_else(|| "Runtime rules must be a YAML list before adding rules.".to_string())?;
    let mut existing = rules
        .iter()
        .filter_map(YamlValue::as_str)
        .map(str::trim)
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let insert_at = rules
        .iter()
        .position(|value| {
            value.as_str().is_some_and(|raw| {
                matches!(
                    raw.split(',')
                        .next()
                        .unwrap_or_default()
                        .trim()
                        .to_ascii_uppercase()
                        .as_str(),
                    "MATCH" | "FINAL"
                )
            })
        })
        .unwrap_or(rules.len());
    let mut offset = 0;
    for rule in additional {
        if existing.insert(rule.clone()) {
            rules.insert(insert_at + offset, YamlValue::String(rule.clone()));
            offset += 1;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::default_settings;

    #[test]
    fn additional_rules_are_deduplicated_and_inserted_before_fallback() {
        let mut settings = default_settings();
        settings.additional_rules_enabled = true;
        settings.additional_rules = vec![
            "DOMAIN-SUFFIX,example.com,Proxies".to_string(),
            "DOMAIN-SUFFIX,example.com,Proxies".to_string(),
        ];
        let mut config = serde_yaml::from_str::<YamlValue>(
            "rules:\n  - DOMAIN-SUFFIX,existing.test,DIRECT\n  - MATCH,Proxies\n",
        )
        .expect("yaml")
        .as_mapping()
        .cloned()
        .expect("mapping");
        apply_to_runtime(&mut config, &settings).expect("extensions");
        let rules = config
            .get(YamlValue::String("rules".to_string()))
            .and_then(YamlValue::as_sequence)
            .expect("rules");
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[1].as_str(), Some("DOMAIN-SUFFIX,example.com,Proxies"));
        assert_eq!(rules[2].as_str(), Some("MATCH,Proxies"));
    }

    #[test]
    fn override_merges_nested_values_and_null_removes_keys() {
        let mut settings = default_settings();
        settings.override_script_enabled = true;
        settings.override_script =
            "sniffer:\n  enable: true\n  force-dns-mapping: null\ngeodata-mode: true\n".to_string();
        let mut config = serde_yaml::from_str::<YamlValue>(
            "sniffer:\n  enable: false\n  force-dns-mapping: true\n",
        )
        .expect("yaml")
        .as_mapping()
        .cloned()
        .expect("mapping");
        apply_to_runtime(&mut config, &settings).expect("extensions");
        let sniffer = config
            .get(YamlValue::String("sniffer".to_string()))
            .and_then(YamlValue::as_mapping)
            .expect("sniffer");
        assert_eq!(
            sniffer
                .get(YamlValue::String("enable".to_string()))
                .and_then(YamlValue::as_bool),
            Some(true)
        );
        assert!(!sniffer.contains_key(YamlValue::String("force-dns-mapping".to_string())));
    }

    #[test]
    fn protected_runtime_ownership_and_terminal_rules_are_rejected() {
        let mut settings = default_settings();
        settings.override_script_enabled = true;
        settings.override_script = "secret: exposed\n".to_string();
        assert!(validate_settings(&settings)
            .expect_err("protected key")
            .contains("managed by Aegos"));
        settings.override_script_enabled = false;
        settings.additional_rules_enabled = true;
        settings.additional_rules = vec!["MATCH,DIRECT".to_string()];
        assert!(validate_settings(&settings)
            .expect_err("terminal rule")
            .contains("cannot be MATCH"));
    }
}
