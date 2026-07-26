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

#[derive(Debug)]
struct ValidationIssue {
    code: &'static str,
    surface: &'static str,
    line: Option<usize>,
    column: Option<usize>,
    message: String,
    hint: &'static str,
}

impl ValidationIssue {
    fn new(
        code: &'static str,
        surface: &'static str,
        line: Option<usize>,
        column: Option<usize>,
        message: impl Into<String>,
        hint: &'static str,
    ) -> Self {
        Self {
            code,
            surface,
            line,
            column,
            message: message.into(),
            hint,
        }
    }

    fn public_surface(&self) -> JsonValue {
        json!({
            "code": self.code,
            "surface": self.surface,
            "line": self.line,
            "column": self.column,
            "hint": self.hint
        })
    }
}

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
    normalized_additional_rules(settings).map_err(|issue| issue.message)?;
    parse_override_script(settings).map_err(|issue| issue.message)?;
    Ok(())
}

pub(crate) fn apply_to_runtime(config: &mut Mapping, settings: &Settings) -> Result<(), String> {
    if let Some(overlay) = parse_override_script(settings).map_err(|issue| issue.message)? {
        merge_mapping(config, overlay);
    }
    let rules = normalized_additional_rules(settings).map_err(|issue| issue.message)?;
    apply_additional_rules(config, &rules)
}

pub(crate) fn preview(current: &Settings, draft: &JsonValue) -> JsonValue {
    let candidate = match preview_candidate(current, draft) {
        Ok(candidate) => candidate,
        Err(issue) => {
            return json!({
                "valid": false,
                "changed": false,
                "issues": [issue.public_surface()],
                "summary": JsonValue::Null
            });
        }
    };
    let mut issues = Vec::new();
    if let Err(issue) = normalized_additional_rules(&candidate) {
        issues.push(issue.public_surface());
    }
    if let Err(issue) = parse_override_script(&candidate) {
        issues.push(issue.public_surface());
    }
    let before_rules = rule_intent_lines(&current.additional_rules);
    let after_rules = rule_intent_lines(&candidate.additional_rules);
    let before_set = before_rules.iter().collect::<HashSet<_>>();
    let after_set = after_rules.iter().collect::<HashSet<_>>();
    let rules_added = after_set.difference(&before_set).count();
    let rules_removed = before_set.difference(&after_set).count();
    let rules_enabled_changed =
        current.additional_rules_enabled != candidate.additional_rules_enabled;
    let override_enabled_changed =
        current.override_script_enabled != candidate.override_script_enabled;
    let override_changed = current.override_script.trim() != candidate.override_script.trim();
    let changed = rules_added > 0
        || rules_removed > 0
        || rules_enabled_changed
        || override_enabled_changed
        || override_changed;
    json!({
        "valid": issues.is_empty(),
        "changed": changed,
        "issues": issues,
        "summary": {
            "rulesBefore": before_rules.len(),
            "rulesAfter": after_rules.len(),
            "rulesAdded": rules_added,
            "rulesRemoved": rules_removed,
            "rulesEnabledChanged": rules_enabled_changed,
            "overrideChanged": override_changed,
            "overrideEnabledChanged": override_enabled_changed,
            "runtimeReload": changed
        }
    })
}

fn preview_candidate(current: &Settings, draft: &JsonValue) -> Result<Settings, ValidationIssue> {
    let object = draft.as_object().ok_or_else(|| {
        ValidationIssue::new(
            "draft_type",
            "workspace",
            None,
            None,
            "Configuration extension draft must be an object.",
            "Refresh the settings page and try again.",
        )
    })?;
    let boolean = |key: &str, surface: &'static str| {
        object.get(key).and_then(JsonValue::as_bool).ok_or_else(|| {
            ValidationIssue::new(
                "draft_field",
                surface,
                None,
                None,
                format!("Draft field '{key}' must be true or false."),
                "Refresh the settings page and try again.",
            )
        })
    };
    let text = |key: &str, surface: &'static str| {
        object.get(key).and_then(JsonValue::as_str).ok_or_else(|| {
            ValidationIssue::new(
                "draft_field",
                surface,
                None,
                None,
                format!("Draft field '{key}' must be text."),
                "Refresh the settings page and try again.",
            )
        })
    };
    let mut candidate = current.clone();
    candidate.additional_rules_enabled = boolean("additionalRulesEnabled", "rules")?;
    candidate.additional_rules = text("additionalRulesText", "rules")?
        .lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    candidate.override_script_enabled = boolean("overrideScriptEnabled", "override")?;
    candidate.override_script = text("overrideScript", "override")?.to_string();
    Ok(candidate)
}

fn rule_intent_lines(raw_rules: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    raw_rules
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter(|line| seen.insert((*line).to_string()))
        .map(str::to_string)
        .collect()
}

fn normalized_additional_rules(settings: &Settings) -> Result<Vec<String>, ValidationIssue> {
    if !settings.additional_rules_enabled {
        return Ok(Vec::new());
    }
    if settings.additional_rules.len() > MAX_ADDITIONAL_RULES {
        return Err(ValidationIssue::new(
            "rules_limit",
            "rules",
            None,
            None,
            format!("Additional rules are limited to {MAX_ADDITIONAL_RULES} entries."),
            "Remove unused or blank lines before applying.",
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
            return Err(ValidationIssue::new(
                "rule_length",
                "rules",
                Some(index + 1),
                Some(1),
                format!(
                    "Additional rule {} exceeds {MAX_RULE_LENGTH} characters.",
                    index + 1
                ),
                "Shorten this rule and preview again.",
            ));
        }
        if rule.contains(['\r', '\n', '\0']) || !rule.contains(',') {
            return Err(ValidationIssue::new(
                "rule_format",
                "rules",
                Some(index + 1),
                Some(1),
                format!(
                    "Additional rule {} is not a valid single-line rule.",
                    index + 1
                ),
                "Use one comma-separated Mihomo rule per line.",
            ));
        }
        let kind = rule
            .split(',')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_uppercase();
        if matches!(kind.as_str(), "MATCH" | "FINAL") {
            return Err(ValidationIssue::new(
                "terminal_rule",
                "rules",
                Some(index + 1),
                Some(1),
                format!(
                    "Additional rule {} cannot be MATCH or FINAL; Aegos keeps the existing fallback rule last.",
                    index + 1
                ),
                "Remove the terminal rule; Aegos preserves the subscription fallback.",
            ));
        }
        if seen.insert(rule.to_string()) {
            rules.push(rule.to_string());
        }
    }
    Ok(rules)
}

fn parse_override_script(settings: &Settings) -> Result<Option<Mapping>, ValidationIssue> {
    if !settings.override_script_enabled || settings.override_script.trim().is_empty() {
        return Ok(None);
    }
    if settings.override_script.len() > MAX_OVERRIDE_BYTES {
        return Err(ValidationIssue::new(
            "override_limit",
            "override",
            None,
            None,
            format!(
                "Override YAML is limited to {} KiB.",
                MAX_OVERRIDE_BYTES / 1024
            ),
            "Reduce the override draft before applying.",
        ));
    }
    let value: YamlValue = serde_yaml::from_str(&settings.override_script).map_err(|err| {
        let location = err.location();
        ValidationIssue::new(
            "override_yaml",
            "override",
            location.as_ref().map(|item| item.line()),
            location.as_ref().map(|item| item.column()),
            format!("Override YAML is invalid: {err}"),
            "Fix the YAML at this location and preview again.",
        )
    })?;
    let mapping = value.as_mapping().cloned().ok_or_else(|| {
        ValidationIssue::new(
            "override_root",
            "override",
            Some(1),
            Some(1),
            "Override YAML root must be an object.",
            "Start the document with a top-level key.",
        )
    })?;
    validate_override_shape(&YamlValue::Mapping(mapping.clone()), 0, &mut 0)?;
    for key in mapping.keys().filter_map(YamlValue::as_str) {
        if PROTECTED_ROOT_KEYS
            .iter()
            .any(|protected| key.eq_ignore_ascii_case(protected))
        {
            let (line, column) =
                root_key_location(&settings.override_script, key).unwrap_or((1, 1));
            return Err(ValidationIssue::new(
                "protected_key",
                "override",
                Some(line),
                Some(column),
                format!(
                    "Override key '{key}' is managed by Aegos. Use the matching setting or Additional Rules instead."
                ),
                "Remove this protected key and use the matching Aegos setting.",
            ));
        }
    }
    Ok(Some(mapping))
}

fn validate_override_shape(
    value: &YamlValue,
    depth: usize,
    nodes: &mut usize,
) -> Result<(), ValidationIssue> {
    if depth > MAX_OVERRIDE_DEPTH {
        return Err(ValidationIssue::new(
            "override_depth",
            "override",
            None,
            None,
            format!("Override YAML nesting is limited to {MAX_OVERRIDE_DEPTH} levels."),
            "Flatten deeply nested values and preview again.",
        ));
    }
    *nodes += 1;
    if *nodes > MAX_OVERRIDE_NODES {
        return Err(ValidationIssue::new(
            "override_nodes",
            "override",
            None,
            None,
            format!("Override YAML is limited to {MAX_OVERRIDE_NODES} values."),
            "Reduce the number of values and preview again.",
        ));
    }
    match value {
        YamlValue::Mapping(mapping) => {
            for (key, item) in mapping {
                if !matches!(key, YamlValue::String(_)) {
                    return Err(ValidationIssue::new(
                        "override_key_type",
                        "override",
                        None,
                        None,
                        "Override YAML object keys must be text.",
                        "Replace non-text keys with text keys.",
                    ));
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
            return Err(ValidationIssue::new(
                "override_tag",
                "override",
                None,
                None,
                "Override YAML tags are not supported.",
                "Remove custom YAML tags and preview again.",
            ));
        }
        _ => {}
    }
    Ok(())
}

fn root_key_location(script: &str, expected: &str) -> Option<(usize, usize)> {
    let entries = script
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let content = line.trim_start();
            if content.is_empty() || content.starts_with('#') {
                return None;
            }
            let indent = line.len() - content.len();
            let key = content.split_once(':')?.0.trim().trim_matches(['\'', '"']);
            Some((index + 1, indent, key))
        })
        .collect::<Vec<_>>();
    let root_indent = entries.iter().map(|(_, indent, _)| *indent).min()?;
    entries
        .into_iter()
        .find(|(_, indent, key)| *indent == root_indent && key.eq_ignore_ascii_case(expected))
        .map(|(line, indent, _)| (line, indent + 1))
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

    #[test]
    fn preview_reports_safe_line_level_issues_and_intent_diff() {
        let settings = default_settings();
        let invalid = preview(
            &settings,
            &json!({
                "additionalRulesEnabled": true,
                "additionalRulesText": "# keep the source line\nMATCH,DIRECT",
                "overrideScriptEnabled": true,
                "overrideScript": "sniffer:\n  enable: true\nsecret: exposed"
            }),
        );
        assert_eq!(invalid["valid"], false);
        assert_eq!(invalid["issues"][0]["surface"], "rules");
        assert_eq!(invalid["issues"][0]["line"], 2);
        assert_eq!(invalid["issues"][1]["surface"], "override");
        assert_eq!(invalid["issues"][1]["line"], 3);
        assert!(!invalid.to_string().contains("exposed"));

        let valid = preview(
            &settings,
            &json!({
                "additionalRulesEnabled": true,
                "additionalRulesText": "DOMAIN-SUFFIX,example.com,Proxies",
                "overrideScriptEnabled": true,
                "overrideScript": "sniffer:\n  enable: true"
            }),
        );
        assert_eq!(valid["valid"], true);
        assert_eq!(valid["changed"], true);
        assert_eq!(valid["summary"]["rulesAdded"], 1);
        assert_eq!(valid["summary"]["overrideChanged"], true);
    }
}
