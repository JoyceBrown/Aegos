use serde::Serialize;
use serde_json::{json, Value as JsonValue};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

pub type JobStore = Arc<Mutex<HashMap<String, JobRecord>>>;

#[derive(Clone, Serialize)]
pub struct JobRecord {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub state: String,
    pub started_at: u64,
    pub updated_at: u64,
    pub progress: u64,
    pub total: u64,
    pub message: String,
    pub result: Option<JsonValue>,
    pub error: Option<String>,
    pub cancel_requested: bool,
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

pub fn new_job_record(id: String, kind: String, label: String) -> JobRecord {
    let now = now_secs();
    JobRecord {
        id,
        kind,
        label,
        state: "queued".to_string(),
        started_at: now,
        updated_at: now,
        progress: 0,
        total: 1,
        message: "queued".to_string(),
        result: None,
        error: None,
        cancel_requested: false,
    }
}

pub fn set_job_state(
    jobs: &JobStore,
    id: &str,
    state: &str,
    progress: u64,
    total: u64,
    message: &str,
) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        if job.cancel_requested && job.state == "cancelled" {
            return;
        }
        job.state = state.to_string();
        job.progress = progress;
        job.total = total;
        job.message = message.to_string();
        job.updated_at = now_secs();
    }
}

pub fn job_cancel_requested(jobs: &JobStore, id: &str) -> bool {
    jobs.lock()
        .unwrap()
        .get(id)
        .map(|job| job.cancel_requested)
        .unwrap_or(false)
}

pub fn finish_cancelled(jobs: &JobStore, id: &str, message: &str) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.state = "cancelled".to_string();
        job.message = message.to_string();
        job.updated_at = now_secs();
        job.error = None;
    }
}

pub fn finish_job(jobs: &JobStore, id: &str, result: Result<JsonValue, String>) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.updated_at = now_secs();
        match result {
            Ok(value) => {
                job.state = "succeeded".to_string();
                job.progress = job.total.max(1);
                job.total = job.progress;
                job.message = "done".to_string();
                job.result = Some(value);
                job.error = None;
            }
            Err(err) => {
                job.state = "failed".to_string();
                job.message = err.clone();
                job.error = Some(err);
            }
        }
    }
}

pub fn job_status_snapshot(jobs: &JobStore, id: Option<String>) -> Result<JsonValue, String> {
    let mut jobs = jobs.lock().unwrap();
    let now = now_secs();
    jobs.retain(|_, job| {
        matches!(job.state.as_str(), "queued" | "running")
            || now.saturating_sub(job.updated_at) < 600
    });
    if let Some(id) = id {
        return jobs
            .get(&id)
            .cloned()
            .map(|job| json!(job))
            .ok_or_else(|| "Job not found".to_string());
    }
    let mut items = jobs.values().cloned().collect::<Vec<_>>();
    items.sort_by_key(|job| job.started_at);
    Ok(json!(items))
}

pub fn request_job_cancel(jobs: &JobStore, id: &str) -> Result<JsonValue, String> {
    let mut jobs = jobs.lock().unwrap();
    let job = jobs
        .get_mut(id)
        .ok_or_else(|| "Job not found".to_string())?;
    job.cancel_requested = true;
    if job.state == "queued" {
        job.state = "cancelled".to_string();
        job.message = "Cancelled".to_string();
        job.updated_at = now_secs();
    }
    if job.state == "running" {
        job.message = "cancel requested".to_string();
        job.updated_at = now_secs();
    }
    Ok(json!(job.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_store_cancels_and_prunes_finished_jobs() {
        let jobs: JobStore = Arc::new(Mutex::new(HashMap::new()));
        jobs.lock().unwrap().insert(
            "job-1".to_string(),
            new_job_record(
                "job-1".to_string(),
                "diagnostics".to_string(),
                "diagnostics".to_string(),
            ),
        );

        let cancelled = request_job_cancel(&jobs, "job-1").expect("cancel");
        assert_eq!(
            cancelled.get("state").and_then(JsonValue::as_str),
            Some("cancelled")
        );
        assert!(job_cancel_requested(&jobs, "job-1"));

        let snapshot = job_status_snapshot(&jobs, None).expect("status");
        assert_eq!(snapshot.as_array().map(Vec::len), Some(1));
    }
}
