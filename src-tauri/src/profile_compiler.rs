use serde_json::{json, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

use crate::{config_pipeline, Profile, Settings};

pub(crate) struct RenderedProfile {
    pub(crate) yaml: String,
    pub(crate) digest: String,
    pub(crate) report: JsonValue,
}

pub(crate) fn compile_profile_file(
    profile: &Profile,
    settings: &Settings,
) -> Result<RenderedProfile, String> {
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
) -> Result<RenderedProfile, String> {
    let runtime = config_pipeline::preflight_profile_source(source, profile, settings)?;
    let yaml = serde_yaml::to_string(&runtime.config).map_err(|err| err.to_string())?;
    Ok(RenderedProfile {
        digest: sha256_text(&yaml),
        yaml,
        report: runtime.report,
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

fn sha256_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}
