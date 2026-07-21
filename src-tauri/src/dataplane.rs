//! Dataplane identity and compatibility boundary.
//!
//! Aegos owns product intent, state, deployment, diagnostics, and recovery.
//! A dataplane adapter owns protocol execution and controller translation.
//! Adding another engine must implement this boundary instead of branching
//! product services on engine-specific strings.

use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::core_domain::ProxyCatalog;

pub(crate) const ENGINE: &str = "mihomo";
pub(crate) const EXPECTED_VERSION: &str = "v1.19.28";
pub(crate) const EXPECTED_SHA256: &str =
    "c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517";

pub(crate) const APPROVED_ENGINE_FEATURES: &[&str] = &[
    "gvisor",
    "process-routing",
    "runtime-config-reload",
    "local-controller-secret",
    "standby-delay-probe",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataplaneCapabilityManifest {
    pub(crate) engine: &'static str,
    pub(crate) version: &'static str,
    pub(crate) sha256: &'static str,
    pub(crate) features: &'static [&'static str],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataplaneUpgradeAssessment {
    pub(crate) approved: bool,
    pub(crate) reason: String,
    pub(crate) required_features: Vec<String>,
}

pub(crate) fn approved_dataplane_manifest() -> DataplaneCapabilityManifest {
    DataplaneCapabilityManifest {
        engine: ENGINE,
        version: EXPECTED_VERSION,
        sha256: EXPECTED_SHA256,
        features: APPROVED_ENGINE_FEATURES,
    }
}

pub(crate) fn assess_dataplane_candidate(
    version: &str,
    sha256: &str,
    features: &[&str],
) -> DataplaneUpgradeAssessment {
    let required_features = APPROVED_ENGINE_FEATURES
        .iter()
        .map(|feature| (*feature).to_string())
        .collect::<Vec<_>>();
    if version.trim() != EXPECTED_VERSION {
        return DataplaneUpgradeAssessment {
            approved: false,
            reason: format!(
                "Dataplane version {} is not approved for this Aegos release (expected {}).",
                version.trim(),
                EXPECTED_VERSION
            ),
            required_features,
        };
    }
    if !sha256.trim().eq_ignore_ascii_case(EXPECTED_SHA256) {
        return DataplaneUpgradeAssessment {
            approved: false,
            reason: "Dataplane checksum does not match the approved release artifact.".to_string(),
            required_features,
        };
    }
    let missing = APPROVED_ENGINE_FEATURES
        .iter()
        .filter(|feature| !features.iter().any(|candidate| candidate == *feature))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return DataplaneUpgradeAssessment {
            approved: false,
            reason: format!(
                "Dataplane candidate is missing required capability: {}.",
                missing.join(", ")
            ),
            required_features,
        };
    }
    DataplaneUpgradeAssessment {
        approved: true,
        reason: "Dataplane artifact identity and Aegos control-plane capabilities are approved."
            .to_string(),
        required_features,
    }
}

/// Product-facing control surface. Raw controller envelopes, URLs, and engine
/// configuration never cross this boundary.
pub(crate) trait DataplaneControl: Send + Sync {
    fn proxy_catalog_snapshot(&self, hidden_group_names: &[&str]) -> Result<ProxyCatalog, String>;
    fn apply_auxiliary_proxy_selection(&self, group: &str, proxy: &str) -> Result<(), String>;
    fn provider_healthcheck_snapshot(&self) -> Result<JsonValue, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approved_manifest_binds_identity_to_capabilities() {
        let manifest = approved_dataplane_manifest();
        assert_eq!(manifest.engine, ENGINE);
        assert_eq!(manifest.version, EXPECTED_VERSION);
        assert_eq!(manifest.sha256, EXPECTED_SHA256);
        assert!(manifest.features.contains(&"runtime-config-reload"));
        assert!(manifest.features.contains(&"local-controller-secret"));
    }

    #[test]
    fn candidate_requires_exact_identity_and_capabilities() {
        let manifest = approved_dataplane_manifest();
        assert!(
            assess_dataplane_candidate(manifest.version, manifest.sha256, manifest.features)
                .approved
        );
        assert!(!assess_dataplane_candidate("v0.0.0", manifest.sha256, manifest.features).approved);
        assert!(!assess_dataplane_candidate(manifest.version, "bad", manifest.features).approved);
        assert!(
            !assess_dataplane_candidate(
                manifest.version,
                manifest.sha256,
                &["runtime-config-reload"]
            )
            .approved
        );
    }
}
