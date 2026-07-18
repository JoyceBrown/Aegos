use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum UserRuleScope {
    Global,
    Profile { profile_id: String },
}

impl Default for UserRuleScope {
    fn default() -> Self {
        Self::Global
    }
}

impl UserRuleScope {
    pub(crate) fn applies_to(&self, profile_id: &str) -> bool {
        matches!(self, Self::Global)
            || matches!(self, Self::Profile { profile_id: scoped } if scoped == profile_id)
    }

    pub(crate) fn profile_id(&self) -> Option<&str> {
        match self {
            Self::Global => None,
            Self::Profile { profile_id } => Some(profile_id),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserRuleRecord {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) scope: UserRuleScope,
    pub(crate) kind: String,
    pub(crate) condition: String,
    pub(crate) target: String,
    #[serde(default)]
    pub(crate) option: Option<String>,
    #[serde(default = "enabled_by_default")]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) priority: u32,
    #[serde(default)]
    pub(crate) label: String,
    #[serde(default = "default_rule_source")]
    pub(crate) source: String,
    #[serde(default)]
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) updated_at: String,
}

fn enabled_by_default() -> bool {
    true
}

fn default_rule_source() -> String {
    "user".to_string()
}

impl UserRuleRecord {
    pub(crate) fn applies_to(&self, profile_id: &str) -> bool {
        self.enabled && self.scope.applies_to(profile_id)
    }

    pub(crate) fn raw(&self) -> String {
        let base = format!(
            "{},{},{}",
            self.kind.trim(),
            self.condition.trim(),
            self.target.trim()
        );
        self.option
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("{base},{value}"))
            .unwrap_or(base)
    }


    pub(crate) fn runtime_rank(&self, active_profile_id: &str) -> (u8, u8, usize, u32) {
        let kind = self.kind.trim().to_ascii_uppercase();
        let class = match kind.as_str() {
            "DOMAIN" => 0,
            "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "PROCESS-NAME" | "PROCESS-PATH" | "IP-CIDR" => 1,
            "GEOSITE" | "GEOIP" => 2,
            _ => 3,
        };
        let scope = match &self.scope {
            UserRuleScope::Profile { profile_id } if profile_id == active_profile_id => 0,
            _ => 1,
        };
        let specificity = usize::MAX.saturating_sub(self.condition.trim().len());
        (class, scope, specificity, self.priority)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserRuleStore {
    #[serde(default = "store_version")]
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) rules: Vec<UserRuleRecord>,
}

fn store_version() -> u32 {
    1
}

impl UserRuleStore {
    pub(crate) fn normalized(mut self) -> Self {
        self.version = store_version();
        self.rules.retain(|rule| {
            !rule.id.trim().is_empty()
                && !rule.kind.trim().is_empty()
                && !rule.condition.trim().is_empty()
                && !rule.target.trim().is_empty()
        });
        self.rules.sort_by_key(|rule| rule.priority);
        self
    }

    pub(crate) fn active_for_profile(&self, profile_id: &str) -> Vec<UserRuleRecord> {
        let mut rules = self
            .rules
            .iter()
            .filter(|rule| rule.applies_to(profile_id))
            .cloned()
            .collect::<Vec<_>>();
        rules.sort_by_key(|rule| rule.runtime_rank(profile_id));
        rules
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, scope: UserRuleScope, priority: u32) -> UserRuleRecord {
        UserRuleRecord {
            id: id.to_string(),
            scope,
            kind: "DOMAIN-SUFFIX".to_string(),
            condition: "example.com".to_string(),
            target: "Proxies".to_string(),
            option: None,
            enabled: true,
            priority,
            label: String::new(),
            source: "user".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn global_and_profile_rules_keep_a_clear_scope() {
        let store = UserRuleStore {
            version: 1,
            rules: vec![
                record("profile", UserRuleScope::Profile { profile_id: "one".to_string() }, 2),
                record("global", UserRuleScope::Global, 1),
            ],
        }
        .normalized();
        assert_eq!(store.active_for_profile("one").len(), 2);
        assert_eq!(store.active_for_profile("two").len(), 1);
        assert_eq!(store.active_for_profile("two")[0].id, "global");
    }

    #[test]
    fn explicit_and_profile_rules_are_ordered_before_broad_global_rules() {
        let mut profile = record("profile", UserRuleScope::Profile { profile_id: "one".to_string() }, 9);
        profile.kind = "DOMAIN".to_string();
        profile.condition = "www.example.com".to_string();
        let mut broad = record("broad", UserRuleScope::Global, 1);
        broad.kind = "GEOSITE".to_string();
        broad.condition = "youtube".to_string();
        let store = UserRuleStore { version: 1, rules: vec![broad, profile] }.normalized();
        assert_eq!(store.active_for_profile("one")[0].id, "profile");
    }
}
