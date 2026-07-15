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
