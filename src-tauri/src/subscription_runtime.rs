use base64::{engine::general_purpose, Engine as _};
use serde_yaml::Value as YamlValue;

#[derive(Clone, Default, Debug)]
pub(crate) struct ProfileSourceSummary {
    pub(crate) format: String,
    pub(crate) proxies: usize,
    pub(crate) proxy_groups: usize,
    pub(crate) rules: usize,
    pub(crate) unsupported_lines: usize,
}

#[derive(Debug)]
pub(crate) struct ProfileSource {
    pub(crate) config: YamlValue,
    pub(crate) summary: ProfileSourceSummary,
}

pub(crate) fn diagnostic(stage: &str, reason: impl AsRef<str>, suggestion: &str) -> String {
    format!(
        "Subscription diagnostics [{stage}]: {}. Suggestion: {suggestion}. Open Logs or Diagnostics for details.",
        reason.as_ref()
    )
}

pub(crate) fn is_ignorable_line(line: &str) -> bool {
    let line = line.trim().trim_start_matches('\u{feff}');
    if line.is_empty() || line.starts_with('#') || line.starts_with("//") || line.starts_with(';') {
        return true;
    }
    let lower = line.to_ascii_lowercase();
    lower.starts_with("subscription-userinfo:")
        || lower.starts_with("profile-title:")
        || lower.starts_with("profile-update-interval:")
        || lower.starts_with("profile-web-page-url:")
        || lower.starts_with("support-url:")
        || lower.starts_with("upload=")
        || lower.starts_with("download=")
        || lower.starts_with("total=")
        || lower.starts_with("expire=")
}

pub(crate) fn decoded_body(text: &str) -> String {
    let raw = text.trim_start_matches('\u{feff}').trim();
    if raw.contains("://") || looks_like_clash_yaml(raw) {
        raw.to_string()
    } else {
        decode_base64_text(raw).unwrap_or_else(|| raw.to_string())
    }
}

pub(crate) fn unsupported_uri_schemes(text: &str, supported: &[&str]) -> Vec<String> {
    let body = decoded_body(text);
    let mut schemes = body
        .lines()
        .map(str::trim)
        .filter(|line| !is_ignorable_line(line))
        .filter_map(|line| line.split_once("://").map(|(scheme, _)| scheme.trim()))
        .filter(|scheme| {
            let scheme = scheme.to_ascii_lowercase();
            !scheme.is_empty() && !supported.contains(&scheme.as_str())
        })
        .map(|scheme| scheme.to_ascii_lowercase())
        .collect::<Vec<_>>();
    schemes.sort();
    schemes.dedup();
    schemes
}

pub(crate) fn looks_like_clash_yaml(text: &str) -> bool {
    text.lines().take(48).any(|line| {
        let line = line.trim_start();
        line.starts_with("proxies:")
            || line.starts_with("proxy-groups:")
            || line.starts_with("rules:")
            || line.starts_with("mixed-port:")
            || line.starts_with("port:")
            || line.starts_with("socks-port:")
    })
}

pub(crate) fn summarize_source(
    config: &YamlValue,
    format: &str,
    unsupported_lines: usize,
) -> Result<ProfileSourceSummary, String> {
    let proxies = yaml_sequence(config, "proxies")
        .map(|items| items.len())
        .unwrap_or(0);
    let proxy_groups = yaml_sequence(config, "proxy-groups")
        .map(|items| items.len())
        .unwrap_or(0);
    let rules = yaml_sequence(config, "rules")
        .map(|items| items.len())
        .unwrap_or(0);
    if proxies == 0 {
        return Err("subscription contains no usable proxies".to_string());
    }
    Ok(ProfileSourceSummary {
        format: format.to_string(),
        proxies,
        proxy_groups,
        rules,
        unsupported_lines,
    })
}

fn yaml_key(key: &str) -> YamlValue {
    YamlValue::String(key.to_string())
}

fn yaml_sequence<'a>(config: &'a YamlValue, key: &str) -> Option<&'a Vec<YamlValue>> {
    config.get(yaml_key(key)).and_then(YamlValue::as_sequence)
}

fn decode_base64_text(input: &str) -> Option<String> {
    let normalized = input.trim().replace(['\r', '\n', ' '], "");
    let padded = match normalized.len() % 4 {
        0 => normalized,
        missing => format!("{}{}", normalized, "=".repeat(4 - missing)),
    };
    general_purpose::STANDARD
        .decode(padded)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}
