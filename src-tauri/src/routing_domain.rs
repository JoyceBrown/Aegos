use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct RoutingDraftInput {
    pub(crate) kind: String,
    pub(crate) condition: String,
    pub(crate) target: String,
    pub(crate) option: Option<String>,
    pub(crate) label: Option<String>,
    pub(crate) source: Option<String>,
    #[serde(default)]
    pub(crate) scope: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct RoutingGroupEditInput {
    pub(crate) action: String,
    pub(crate) name: Option<String>,
    pub(crate) new_name: Option<String>,
    pub(crate) group_type: Option<String>,
    pub(crate) items: Option<Vec<String>>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct RoutingRuleEditInput {
    pub(crate) action: String,
    #[serde(default)]
    pub(crate) rule_id: Option<String>,
    pub(crate) raw: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) condition: Option<String>,
    pub(crate) target: Option<String>,
    pub(crate) option: Option<String>,
    pub(crate) label: Option<String>,
    #[serde(default)]
    pub(crate) scope: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct UnboundRuleResolutionInput {
    pub(crate) rule_id: String,
    pub(crate) action: String,
    #[serde(default)]
    pub(crate) target: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RoutingGroupAction {
    Add,
    Edit,
    Delete,
}

impl RoutingGroupAction {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "add" => Ok(Self::Add),
            "edit" => Ok(Self::Edit),
            "delete" => Ok(Self::Delete),
            _ => Err("Strategy group operation is not supported.".to_string()),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Edit => "edit",
            Self::Delete => "delete",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RoutingRuleAction {
    Add,
    Edit,
    Delete,
    Enable,
    Disable,
    Up,
    Down,
}

impl RoutingRuleAction {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "add" => Ok(Self::Add),
            "edit" => Ok(Self::Edit),
            "delete" => Ok(Self::Delete),
            "enable" => Ok(Self::Enable),
            "disable" => Ok(Self::Disable),
            "up" => Ok(Self::Up),
            "down" => Ok(Self::Down),
            _ => Err("Rule operation is not supported.".to_string()),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Edit => "edit",
            Self::Delete => "delete",
            Self::Enable => "enable",
            Self::Disable => "disable",
            Self::Up => "up",
            Self::Down => "down",
        }
    }

    pub(crate) fn requires_existing_user_rule(self) -> bool {
        !matches!(self, Self::Add)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CompiledRoutingRule {
    pub(crate) kind: String,
    pub(crate) condition: String,
    pub(crate) target: String,
    pub(crate) option: Option<String>,
    pub(crate) label: String,
    pub(crate) source: String,
    pub(crate) rule: String,
}

impl RoutingDraftInput {
    pub(crate) fn compile(&self, targets: &HashSet<String>) -> Result<CompiledRoutingRule, String> {
        let kind = self.kind.trim().to_ascii_uppercase();
        const ALLOWED_KINDS: &[&str] = &[
            "DOMAIN",
            "DOMAIN-SUFFIX",
            "DOMAIN-KEYWORD",
            "PROCESS-NAME",
            "PROCESS-PATH",
            "GEOIP",
            "GEOSITE",
            "IP-CIDR",
        ];
        if !ALLOWED_KINDS.contains(&kind.as_str()) {
            return Err(format!("Unsupported routing rule type: {kind}"));
        }
        let condition = validate_part("Rule match value", &self.condition, 220)?;
        let target = validate_part("Rule route target", &self.target, 140)?;
        if !target_exists(targets, &target) {
            return Err(format!("Rule route target does not exist: {target}"));
        }
        let option = self
            .option
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(option) = option.as_deref() {
            if option != "no-resolve" {
                return Err(format!("Unsupported routing rule option: {option}"));
            }
            if !matches!(kind.as_str(), "GEOIP" | "IP-CIDR") {
                return Err("no-resolve only applies to GEOIP or IP-CIDR rules.".to_string());
            }
        }
        let rule = if let Some(option) = option.as_deref() {
            format!("{kind},{condition},{target},{option}")
        } else {
            format!("{kind},{condition},{target}")
        };
        Ok(CompiledRoutingRule {
            kind,
            condition,
            target,
            option,
            label: self
                .label
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(&rule)
                .to_string(),
            source: self.source.as_deref().unwrap_or("draft").to_string(),
            rule,
        })
    }
}

impl RoutingRuleEditInput {
    pub(crate) fn draft(&self) -> RoutingDraftInput {
        RoutingDraftInput {
            kind: self.kind.clone().unwrap_or_default(),
            condition: self.condition.clone().unwrap_or_default(),
            target: self.target.clone().unwrap_or_default(),
            option: self.option.clone(),
            label: self.label.clone(),
            source: Some("user".to_string()),
            scope: self.scope.clone(),
        }
    }
}

pub(crate) fn validate_group_type(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "select" | "selector" => Ok("select"),
        "url-test" | "urltest" => Ok("url-test"),
        "fallback" => Ok("fallback"),
        "load-balance" | "loadbalance" => Ok("load-balance"),
        other => Err(format!("Unsupported strategy group type: {other}")),
    }
}

pub(crate) fn validate_group_members(
    values: &[String],
    targets: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let mut members = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let member = validate_part("Strategy group member", value, 180)?;
        if !target_exists(targets, &member) {
            return Err(format!("Strategy group member does not exist: {member}"));
        }
        if seen.insert(member.clone()) {
            members.push(member);
        }
    }
    if members.is_empty() {
        return Err("Strategy group needs at least one node or group.".to_string());
    }
    Ok(members)
}

pub(crate) fn validate_name(value: &str) -> Result<String, String> {
    validate_part("Strategy group name", value, 80)
}

pub(crate) fn rule_target(rule: &str) -> Option<String> {
    let mut parts = rule.split(',').map(str::trim);
    let kind = parts.next()?.to_ascii_uppercase();
    if matches!(kind.as_str(), "MATCH" | "FINAL") {
        return parts.next().map(str::to_string);
    }
    parts.next()?;
    parts.next().map(str::to_string)
}

pub(crate) fn replace_rule_target(
    rule: &str,
    old_target: &str,
    new_target: &str,
) -> Option<String> {
    let mut parts = rule
        .split(',')
        .map(|part| part.trim().to_string())
        .collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }
    let target_index = if matches!(parts[0].to_ascii_uppercase().as_str(), "MATCH" | "FINAL") {
        1
    } else {
        2
    };
    if parts.get(target_index).map(String::as_str) != Some(old_target) {
        return None;
    }
    parts[target_index] = new_target.to_string();
    Some(parts.join(","))
}

pub(crate) fn replace_targets(rules: &[String], old_target: &str, new_target: &str) -> Vec<String> {
    rules
        .iter()
        .map(|rule| {
            replace_rule_target(rule, old_target, new_target).unwrap_or_else(|| rule.clone())
        })
        .collect()
}

pub(crate) fn target_exists(targets: &HashSet<String>, target: &str) -> bool {
    targets.contains(target) || targets.contains(&target.to_ascii_uppercase())
}

fn validate_part(label: &str, value: &str, max_len: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} cannot be empty."));
    }
    if trimmed.len() > max_len {
        return Err(format!("{label} is too long. Shorten it and apply again."));
    }
    if trimmed.contains('\r')
        || trimmed.contains('\n')
        || trimmed.contains('\0')
        || trimmed.contains(',')
    {
        return Err(format!("{label} contains unsupported characters."));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_commands_reject_unknown_actions_and_targets() {
        assert!(RoutingRuleAction::parse("replace-all").is_err());
        let draft = RoutingDraftInput {
            kind: "DOMAIN-SUFFIX".to_string(),
            condition: "example.com".to_string(),
            target: "Missing".to_string(),
            option: None,
            label: None,
            source: None,
            scope: None,
        };
        assert!(draft
            .compile(&HashSet::from(["Proxies".to_string()]))
            .is_err());
    }

    #[test]
    fn rule_compile_and_group_validation_are_typed() {
        let targets = HashSet::from(["Proxies".to_string(), "Node A".to_string()]);
        let draft = RoutingDraftInput {
            kind: "domain-suffix".to_string(),
            condition: "example.com".to_string(),
            target: "Proxies".to_string(),
            option: None,
            label: Some("Example".to_string()),
            source: Some("user".to_string()),
            scope: None,
        };
        assert_eq!(
            draft.compile(&targets).expect("compiled rule").rule,
            "DOMAIN-SUFFIX,example.com,Proxies"
        );
        assert_eq!(
            validate_group_members(&["Node A".to_string(), "Node A".to_string()], &targets,)
                .expect("members"),
            vec!["Node A".to_string()]
        );
        assert_eq!(
            replace_targets(
                &[
                    "DOMAIN-SUFFIX,example.com,Old Group".to_string(),
                    "MATCH,Old Group".to_string(),
                    "DOMAIN,keep.example,Proxies".to_string(),
                ],
                "Old Group",
                "New Group",
            ),
            vec![
                "DOMAIN-SUFFIX,example.com,New Group".to_string(),
                "MATCH,New Group".to_string(),
                "DOMAIN,keep.example,Proxies".to_string(),
            ]
        );
    }
}
