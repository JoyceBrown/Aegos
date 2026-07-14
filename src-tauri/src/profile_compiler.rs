use serde_json::Value as JsonValue;
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

fn sha256_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}
