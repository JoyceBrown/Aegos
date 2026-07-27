use super::{lock_state, CoreManager, JsonValue};
use crate::{
    app_config::{Profile, Settings},
    core_domain::TrafficSnapshot,
    diagnostics_runtime::LogEntry,
    speed_runtime::SpeedTestState,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Clone)]
pub(super) struct DiagnosticsSnapshot {
    pub(super) settings: Settings,
    pub(super) profile_metadata_errors: HashMap<String, String>,
    pub(super) active_profile: Option<Profile>,
    pub(super) core_path: PathBuf,
    pub(super) runtime_info: JsonValue,
    pub(super) proxy_snapshot_path: PathBuf,
    pub(super) running: bool,
    pub(super) traffic_takeover: bool,
    pub(super) last_traffic: TrafficSnapshot,
    pub(super) speed_test: SpeedTestState,
    pub(super) lan_ip_cache: String,
    pub(super) outbound_ip_cache: String,
    pub(super) outbound_ip_checked_at: u64,
    pub(super) reliability_failures: u64,
    pub(super) recent_logs: Vec<LogEntry>,
    pub(super) status_logs: Vec<LogEntry>,
}

pub(super) fn take_diagnostics_snapshot_from_core(
    mut core: MutexGuard<'_, CoreManager>,
) -> Result<DiagnosticsSnapshot, String> {
    if let Some(reason) = core.reap_exited_core() {
        core.add_log(reason, "warn");
    }
    let speed_test = lock_state(&core.speed_test, "speed test")?.clone();
    Ok(DiagnosticsSnapshot {
        settings: core.settings.clone(),
        profile_metadata_errors: core.profile_metadata_errors.clone(),
        active_profile: core.active_profile(),
        core_path: core.core_path.clone(),
        runtime_info: core.core_runtime_info(),
        proxy_snapshot_path: core.proxy_snapshot_path.clone(),
        running: core.process.is_some(),
        traffic_takeover: core.traffic_takeover,
        last_traffic: core.last_traffic.clone(),
        speed_test,
        lan_ip_cache: core.lan_ip_cache.clone(),
        outbound_ip_cache: core.cached_outbound_ip(),
        outbound_ip_checked_at: core.outbound_observation.checked_at(),
        reliability_failures: core.reliability_failures,
        recent_logs: core.recent_logs(8),
        status_logs: core.recent_logs(120),
    })
}

pub(super) fn take_diagnostics_snapshot(
    core: Arc<Mutex<CoreManager>>,
) -> Result<DiagnosticsSnapshot, String> {
    take_diagnostics_snapshot_from_core(lock_state(&core, "core")?)
}
