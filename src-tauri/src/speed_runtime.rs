use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub const SPEED_RESULT_HIGH_CONFIDENCE_SECS: u64 = 600;
pub const SPEED_RESULT_MEDIUM_CONFIDENCE_SECS: u64 = 1800;
pub const STABILITY_SHORT_WINDOW_SECS: u64 = 10 * 60;
pub const STABILITY_LONG_WINDOW_SECS: u64 = 30 * 60;
const STABILITY_HISTORY_LIMIT: usize = 96;

pub type SpeedTestStore = Arc<Mutex<SpeedTestState>>;

#[derive(Clone)]
pub(crate) struct SpeedTestTarget {
    pub(crate) name: String,
    pub(crate) select_name: String,
    pub(crate) group_name: String,
    pub(crate) protocol: String,
    pub(crate) server: String,
}

#[derive(Clone)]
pub(crate) struct SpeedTargetCatalog {
    pub(crate) key: String,
    pub(crate) profile_id: String,
    pub(crate) targets: Vec<SpeedTestTarget>,
    pub(crate) built_at_ms: u64,
}

#[derive(Clone)]
pub(crate) struct DelayTestResult {
    pub(crate) delay: i64,
    pub(crate) failure_reason: String,
}

impl DelayTestResult {
    pub(crate) fn ok(delay: i64) -> Self {
        Self {
            delay,
            failure_reason: String::new(),
        }
    }

    pub(crate) fn failed(reason: &str) -> Self {
        Self {
            delay: -1,
            failure_reason: reason.to_string(),
        }
    }
}

#[derive(Clone, Default)]
pub struct SpeedTestState {
    pub run_id: u64,
    pub revision: u64,
    pub running: bool,
    pub phase: String,
    pub started_at: u64,
    pub updated_at: u64,
    pub accepted_at_ms: u64,
    pub prepared_at_ms: u64,
    pub first_result_at_ms: u64,
    pub fast_completed_at_ms: u64,
    pub completed_at_ms: u64,
    pub total: usize,
    pub completed: usize,
    pub ok: usize,
    pub failed: usize,
    pub refine_total: usize,
    pub refine_completed: usize,
    pub delays: HashMap<String, i64>,
    pub health: HashMap<String, NodeHealth>,
    pub low_latency: Vec<String>,
    pub recommended: Option<JsonValue>,
    pub error: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct NodeHealth {
    pub name: String,
    pub protocol: String,
    pub last_delay: i64,
    pub median_delay: i64,
    pub jitter: i64,
    pub success_count: u64,
    pub failure_count: u64,
    pub failure_streak: u64,
    pub last_success_at: u64,
    pub last_tested_at: u64,
    pub cooldown_until: u64,
    pub status: String,
    pub confidence: String,
    pub last_failure_reason: String,
    pub score: i64,
    pub observations: Vec<LatencyObservation>,
    pub stability_10m: LatencyStability,
    pub stability_30m: LatencyStability,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct LatencyObservation {
    pub at: u64,
    pub delay: i64,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct LatencyStability {
    pub samples: u64,
    pub average_delay: i64,
    pub mean_absolute_deviation: i64,
    pub variation_per_mille: u64,
}

fn latency_stability(
    observations: &[LatencyObservation],
    now: u64,
    window_secs: u64,
) -> LatencyStability {
    let values = observations
        .iter()
        .filter(|item| item.delay > 0 && now.saturating_sub(item.at) <= window_secs)
        .map(|item| item.delay)
        .collect::<Vec<_>>();
    if values.is_empty() {
        return LatencyStability::default();
    }
    let total = values
        .iter()
        .fold(0i64, |sum, value| sum.saturating_add(*value));
    let average_delay = total / values.len() as i64;
    let deviation_total = values.iter().fold(0i64, |sum, value| {
        sum.saturating_add((value - average_delay).abs())
    });
    let mean_absolute_deviation = deviation_total / values.len() as i64;
    LatencyStability {
        samples: values.len() as u64,
        average_delay,
        mean_absolute_deviation,
        variation_per_mille: if average_delay > 0 {
            (mean_absolute_deviation.saturating_mul(1000) / average_delay) as u64
        } else {
            0
        },
    }
}

fn health_status(delay: i64, failure_streak: u64, cooldown_until: u64, now: u64) -> String {
    if cooldown_until > now {
        "cooldown".to_string()
    } else if delay == 0 {
        "testing".to_string()
    } else if delay > 0 && delay < 100 && failure_streak == 0 {
        "low".to_string()
    } else if delay > 0 {
        "available".to_string()
    } else if failure_streak > 0 {
        "unstable".to_string()
    } else {
        "unknown".to_string()
    }
}

fn health_score(delay: i64, jitter: i64, failure_streak: u64, protocol: &str) -> i64 {
    if delay <= 0 {
        return i64::MAX / 4;
    }
    let protocol_penalty = match protocol.trim().to_ascii_lowercase().as_str() {
        "tuic" | "hysteria" | "hysteria2" => 18,
        "wireguard" => 12,
        _ => 0,
    };
    delay
        .saturating_add(jitter.saturating_mul(2))
        .saturating_add((failure_streak as i64).saturating_mul(120))
        .saturating_add(protocol_penalty)
}

pub fn record_node_health(
    previous: Option<&NodeHealth>,
    name: &str,
    protocol: &str,
    delay: i64,
    failure_reason: &str,
    now: u64,
) -> NodeHealth {
    let mut health = previous.cloned().unwrap_or_default();
    let previous_delay = health.last_delay;
    health.name = name.to_string();
    health.protocol = protocol.to_string();
    health.last_tested_at = now;
    health.last_delay = delay;
    if delay > 0 {
        health.success_count = health.success_count.saturating_add(1);
        health.failure_streak = 0;
        health.last_success_at = now;
        health.cooldown_until = 0;
        health.median_delay = if health.median_delay > 0 {
            (health.median_delay + delay) / 2
        } else {
            delay
        };
        health.jitter = if previous_delay > 0 {
            (delay - previous_delay).abs()
        } else {
            0
        };
        health.last_failure_reason.clear();
        health
            .observations
            .push(LatencyObservation { at: now, delay });
        health
            .observations
            .retain(|item| now.saturating_sub(item.at) <= STABILITY_LONG_WINDOW_SECS);
        if health.observations.len() > STABILITY_HISTORY_LIMIT {
            let keep_from = health.observations.len() - STABILITY_HISTORY_LIMIT;
            health.observations.drain(0..keep_from);
        }
    } else {
        health.failure_count = health.failure_count.saturating_add(1);
        health.failure_streak = health.failure_streak.saturating_add(1);
        health.last_failure_reason = if failure_reason.trim().is_empty() {
            "timeout".to_string()
        } else {
            failure_reason.to_string()
        };
        health.cooldown_until = if health.failure_streak >= 2 {
            now.saturating_add(180)
        } else {
            0
        };
    }
    health.stability_10m =
        latency_stability(&health.observations, now, STABILITY_SHORT_WINDOW_SECS);
    health.stability_30m = latency_stability(&health.observations, now, STABILITY_LONG_WINDOW_SECS);
    health.status = health_status(delay, health.failure_streak, health.cooldown_until, now);
    health.confidence = speed_result_confidence(
        delay,
        health.failure_streak,
        health.last_success_at,
        health.last_tested_at,
        health.cooldown_until,
        now,
    );
    health.score = health_score(
        if health.median_delay > 0 {
            health.median_delay
        } else {
            delay
        },
        health.jitter,
        health.failure_streak,
        protocol,
    );
    health
}

pub fn refining_node_health(
    previous: Option<&NodeHealth>,
    name: &str,
    protocol: &str,
    reason: &str,
    now: u64,
) -> NodeHealth {
    let mut health = previous.cloned().unwrap_or_default();
    health.name = name.to_string();
    health.protocol = protocol.to_string();
    health.last_delay = -1;
    health.last_tested_at = now;
    health.status = "refining".to_string();
    health.confidence = "testing".to_string();
    health.last_failure_reason = format!(
        "refining:{}",
        if reason.trim().is_empty() {
            "timeout"
        } else {
            reason.trim()
        }
    );
    health
}

pub fn speed_result_confidence(
    delay: i64,
    failure_streak: u64,
    last_success_at: u64,
    last_tested_at: u64,
    cooldown_until: u64,
    now: u64,
) -> String {
    if cooldown_until > now {
        return "cooldown".to_string();
    }
    if delay == 0 {
        return "testing".to_string();
    }
    if delay > 0 && failure_streak == 0 && last_success_at > 0 {
        let age = now.saturating_sub(last_success_at);
        if age <= SPEED_RESULT_HIGH_CONFIDENCE_SECS {
            "high".to_string()
        } else if age <= SPEED_RESULT_MEDIUM_CONFIDENCE_SECS {
            "medium".to_string()
        } else {
            "stale".to_string()
        }
    } else if failure_streak > 0 && last_success_at > 0 {
        "low".to_string()
    } else if failure_streak > 0 || last_tested_at > 0 {
        "failed".to_string()
    } else {
        "unknown".to_string()
    }
}

pub fn speed_confidence_summary(speed: &SpeedTestState, now: u64) -> JsonValue {
    let mut high = 0usize;
    let mut medium = 0usize;
    let mut stale = 0usize;
    let mut low = 0usize;
    let mut failed = 0usize;
    let mut cooldown = 0usize;
    let mut testing = 0usize;
    let mut unknown = 0usize;
    let mut newest_success_at = 0u64;

    for item in speed.health.values() {
        let confidence = speed_result_confidence(
            item.last_delay,
            item.failure_streak,
            item.last_success_at,
            item.last_tested_at,
            item.cooldown_until,
            now,
        );
        match confidence.as_str() {
            "high" => high += 1,
            "medium" => medium += 1,
            "stale" => stale += 1,
            "low" => low += 1,
            "failed" => failed += 1,
            "cooldown" => cooldown += 1,
            "testing" => testing += 1,
            _ => unknown += 1,
        }
        newest_success_at = newest_success_at.max(item.last_success_at);
    }

    let fresh = high + medium;
    json!({
        "fresh": fresh,
        "high": high,
        "medium": medium,
        "stale": stale,
        "low": low,
        "failed": failed,
        "cooldown": cooldown,
        "testing": testing,
        "unknown": unknown,
        "newestSuccessAgeSecs": if newest_success_at > 0 { json!(now.saturating_sub(newest_success_at)) } else { JsonValue::Null },
        "recommendedFresh": speed.recommended.as_ref().and_then(|value| value.get("confidence")).and_then(|value| value.as_str()).map(|value| value == "high" || value == "medium").unwrap_or(false)
    })
}

pub fn speed_result_signature(speed: &SpeedTestState) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        speed.run_id,
        speed.revision,
        speed.running,
        speed.phase,
        speed.completed,
        speed.ok,
        speed.failed,
        speed.refine_completed
    )
}

pub fn speed_test_snapshot(speed_test: &SpeedTestStore, now: u64) -> JsonValue {
    let speed = speed_test.lock().unwrap().clone();
    json!({
        "runId": speed.run_id,
        "revision": speed.revision,
        "running": speed.running,
        "phase": speed.phase,
        "startedAt": speed.started_at,
        "updatedAt": speed.updated_at,
        "timing": {
            "acceptedAtMs": speed.accepted_at_ms,
            "preparedAtMs": speed.prepared_at_ms,
            "firstResultAtMs": speed.first_result_at_ms,
            "fastCompletedAtMs": speed.fast_completed_at_ms,
            "completedAtMs": speed.completed_at_ms,
            "prepareMs": speed.prepared_at_ms.saturating_sub(speed.accepted_at_ms),
            "firstResultMs": speed.first_result_at_ms.saturating_sub(speed.accepted_at_ms),
            "fastCompleteMs": speed.fast_completed_at_ms.saturating_sub(speed.accepted_at_ms),
            "totalMs": speed.completed_at_ms.saturating_sub(speed.accepted_at_ms)
        },
        "total": speed.total,
        "completed": speed.completed,
        "ok": speed.ok,
        "failed": speed.failed,
        "refineTotal": speed.refine_total,
        "refineCompleted": speed.refine_completed,
        "error": speed.error,
        "delays": speed.delays,
        "health": speed.health,
        "resultSignature": speed_result_signature(&speed),
        "confidence": speed_confidence_summary(&speed, now),
        "lowLatency": speed.low_latency,
        "recommended": speed.recommended
    })
}

pub fn speed_test_progress_snapshot(speed_test: &SpeedTestStore) -> JsonValue {
    let speed = speed_test.lock().unwrap();
    json!({
        "runId": speed.run_id,
        "revision": speed.revision,
        "running": speed.running,
        "phase": speed.phase,
        "startedAt": speed.started_at,
        "updatedAt": speed.updated_at,
        "total": speed.total,
        "completed": speed.completed,
        "ok": speed.ok,
        "failed": speed.failed,
        "refineTotal": speed.refine_total,
        "refineCompleted": speed.refine_completed,
        "error": speed.error,
        "timing": {
            "acceptedAtMs": speed.accepted_at_ms,
            "preparedAtMs": speed.prepared_at_ms,
            "firstResultAtMs": speed.first_result_at_ms,
            "fastCompletedAtMs": speed.fast_completed_at_ms,
            "completedAtMs": speed.completed_at_ms,
            "prepareMs": speed.prepared_at_ms.saturating_sub(speed.accepted_at_ms),
            "firstResultMs": speed.first_result_at_ms.saturating_sub(speed.accepted_at_ms),
            "fastCompleteMs": speed.fast_completed_at_ms.saturating_sub(speed.accepted_at_ms),
            "totalMs": speed.completed_at_ms.saturating_sub(speed.accepted_at_ms)
        },
        "resultSignature": speed_result_signature(&speed),
        "recommended": speed.recommended
    })
}

pub fn mark_speed_test_preparing(speed_test: &SpeedTestStore, now: u64) -> JsonValue {
    {
        let mut speed = speed_test.lock().unwrap();
        if !speed.running {
            let previous_health = speed.health.clone();
            let run_id = speed.run_id.saturating_add(1);
            *speed = SpeedTestState {
                run_id,
                revision: speed.revision.saturating_add(1),
                running: true,
                phase: "preparing".to_string(),
                started_at: now,
                updated_at: now,
                accepted_at_ms: epoch_millis(),
                prepared_at_ms: 0,
                first_result_at_ms: 0,
                fast_completed_at_ms: 0,
                completed_at_ms: 0,
                total: 0,
                completed: 0,
                ok: 0,
                failed: 0,
                refine_total: 0,
                refine_completed: 0,
                delays: HashMap::new(),
                health: previous_health,
                low_latency: Vec::new(),
                recommended: None,
                error: None,
            };
        }
    }
    speed_test_snapshot(speed_test, now)
}

pub fn mark_single_speed_test_preparing(
    speed_test: &SpeedTestStore,
    name: &str,
    now: u64,
) -> Result<JsonValue, String> {
    {
        let mut speed = speed_test.lock().unwrap();
        if speed.running {
            return Err(
                "A speed test is already running; this node will receive the shared result."
                    .to_string(),
            );
        }
        let previous_health = speed.health.clone();
        let run_id = speed.run_id.saturating_add(1);
        let mut delays = HashMap::new();
        delays.insert(name.to_string(), 0);
        *speed = SpeedTestState {
            run_id,
            revision: speed.revision.saturating_add(1),
            running: true,
            phase: "preparing".to_string(),
            started_at: now,
            updated_at: now,
            accepted_at_ms: epoch_millis(),
            prepared_at_ms: 0,
            first_result_at_ms: 0,
            fast_completed_at_ms: 0,
            completed_at_ms: 0,
            total: 1,
            completed: 0,
            ok: 0,
            failed: 0,
            refine_total: 0,
            refine_completed: 0,
            delays,
            health: previous_health,
            low_latency: Vec::new(),
            recommended: None,
            error: None,
        };
    }
    Ok(speed_test_snapshot(speed_test, now))
}

pub fn speed_test_run_is_current(speed_test: &SpeedTestStore, run_id: u64) -> bool {
    let speed = speed_test.lock().unwrap();
    speed.running && speed.run_id == run_id
}

pub fn fail_speed_test_if_current(
    speed_test: &SpeedTestStore,
    run_id: u64,
    message: String,
    now: u64,
) {
    let mut speed = speed_test.lock().unwrap();
    if speed.run_id == run_id {
        speed.revision = speed.revision.saturating_add(1);
        speed.running = false;
        speed.phase = "failed".to_string();
        speed.completed_at_ms = epoch_millis();
        speed.error = Some(message);
        speed.updated_at = now;
    }
}

pub fn reset_speed_test_state(
    speed_test: &SpeedTestStore,
    reason: &str,
    clear_health: bool,
    now: u64,
) {
    let mut speed = speed_test.lock().unwrap();
    let run_id = speed.run_id.saturating_add(1);
    let health = if clear_health {
        HashMap::new()
    } else {
        speed.health.clone()
    };
    *speed = SpeedTestState {
        run_id,
        revision: speed.revision.saturating_add(1),
        running: false,
        phase: "cancelled".to_string(),
        updated_at: now,
        completed_at_ms: epoch_millis(),
        health,
        error: Some(reason.to_string()),
        ..SpeedTestState::default()
    };
}

fn epoch_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speed_store_preserves_health_when_preparing_new_run() {
        let store: SpeedTestStore = Arc::new(Mutex::new(SpeedTestState::default()));
        store.lock().unwrap().health.insert(
            "node-a".to_string(),
            NodeHealth {
                name: "node-a".to_string(),
                last_delay: 66,
                last_success_at: 10,
                last_tested_at: 10,
                confidence: "high".to_string(),
                ..NodeHealth::default()
            },
        );

        let snapshot = mark_speed_test_preparing(&store, 12);
        assert_eq!(
            snapshot.get("running").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert!(store.lock().unwrap().health.contains_key("node-a"));
    }

    #[test]
    fn speed_store_cancel_bumps_run_and_keeps_health_by_default() {
        let store: SpeedTestStore = Arc::new(Mutex::new(SpeedTestState::default()));
        store.lock().unwrap().health.insert(
            "node-a".to_string(),
            NodeHealth {
                name: "node-a".to_string(),
                last_delay: 88,
                ..NodeHealth::default()
            },
        );

        reset_speed_test_state(&store, "cancelled", false, 22);
        let speed = store.lock().unwrap();
        assert_eq!(speed.run_id, 1);
        assert!(!speed.running);
        assert!(speed.health.contains_key("node-a"));
        assert_eq!(speed.error.as_deref(), Some("cancelled"));
    }

    #[test]
    fn single_speed_prepare_cannot_replace_an_active_batch() {
        let store: SpeedTestStore = Arc::new(Mutex::new(SpeedTestState {
            run_id: 7,
            running: true,
            total: 20,
            ..SpeedTestState::default()
        }));
        let error = mark_single_speed_test_preparing(&store, "node-a", 30)
            .expect_err("active batch must win");
        assert!(error.contains("already running"));
        let speed = store.lock().unwrap();
        assert_eq!(speed.run_id, 7);
        assert_eq!(speed.total, 20);
    }

    #[test]
    fn confidence_tracks_fresh_stale_and_failed_results() {
        assert_eq!(speed_result_confidence(0, 0, 0, 1, 0, 1), "testing");
        assert_eq!(speed_result_confidence(80, 0, 100, 100, 0, 120), "high");
        assert_eq!(speed_result_confidence(80, 0, 100, 100, 0, 800), "medium");
        assert_eq!(speed_result_confidence(80, 0, 100, 100, 0, 2200), "stale");
        assert_eq!(speed_result_confidence(-1, 2, 0, 100, 0, 120), "failed");
        assert_eq!(
            speed_result_confidence(80, 0, 100, 100, 200, 120),
            "cooldown"
        );
    }

    #[test]
    fn rolling_stability_uses_each_node_history_and_prunes_old_samples() {
        let first = record_node_health(None, "stable", "trojan", 300, "", 1_000);
        let second = record_node_health(Some(&first), "stable", "trojan", 304, "", 1_060);
        let stable = record_node_health(Some(&second), "stable", "trojan", 296, "", 1_120);
        assert_eq!(stable.stability_10m.samples, 3);
        assert_eq!(stable.stability_30m.samples, 3);
        assert!(stable.stability_10m.variation_per_mille <= 80);
        assert!(stable.stability_30m.variation_per_mille <= 80);

        let volatile = record_node_health(Some(&stable), "stable", "trojan", 80, "", 1_180);
        let volatile = record_node_health(Some(&volatile), "stable", "trojan", 520, "", 1_240);
        let volatile = record_node_health(Some(&volatile), "stable", "trojan", 90, "", 1_300);
        assert!(volatile.stability_10m.variation_per_mille > 200);
        assert!(volatile.stability_30m.variation_per_mille > 200);

        let expired = record_node_health(Some(&volatile), "stable", "trojan", 300, "", 3_200);
        assert_eq!(expired.stability_30m.samples, 1);
        assert_eq!(expired.observations.len(), 1);
    }
}
