use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::storage_runtime::atomic_write_text_confined;

const TRANSACTION_DIR: &str = "system-takeover-transactions";
const ACTIVE_STATE_FILE: &str = "system-takeover-active.json";
const MAX_REPORTS: usize = 32;
static TRANSACTION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeoverStep {
    pub component: String,
    pub action: String,
    pub state: String,
    pub detail: String,
    pub at_ms: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeoverJournal {
    pub id: String,
    pub operation: String,
    pub component: String,
    pub desired_enabled: bool,
    pub status: String,
    pub started_at_ms: u128,
    pub finished_at_ms: Option<u128>,
    pub steps: Vec<TakeoverStep>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ActiveTakeoverState {
    #[serde(default)]
    pub system_proxy: bool,
    #[serde(default)]
    pub firewall: bool,
    #[serde(default)]
    pub tun: bool,
    #[serde(default)]
    pub updated_at_ms: u128,
}

/// Startup must never silently discard an unreadable takeover journal.  It is
/// unsafe to guess whether Windows state was changed when the durable record
/// is corrupt, so callers surface it as a manual-recovery incident.
#[derive(Clone, Debug, Default)]
pub struct TakeoverRecoveryScan {
    pub pending: Vec<(PathBuf, TakeoverJournal)>,
    pub unreadable_journals: Vec<PathBuf>,
}

impl ActiveTakeoverState {
    pub fn any_active(&self) -> bool {
        self.system_proxy || self.firewall || self.tun
    }

    fn set(&mut self, component: &str, active: bool) -> Result<(), String> {
        match component {
            "system-proxy" => self.system_proxy = active,
            "firewall" => self.firewall = active,
            "tun" => self.tun = active,
            _ => return Err(format!("unknown system takeover component: {component}")),
        }
        self.updated_at_ms = now_ms();
        Ok(())
    }
}

impl TakeoverJournal {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.status.as_str(),
            "verified" | "rolled-back" | "recovered" | "cancelled"
        )
    }
}

pub struct SystemTakeoverTransaction {
    root: PathBuf,
    path: PathBuf,
    journal: TakeoverJournal,
    #[cfg(test)]
    fail_next_complete_persist: bool,
}

impl SystemTakeoverTransaction {
    pub fn begin(
        app_data: &Path,
        operation: impl Into<String>,
        component: impl Into<String>,
        desired_enabled: bool,
    ) -> Result<Self, String> {
        let root = app_data.join(TRANSACTION_DIR);
        fs::create_dir_all(&root)
            .map_err(|err| format!("system takeover transaction directory failed: {err}"))?;
        let started_at_ms = now_ms();
        let id = format!(
            "{}-{started_at_ms}-{}",
            std::process::id(),
            TRANSACTION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let path = root.join(format!("{id}.json"));
        let mut transaction = Self {
            root,
            path,
            journal: TakeoverJournal {
                id,
                operation: operation.into(),
                component: component.into(),
                desired_enabled,
                status: "prepared".to_string(),
                started_at_ms,
                finished_at_ms: None,
                steps: Vec::new(),
            },
            #[cfg(test)]
            fail_next_complete_persist: false,
        };
        transaction.step(
            "transaction",
            "prepare",
            "ok",
            "Previous state will be preserved before changing Windows networking.",
        )?;
        Ok(transaction)
    }

    pub fn step(
        &mut self,
        component: impl Into<String>,
        action: impl Into<String>,
        state: impl Into<String>,
        detail: impl Into<String>,
    ) -> Result<(), String> {
        self.journal.status = "applying".to_string();
        self.journal.steps.push(TakeoverStep {
            component: component.into(),
            action: action.into(),
            state: state.into(),
            detail: detail.into(),
            at_ms: now_ms(),
        });
        self.persist()
    }

    pub fn complete(mut self, detail: impl Into<String>) -> Result<TakeoverJournal, String> {
        self.journal.steps.push(TakeoverStep {
            component: "transaction".to_string(),
            action: "verify".to_string(),
            state: "ok".to_string(),
            detail: detail.into(),
            at_ms: now_ms(),
        });
        self.journal.status = "verified".to_string();
        self.journal.finished_at_ms = Some(now_ms());
        self.persist_complete()?;
        prune_reports(&self.root);
        Ok(self.journal)
    }

    pub fn complete_verified<F>(
        mut self,
        detail: impl Into<String>,
        rollback: F,
    ) -> Result<TakeoverJournal, String>
    where
        F: FnOnce() -> Result<(), String>,
    {
        self.journal.steps.push(TakeoverStep {
            component: "transaction".to_string(),
            action: "verify".to_string(),
            state: "ok".to_string(),
            detail: detail.into(),
            at_ms: now_ms(),
        });
        self.journal.status = "verified".to_string();
        self.journal.finished_at_ms = Some(now_ms());
        if let Err(completion_err) = self.persist_complete() {
            let rollback_result = rollback();
            let rollback_ok = rollback_result.is_ok();
            self.journal.steps.push(TakeoverStep {
                component: "transaction".to_string(),
                action: "rollback".to_string(),
                state: if rollback_ok { "ok" } else { "error" }.to_string(),
                detail: match rollback_result.as_ref() {
                    Ok(()) => format!(
                        "Completion journal failed and the previous Windows network state was restored: {completion_err}"
                    ),
                    Err(rollback_err) => format!(
                        "Completion journal failed: {completion_err}; Windows network rollback also failed: {rollback_err}"
                    ),
                },
                at_ms: now_ms(),
            });
            self.journal.status = if rollback_ok {
                "rolled-back".to_string()
            } else {
                "recovery-required".to_string()
            };
            self.journal.finished_at_ms = rollback_ok.then(now_ms);
            let recovery_journal = self.persist();
            return Err(match (rollback_result, recovery_journal) {
                (Ok(()), Ok(())) => format!(
                    "system takeover completion journal failed and the operation was rolled back: {completion_err}"
                ),
                (Err(rollback_err), Ok(())) => format!(
                    "system takeover completion journal failed: {completion_err}; rollback also failed: {rollback_err}"
                ),
                (Ok(()), Err(journal_err)) => format!(
                    "system takeover completion journal failed: {completion_err}; rollback completed but recovery journal failed: {journal_err}"
                ),
                (Err(rollback_err), Err(journal_err)) => format!(
                    "system takeover completion journal failed: {completion_err}; rollback failed: {rollback_err}; recovery journal failed: {journal_err}"
                ),
            });
        }
        prune_reports(&self.root);
        Ok(self.journal)
    }

    pub fn fail(
        mut self,
        detail: impl Into<String>,
        rolled_back: bool,
    ) -> Result<TakeoverJournal, String> {
        let detail = detail.into();
        self.journal.steps.push(TakeoverStep {
            component: "transaction".to_string(),
            action: if rolled_back { "rollback" } else { "fail" }.to_string(),
            state: if rolled_back { "ok" } else { "error" }.to_string(),
            detail,
            at_ms: now_ms(),
        });
        self.journal.status = if rolled_back {
            "rolled-back".to_string()
        } else {
            "recovery-required".to_string()
        };
        self.journal.finished_at_ms = rolled_back.then(now_ms);
        self.persist()?;
        Ok(self.journal)
    }

    fn persist(&self) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(&self.journal)
            .map_err(|err| format!("system takeover journal serialization failed: {err}"))?;
        atomic_write(&self.path, &raw)
    }

    fn persist_complete(&mut self) -> Result<(), String> {
        #[cfg(test)]
        if self.fail_next_complete_persist {
            self.fail_next_complete_persist = false;
            return Err("injected system takeover completion journal failure".to_string());
        }
        self.persist()
    }

    #[cfg(test)]
    fn inject_complete_persist_failure(&mut self) {
        self.fail_next_complete_persist = true;
    }
}

#[cfg(test)]
pub fn interrupted_transactions(app_data: &Path) -> Vec<(PathBuf, TakeoverJournal)> {
    recovery_scan(app_data).pending
}

pub fn recovery_scan(app_data: &Path) -> TakeoverRecoveryScan {
    let root = app_data.join(TRANSACTION_DIR);
    let Ok(entries) = fs::read_dir(root) else {
        return TakeoverRecoveryScan::default();
    };
    let mut scan = TakeoverRecoveryScan::default();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            scan.unreadable_journals.push(path);
            continue;
        };
        let Ok(journal) = serde_json::from_str::<TakeoverJournal>(&raw) else {
            scan.unreadable_journals.push(path);
            continue;
        };
        if !journal.is_terminal() {
            scan.pending.push((path, journal));
        }
    }
    scan.pending.sort_by_key(|(_, item)| item.started_at_ms);
    scan.unreadable_journals.sort();
    scan
}

pub fn active_takeover_state(app_data: &Path) -> ActiveTakeoverState {
    fs::read_to_string(app_data.join(ACTIVE_STATE_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn set_component_active(
    app_data: &Path,
    component: &str,
    active: bool,
) -> Result<ActiveTakeoverState, String> {
    let path = app_data.join(ACTIVE_STATE_FILE);
    let mut state = active_takeover_state(app_data);
    state.set(component, active)?;
    if state.any_active() {
        let raw = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("active system takeover state serialization failed: {err}"))?;
        atomic_write(&path, &raw)?;
    } else if path.exists() {
        fs::remove_file(&path)
            .map_err(|err| format!("active system takeover state cleanup failed: {err}"))?;
    }
    Ok(state)
}

pub fn mark_recovered(
    path: &Path,
    mut journal: TakeoverJournal,
    detail: impl Into<String>,
    ok: bool,
) -> Result<(), String> {
    journal.steps.push(TakeoverStep {
        component: "startup-recovery".to_string(),
        action: "restore".to_string(),
        state: if ok { "ok" } else { "error" }.to_string(),
        detail: detail.into(),
        at_ms: now_ms(),
    });
    journal.status = if ok {
        "recovered".to_string()
    } else {
        "recovery-required".to_string()
    };
    journal.finished_at_ms = ok.then(now_ms);
    let raw = serde_json::to_string_pretty(&journal)
        .map_err(|err| format!("system takeover recovery report failed: {err}"))?;
    atomic_write(path, &raw)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "system takeover journal path has no parent".to_string())?;
    atomic_write_text_confined(path, parent, content)
}

fn prune_reports(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut files = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    files.sort();
    for path in files.into_iter().rev().skip(MAX_REPORTS) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let sequence = TRANSACTION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("aegos-takeover-{label}-{}-{sequence}", now_ms()))
    }

    #[test]
    fn completed_transaction_is_not_recovered_on_startup() {
        let root = temp_root("complete");
        let mut transaction =
            SystemTakeoverTransaction::begin(&root, "enable proxy", "system-proxy", true).unwrap();
        transaction
            .step("system-proxy", "apply", "ok", "registry updated")
            .unwrap();
        transaction.complete("registry state verified").unwrap();
        assert!(interrupted_transactions(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_transaction_requires_startup_recovery() {
        let root = temp_root("interrupted");
        let mut transaction =
            SystemTakeoverTransaction::begin(&root, "enable tun", "tun", true).unwrap();
        transaction
            .step("tun", "restart", "pending", "core restart started")
            .unwrap();
        drop(transaction);
        let pending = interrupted_transactions(&root);
        assert_eq!(pending.len(), 1);
        mark_recovered(
            &pending[0].0,
            pending[0].1.clone(),
            "previous network state restored",
            true,
        )
        .unwrap();
        assert!(interrupted_transactions(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_transaction_stays_visible_when_rollback_fails() {
        let root = temp_root("failed");
        let transaction =
            SystemTakeoverTransaction::begin(&root, "enable firewall", "firewall", true).unwrap();
        let report = transaction.fail("Windows rejected restore", false).unwrap();
        assert_eq!(report.status, "recovery-required");
        assert_eq!(interrupted_transactions(&root).len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn completion_journal_failure_runs_rollback_and_finishes_terminal() {
        let root = temp_root("complete-fault-rollback-ok");
        let mut transaction =
            SystemTakeoverTransaction::begin(&root, "enable proxy", "system-proxy", true).unwrap();
        transaction
            .step("system-proxy", "apply", "ok", "registry updated")
            .unwrap();
        transaction.inject_complete_persist_failure();
        let rollback_called = std::cell::Cell::new(false);

        let error = transaction
            .complete_verified("registry state verified", || {
                rollback_called.set(true);
                Ok(())
            })
            .unwrap_err();

        assert!(rollback_called.get());
        assert!(error.contains("operation was rolled back"));
        assert!(interrupted_transactions(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn completion_journal_and_rollback_failure_remain_recoverable() {
        let root = temp_root("complete-fault-rollback-failed");
        let mut transaction =
            SystemTakeoverTransaction::begin(&root, "enable firewall", "firewall", true).unwrap();
        transaction
            .step("firewall", "apply", "ok", "rules updated")
            .unwrap();
        transaction.inject_complete_persist_failure();

        let error = transaction
            .complete_verified("firewall state verified", || {
                Err("Windows rejected firewall restore".to_string())
            })
            .unwrap_err();

        assert!(error.contains("rollback also failed"));
        let pending = interrupted_transactions(&root);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].1.status, "recovery-required");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn active_takeover_state_survives_crash_until_each_component_is_cleared() {
        let root = temp_root("active-state");
        let state = set_component_active(&root, "system-proxy", true).unwrap();
        assert!(state.system_proxy);
        set_component_active(&root, "firewall", true).unwrap();
        let loaded = active_takeover_state(&root);
        assert!(loaded.system_proxy && loaded.firewall && loaded.any_active());
        set_component_active(&root, "system-proxy", false).unwrap();
        assert!(active_takeover_state(&root).firewall);
        set_component_active(&root, "firewall", false).unwrap();
        assert!(!active_takeover_state(&root).any_active());
        assert!(!root.join(ACTIVE_STATE_FILE).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_journal_is_reported_instead_of_being_silently_ignored() {
        let root = temp_root("corrupt-journal");
        let transaction_root = root.join(TRANSACTION_DIR);
        fs::create_dir_all(&transaction_root).unwrap();
        fs::write(transaction_root.join("broken.json"), "not json").unwrap();

        let scan = recovery_scan(&root);
        assert!(scan.pending.is_empty());
        assert_eq!(scan.unreadable_journals.len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn active_takeover_state_is_durable_and_removed_after_full_recovery() {
        let root = temp_root("active-state");
        set_component_active(&root, "system-proxy", true).unwrap();
        set_component_active(&root, "tun", true).unwrap();
        assert!(active_takeover_state(&root).system_proxy);
        assert!(active_takeover_state(&root).tun);
        set_component_active(&root, "system-proxy", false).unwrap();
        assert!(active_takeover_state(&root).tun);
        set_component_active(&root, "tun", false).unwrap();
        assert!(!root.join(ACTIVE_STATE_FILE).exists());
        let _ = fs::remove_dir_all(root);
    }
}
