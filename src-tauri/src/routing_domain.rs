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

/// Aegos' rule vocabulary.  Mihomo identifiers are confined to the compiler
/// below so the rest of the product never needs to reason about engine syntax.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RoutingConditionKind {
    WebsiteExact,
    WebsiteSuffix,
    WebsiteKeyword,
    ProcessName,
    ProcessPath,
    Country,
    SiteSet,
    IpCidr,
}

impl RoutingConditionKind {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_uppercase().as_str() {
            "DOMAIN" => Ok(Self::WebsiteExact),
            "DOMAIN-SUFFIX" => Ok(Self::WebsiteSuffix),
            "DOMAIN-KEYWORD" => Ok(Self::WebsiteKeyword),
            "PROCESS-NAME" => Ok(Self::ProcessName),
            "PROCESS-PATH" => Ok(Self::ProcessPath),
            "GEOIP" => Ok(Self::Country),
            "GEOSITE" => Ok(Self::SiteSet),
            "IP-CIDR" => Ok(Self::IpCidr),
            other => Err(format!("Unsupported routing rule type: {other}")),
        }
    }

    pub(crate) fn engine_kind(self) -> &'static str {
        match self {
            Self::WebsiteExact => "DOMAIN",
            Self::WebsiteSuffix => "DOMAIN-SUFFIX",
            Self::WebsiteKeyword => "DOMAIN-KEYWORD",
            Self::ProcessName => "PROCESS-NAME",
            Self::ProcessPath => "PROCESS-PATH",
            Self::Country => "GEOIP",
            Self::SiteSet => "GEOSITE",
            Self::IpCidr => "IP-CIDR",
        }
    }

    fn accepts_no_resolve(self) -> bool {
        matches!(self, Self::Country | Self::IpCidr)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RoutingTarget {
    Named(String),
    Direct,
    Reject,
}

impl RoutingTarget {
    fn parse(value: &str, targets: &HashSet<String>) -> Result<Self, String> {
        let target = validate_part("Rule route target", value, 140)?;
        match target.to_ascii_uppercase().as_str() {
            "DIRECT" => Ok(Self::Direct),
            "REJECT" => Ok(Self::Reject),
            _ if target_exists(targets, &target) => Ok(Self::Named(target)),
            _ => Err(format!("Rule route target does not exist: {target}")),
        }
    }

    fn engine_target(&self) -> &str {
        match self {
            Self::Named(value) => value,
            Self::Direct => "DIRECT",
            Self::Reject => "REJECT",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RoutingRuleOption {
    NoResolve,
}

impl RoutingRuleOption {
    fn parse(value: Option<&str>, kind: RoutingConditionKind) -> Result<Option<Self>, String> {
        let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(None);
        };
        if value != "no-resolve" {
            return Err(format!("Unsupported routing rule option: {value}"));
        }
        if !kind.accepts_no_resolve() {
            return Err("no-resolve only applies to GEOIP or IP-CIDR rules.".to_string());
        }
        Ok(Some(Self::NoResolve))
    }

    fn engine_option(self) -> &'static str {
        match self {
            Self::NoResolve => "no-resolve",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RoutingIntent {
    pub(crate) kind: RoutingConditionKind,
    pub(crate) condition: String,
    pub(crate) target: RoutingTarget,
    pub(crate) option: Option<RoutingRuleOption>,
}

impl RoutingIntent {
    fn from_draft(draft: &RoutingDraftInput, targets: &HashSet<String>) -> Result<Self, String> {
        let kind = RoutingConditionKind::parse(&draft.kind)?;
        Ok(Self {
            kind,
            condition: validate_part("Rule match value", &draft.condition, 220)?,
            target: RoutingTarget::parse(&draft.target, targets)?,
            option: RoutingRuleOption::parse(draft.option.as_deref(), kind)?,
        })
    }

    fn compile(&self) -> (String, String, String, Option<String>) {
        let kind = self.kind.engine_kind().to_string();
        let target = self.target.engine_target().to_string();
        let option = self.option.map(|value| value.engine_option().to_string());
        (kind, self.condition.clone(), target, option)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StrategyPolicy {
    Manual,
    LowestLatency,
    Failover,
    LoadBalanced,
}

impl StrategyPolicy {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "select" | "selector" => Ok(Self::Manual),
            "url-test" | "urltest" => Ok(Self::LowestLatency),
            "fallback" => Ok(Self::Failover),
            "load-balance" | "loadbalance" => Ok(Self::LoadBalanced),
            other => Err(format!("Unsupported strategy group type: {other}")),
        }
    }

    pub(crate) fn engine_group_type(self) -> &'static str {
        match self {
            Self::Manual => "select",
            Self::LowestLatency => "url-test",
            Self::Failover => "fallback",
            Self::LoadBalanced => "load-balance",
        }
    }
}

impl RoutingDraftInput {
    pub(crate) fn compile(&self, targets: &HashSet<String>) -> Result<CompiledRoutingRule, String> {
        let intent = RoutingIntent::from_draft(self, targets)?;
        let (kind, condition, target, option) = intent.compile();
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
    Ok(StrategyPolicy::parse(value)?.engine_group_type())
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
            RoutingConditionKind::parse("domain-suffix")
                .expect("website suffix")
                .engine_kind(),
            "DOMAIN-SUFFIX"
        );
        assert_eq!(
            StrategyPolicy::parse("urltest")
                .expect("latency policy")
                .engine_group_type(),
            "url-test"
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

    #[test]
    fn semantic_intent_compiles_reserved_actions_deterministically() {
        let draft = RoutingDraftInput {
            kind: "ip-cidr".to_string(),
            condition: "10.0.0.0/8".to_string(),
            target: "direct".to_string(),
            option: Some("no-resolve".to_string()),
            label: None,
            source: None,
            scope: None,
        };
        let compiled = draft
            .compile(&HashSet::new())
            .expect("compiled direct intent");
        assert_eq!(compiled.rule, "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve");
        assert_eq!(compiled.target, "DIRECT");
    }
}
