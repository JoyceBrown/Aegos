use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub struct SchedulerPolicy {
    pub initial_concurrency: usize,
    pub min_concurrency: usize,
    pub max_concurrency: usize,
    pub adaptive_window: usize,
    pub family_limits: HashMap<String, usize>,
}

impl SchedulerPolicy {
    fn normalized(&self, total: usize) -> Self {
        let max = self.max_concurrency.max(1).min(total.max(1));
        let min = self.min_concurrency.max(1).min(max);
        Self {
            initial_concurrency: self.initial_concurrency.max(min).min(max),
            min_concurrency: min,
            max_concurrency: max,
            adaptive_window: self.adaptive_window.max(1),
            family_limits: self.family_limits.clone(),
        }
    }

    fn family_limit(&self, family: &str) -> usize {
        self.family_limits
            .get(family)
            .copied()
            .unwrap_or(self.max_concurrency)
            .max(1)
    }
}

#[derive(Debug)]
pub struct ProbeOutcome<T, R> {
    pub target: T,
    pub result: R,
    pub worker_id: usize,
    pub queue_ms: u64,
    pub probe_ms: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerReport {
    pub dispatched: usize,
    pub completed: usize,
    pub cancelled: bool,
    pub peak_active: usize,
    pub final_concurrency: usize,
    pub elapsed_ms: u64,
}

struct QueuedTarget<T> {
    target: T,
    queued_at: Instant,
}

struct WorkerResult<T, R> {
    target: T,
    result: R,
    worker_id: usize,
    family: String,
    queue_ms: u64,
    probe_ms: u64,
}

enum WorkerEvent<T, R> {
    Complete(WorkerResult<T, R>),
    Panicked { worker_id: usize, family: String },
}

fn adaptive_concurrency(
    current: usize,
    policy: &SchedulerPolicy,
    completed: usize,
    failures: usize,
    elapsed_ms: u64,
) -> usize {
    if completed == 0 {
        return current;
    }
    let failure_percent = failures.saturating_mul(100) / completed;
    let average_ms = elapsed_ms / completed as u64;
    if failure_percent >= 55 || average_ms >= 3_500 {
        current.saturating_sub(4).max(policy.min_concurrency)
    } else if failure_percent <= 20 && average_ms <= 1_600 {
        (current + 4).min(policy.max_concurrency)
    } else {
        current
    }
}

pub fn run_probe_wave<T, R, Probe, Family, Continue, Consume>(
    targets: Vec<T>,
    policy: SchedulerPolicy,
    probe: Arc<Probe>,
    family_of: Family,
    should_continue: Continue,
    mut consume: Consume,
) -> SchedulerReport
where
    T: Clone + Send + 'static,
    R: Send + 'static,
    Probe: Fn(&T) -> R + Send + Sync + 'static,
    Family: Fn(&T) -> String,
    Continue: Fn() -> bool,
    Consume: FnMut(ProbeOutcome<T, R>) -> bool,
{
    let started = Instant::now();
    let total = targets.len();
    if total == 0 {
        return SchedulerReport::default();
    }
    let policy = policy.normalized(total);
    let worker_count = policy.max_concurrency;
    let (result_tx, result_rx) = mpsc::channel::<WorkerEvent<T, R>>();
    let mut workers = Vec::with_capacity(worker_count);
    let mut worker_senders = Vec::with_capacity(worker_count);

    for worker_id in 0..worker_count {
        let (task_tx, task_rx) = mpsc::sync_channel::<Option<(QueuedTarget<T>, String)>>(1);
        let result_tx = result_tx.clone();
        let probe = probe.clone();
        worker_senders.push(task_tx);
        workers.push(thread::spawn(move || {
            while let Ok(command) = task_rx.recv() {
                let Some((queued, family)) = command else {
                    break;
                };
                let queue_ms = queued.queued_at.elapsed().as_millis() as u64;
                let probe_started = Instant::now();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    probe(&queued.target)
                }));
                let probe_ms = probe_started.elapsed().as_millis() as u64;
                let event = match result {
                    Ok(result) => WorkerEvent::Complete(WorkerResult {
                        target: queued.target,
                        result,
                        worker_id,
                        family,
                        queue_ms,
                        probe_ms,
                    }),
                    Err(_) => WorkerEvent::Panicked { worker_id, family },
                };
                if result_tx.send(event).is_err() {
                    break;
                }
            }
        }));
    }
    drop(result_tx);

    let queued_at = Instant::now();
    let mut pending = targets
        .into_iter()
        .map(|target| QueuedTarget { target, queued_at })
        .collect::<VecDeque<_>>();
    let mut idle_workers = (0..worker_count).rev().collect::<Vec<_>>();
    let mut active_by_family = HashMap::<String, usize>::new();
    let mut active = 0usize;
    let mut current_concurrency = policy.initial_concurrency;
    let mut report = SchedulerReport::default();
    let mut window_completed = 0usize;
    let mut window_failures = 0usize;
    let mut window_elapsed_ms = 0u64;

    while !pending.is_empty() || active > 0 {
        if !should_continue() {
            report.cancelled = true;
            pending.clear();
        }

        while !report.cancelled && active < current_concurrency && !idle_workers.is_empty() {
            let next_index = pending.iter().position(|queued| {
                let family = family_of(&queued.target);
                active_by_family.get(&family).copied().unwrap_or(0) < policy.family_limit(&family)
            });
            let Some(next_index) = next_index else {
                break;
            };
            let Some(queued) = pending.remove(next_index) else {
                break;
            };
            let worker_id = idle_workers.pop().expect("idle worker must exist");
            let family = family_of(&queued.target);
            if worker_senders[worker_id]
                .send(Some((queued, family.clone())))
                .is_err()
            {
                report.cancelled = true;
                break;
            }
            *active_by_family.entry(family).or_insert(0) += 1;
            active += 1;
            report.dispatched += 1;
            report.peak_active = report.peak_active.max(active);
        }

        if active == 0 {
            break;
        }

        let event = match result_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(event) => event,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                report.cancelled = true;
                break;
            }
        };
        let worker = match event {
            WorkerEvent::Complete(worker) => worker,
            WorkerEvent::Panicked { worker_id, family } => {
                active = active.saturating_sub(1);
                idle_workers.push(worker_id);
                if let Some(count) = active_by_family.get_mut(&family) {
                    *count = count.saturating_sub(1);
                }
                report.cancelled = true;
                pending.clear();
                continue;
            }
        };
        active = active.saturating_sub(1);
        idle_workers.push(worker.worker_id);
        if let Some(count) = active_by_family.get_mut(&worker.family) {
            *count = count.saturating_sub(1);
        }
        report.completed += 1;
        window_completed += 1;
        window_elapsed_ms = window_elapsed_ms.saturating_add(worker.probe_ms);
        let success = consume(ProbeOutcome {
            target: worker.target,
            result: worker.result,
            worker_id: worker.worker_id,
            queue_ms: worker.queue_ms,
            probe_ms: worker.probe_ms,
        });
        window_failures += usize::from(!success);

        if window_completed >= policy.adaptive_window {
            current_concurrency = adaptive_concurrency(
                current_concurrency,
                &policy,
                window_completed,
                window_failures,
                window_elapsed_ms,
            );
            window_completed = 0;
            window_failures = 0;
            window_elapsed_ms = 0;
        }
    }

    for sender in &worker_senders {
        let _ = sender.send(None);
    }
    for worker in workers {
        let _ = worker.join();
    }
    report.final_concurrency = current_concurrency;
    report.elapsed_ms = started.elapsed().as_millis() as u64;
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };

    fn policy() -> SchedulerPolicy {
        SchedulerPolicy {
            initial_concurrency: 4,
            min_concurrency: 2,
            max_concurrency: 4,
            adaptive_window: 4,
            family_limits: HashMap::from([("slow".to_string(), 1)]),
        }
    }

    #[test]
    fn fixed_workers_process_every_target() {
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let probe_active = active.clone();
        let probe_peak = peak.clone();
        let probe = Arc::new(move |value: &usize| {
            let current = probe_active.fetch_add(1, Ordering::SeqCst) + 1;
            probe_peak.fetch_max(current, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(2));
            probe_active.fetch_sub(1, Ordering::SeqCst);
            *value
        });
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_out = seen.clone();
        let report = run_probe_wave(
            (0..24).collect(),
            policy(),
            probe,
            |_| "fast".to_string(),
            || true,
            move |outcome| {
                seen_out.lock().unwrap().push(outcome.result);
                true
            },
        );
        assert_eq!(report.completed, 24);
        assert_eq!(seen.lock().unwrap().len(), 24);
        assert!(peak.load(Ordering::SeqCst) <= 4);
    }

    #[test]
    fn family_limit_is_enforced() {
        let slow_active = Arc::new(AtomicUsize::new(0));
        let slow_peak = Arc::new(AtomicUsize::new(0));
        let probe_active = slow_active.clone();
        let probe_peak = slow_peak.clone();
        let probe = Arc::new(move |value: &(usize, &'static str)| {
            if value.1 == "slow" {
                let current = probe_active.fetch_add(1, Ordering::SeqCst) + 1;
                probe_peak.fetch_max(current, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(2));
                probe_active.fetch_sub(1, Ordering::SeqCst);
            }
            value.0
        });
        let targets = (0..12).map(|index| (index, "slow")).collect();
        let report = run_probe_wave(
            targets,
            policy(),
            probe,
            |target| target.1.to_string(),
            || true,
            |_| true,
        );
        assert_eq!(report.completed, 12);
        assert_eq!(slow_peak.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn cancellation_stops_new_dispatches() {
        let allowed = Arc::new(AtomicUsize::new(0));
        let allowed_check = allowed.clone();
        let report = run_probe_wave(
            (0..50).collect(),
            policy(),
            Arc::new(|value: &usize| *value),
            |_| "fast".to_string(),
            move || allowed_check.load(Ordering::SeqCst) < 1,
            move |_| {
                allowed.fetch_add(1, Ordering::SeqCst);
                true
            },
        );
        assert!(report.cancelled);
        assert!(report.dispatched < 50);
    }

    #[test]
    fn worker_panic_terminates_the_wave_instead_of_hanging() {
        let report = run_probe_wave(
            (0..8).collect(),
            policy(),
            Arc::new(|value: &usize| {
                if *value == 0 {
                    panic!("fixture panic");
                }
                *value
            }),
            |_| "fast".to_string(),
            || true,
            |_| true,
        );
        assert!(report.cancelled);
        assert!(report.completed < report.dispatched);
    }
}
