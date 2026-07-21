use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub const SPEED_RESULT_HIGH_CONFIDENCE_SECS: u64 = 600;
pub const SPEED_RESULT_MEDIUM_CONFIDENCE_SECS: u64 = 1800;

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
}
