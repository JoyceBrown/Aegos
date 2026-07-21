use serde_json::{json, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    app_config::{Profile, Settings},
    config_deployment::ConfigDeploymentCandidate,
    config_domain::{ProfileCatalog, RuntimeConfigReport},
    config_pipeline,
    storage_runtime::sha256_text,
};

pub(crate) struct RuntimeDeploymentPlan {
    source_catalog: ProfileCatalog,
    runtime_catalog: ProfileCatalog,
    pub(crate) source_yaml: String,
    pub(crate) runtime_yaml: String,
    pub(crate) source_digest: String,
    pub(crate) runtime_digest: String,
    pub(crate) validation: RuntimeConfigReport,
}

impl RuntimeDeploymentPlan {
    pub(crate) fn source_catalog(&self) -> &ProfileCatalog {
        &self.source_catalog
    }

    pub(crate) fn runtime_catalog(&self) -> &ProfileCatalog {
        &self.runtime_catalog
    }

    pub(crate) fn validation_json(&self) -> JsonValue {
        self.validation.to_json()
    }

    pub(crate) fn source_deployment_candidate(
        &self,
        active_root: &Path,
        active_path: &Path,
        operation: impl Into<String>,
    ) -> Result<ConfigDeploymentCandidate, String> {
        let candidate = ConfigDeploymentCandidate::new(
            active_root,
            active_path,
            operation,
            &self.source_catalog.summary().profile_id,
            self.source_yaml.clone(),
        )?;
        if candidate.digest() != self.source_digest {
            return Err(
                "Source deployment candidate digest does not match its compiled plan".to_string(),
            );
        }
        Ok(candidate)
    }
}

pub(crate) fn compile_profile_file(
    profile: &Profile,
    settings: &Settings,
) -> Result<RuntimeDeploymentPlan, String> {
    let path = PathBuf::from(&profile.path);
    let raw = fs::read_to_string(&path)
        .map_err(|err| format!("profile config read failed {}: {err}", path.display()))?;
    let source: YamlValue = serde_yaml::from_str(&raw)
        .map_err(|err| format!("profile YAML parse failed {}: {err}", path.display()))?;
    compile_profile_source(source, profile, settings)
}

pub(crate) fn compile_profile_source(
    source: YamlValue,
    profile: &Profile,
    settings: &Settings,
) -> Result<RuntimeDeploymentPlan, String> {
    let source_catalog =
        ProfileCatalog::from_yaml(source, &profile.id, &profile.name, &profile.profile_type)?;
    let source_yaml =
        serde_yaml::to_string(source_catalog.config()).map_err(|err| err.to_string())?;
    let runtime = config_pipeline::compile_runtime_catalog(
        source_catalog.config().clone(),
        profile,
        settings,
    )?;
    let runtime_yaml =
        serde_yaml::to_string(runtime.catalog.config()).map_err(|err| err.to_string())?;
    Ok(RuntimeDeploymentPlan {
        source_digest: sha256_text(&source_yaml),
        runtime_digest: sha256_text(&runtime_yaml),
        source_catalog,
        runtime_catalog: runtime.catalog,
        source_yaml,
        runtime_yaml,
        validation: runtime.validation,
    })
}

pub(crate) fn verify_tun_candidate(
    rendered_yaml: &str,
    expected_enabled: bool,
) -> Result<JsonValue, String> {
    let source: YamlValue = serde_yaml::from_str(rendered_yaml)
        .map_err(|err| format!("TUN candidate verification parse failed: {err}"))?;
    let key = |value: &str| YamlValue::String(value.to_string());
    let tun = source.get(key("tun"));
    let configured = tun
        .and_then(|value| value.get(key("enable")))
        .and_then(YamlValue::as_bool)
        .unwrap_or(false);
    if configured != expected_enabled {
        return Err(format!(
            "TUN candidate verification failed: expected enable={expected_enabled}, got {configured}"
        ));
    }
    if expected_enabled {
        let auto_route = tun
            .and_then(|value| value.get(key("auto-route")))
            .and_then(YamlValue::as_bool)
            .unwrap_or(false);
        let auto_detect = tun
            .and_then(|value| value.get(key("auto-detect-interface")))
            .and_then(YamlValue::as_bool)
            .unwrap_or(false);
        let device = tun
            .and_then(|value| value.get(key("device")))
            .and_then(YamlValue::as_str)
            .unwrap_or_default();
        if !auto_route || !auto_detect || device != "Aegos" {
            return Err(
                "TUN candidate verification failed: Aegos device, automatic route, or interface detection is missing"
                    .to_string(),
            );
        }
        config_pipeline::runtime_dns_safety_report(&source)?;
    }
    Ok(json!({
        "configured": configured,
        "device": if expected_enabled { "Aegos" } else { "-" },
        "dnsSafety": !expected_enabled || config_pipeline::runtime_dns_safety_report(&source).is_ok()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::default_settings;

    fn test_profile() -> Profile {
        Profile {
            id: "catalog-test".to_string(),
            name: "Catalog Test".to_string(),
            profile_type: "url".to_string(),
            path: "catalog-test.yaml".to_string(),
            source_url: None,
            node_count: 1,
            proxy_group_count: 1,
            updated_at: "now".to_string(),
            digest: String::new(),
        }
    }

    #[test]
    fn deployment_plan_separates_subscription_source_from_runtime_policy() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: HK 01
    type: ss
    server: hk.example.com
    port: 443
    cipher: aes-128-gcm
    password: airport-secret
proxy-groups:
  - name: Airport
    type: select
    proxies: [HK 01, DIRECT]
rules:
  - MATCH,Airport
"#,
        )
        .expect("source");
        let mut settings = default_settings();
        settings.secret = "aegos-controller-secret".to_string();
        settings.tun_enabled = true;
        let plan = compile_profile_source(source, &test_profile(), &settings)
            .expect("runtime deployment plan");

        assert!(plan.source_yaml.contains("airport-secret"));
        assert!(!plan.source_yaml.contains("aegos-controller-secret"));
        assert!(!plan.source_yaml.contains("external-controller"));
        assert!(!plan.source_yaml.contains("Aegos Landing IP"));
        assert!(plan.runtime_yaml.contains("aegos-controller-secret"));
        assert!(plan.runtime_yaml.contains("external-controller"));
        assert!(plan.runtime_yaml.contains("Aegos Landing IP"));
        assert!(plan.runtime_yaml.contains("device: Aegos"));
        assert_ne!(plan.source_digest, plan.runtime_digest);
        assert_eq!(plan.source_catalog().summary().proxy_count, 1);
        assert!(plan.runtime_catalog().summary().proxy_group_count >= 2);
        assert_eq!(plan.validation.proxies, 1);

        let summaries = format!(
            "{} {}",
            plan.source_catalog().summary_json(),
            plan.runtime_catalog().summary_json()
        );
        assert!(!summaries.contains("airport-secret"));
        assert!(!summaries.contains("hk.example.com"));
        assert!(!summaries.contains("aegos-controller-secret"));
    }

    #[test]
    fn deployment_plan_rejects_non_mapping_source_without_writing() {
        let result = compile_profile_source(
            YamlValue::Sequence(Vec::new()),
            &test_profile(),
            &default_settings(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn source_candidate_is_bound_to_the_compiled_source_digest_and_managed_path() {
        let source: YamlValue = serde_yaml::from_str(
            r#"
proxies:
  - name: Test
    type: direct
proxy-groups:
  - name: Proxies
    type: select
    proxies: [Test, DIRECT]
rules: ["MATCH,Proxies"]
"#,
        )
        .expect("source");
        let plan = compile_profile_source(source, &test_profile(), &default_settings())
            .expect("runtime deployment plan");
        let root = std::env::temp_dir();
        let path = root.join("aegos-source-candidate-test.yaml");
        let candidate = plan
            .source_deployment_candidate(&root, &path, "test deployment")
            .expect("source deployment candidate");
        assert_eq!(candidate.digest(), plan.source_digest);

        let outside = root
            .parent()
            .unwrap_or(root.as_path())
            .join("aegos-source-candidate-outside.yaml");
        assert!(plan
            .source_deployment_candidate(&root, &outside, "outside deployment")
            .is_err());
    }
}
