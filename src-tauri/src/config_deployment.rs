use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConfigDeploymentReport {
    pub id: String,
    pub operation: String,
    pub profile_id: String,
    pub active_path: String,
    pub previous_digest: Option<String>,
    pub candidate_digest: String,
    pub state: String,
    pub created_at_ms: u128,
    pub detail: String,
}

#[derive(Clone, Debug)]
pub struct ConfigDeploymentCandidate {
    active_root: PathBuf,
    active_path: PathBuf,
    operation: String,
    profile_id: String,
    content: String,
    digest: String,
}

impl ConfigDeploymentCandidate {
    pub fn new(
        active_root: &Path,
        active_path: &Path,
        operation: impl Into<String>,
        profile_id: impl Into<String>,
        content: impl Into<String>,
    ) -> Result<Self, String> {
        ensure_within(active_path, active_root)?;
        let content = content.into();
        if content.trim().is_empty() {
            return Err("config deployment candidate content is empty".to_string());
        }
        Ok(Self {
            active_root: active_root.to_path_buf(),
            active_path: active_path.to_path_buf(),
            operation: operation.into(),
            profile_id: profile_id.into(),
            digest: digest(&content),
            content,
        })
    }

    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }
}

#[derive(Clone, Debug)]
pub struct ConfigDeploymentTransaction {
    state_dir: PathBuf,
    active_root: PathBuf,
    active_path: PathBuf,
    candidate_path: PathBuf,
    backup_path: PathBuf,
    journal_path: PathBuf,
    report: ConfigDeploymentReport,
    #[cfg(test)]
    injected_fault: Option<TestDeploymentFault>,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TestDeploymentFault {
    CompleteJournal,
    RollbackActive,
    RollbackJournal,
}

impl ConfigDeploymentTransaction {
    pub fn stage(state_root: &Path, candidate: ConfigDeploymentCandidate) -> Result<Self, String> {
        ensure_within(&candidate.active_path, &candidate.active_root)?;
        fs::create_dir_all(state_root)
            .map_err(|err| format!("config deployment state directory create failed: {err}"))?;
        let state_dir = state_root.join("config-deployments");
        fs::create_dir_all(&state_dir)
            .map_err(|err| format!("config deployment journal directory create failed: {err}"))?;

        let previous = if candidate.active_path.exists() {
            Some(fs::read_to_string(&candidate.active_path).map_err(|err| {
                format!(
                    "config deployment read active config failed {}: {err}",
                    candidate.active_path.display()
                )
            })?)
        } else {
            None
        };
        let now = now_ms();
        let id = format!("{}-{}", std::process::id(), now);
        let candidate_path = state_dir.join(format!("{id}.candidate"));
        let backup_path = state_dir.join(format!("{id}.backup"));
        let journal_path = state_dir.join(format!("{id}.json"));
        let mut report = ConfigDeploymentReport {
            id,
            operation: candidate.operation,
            profile_id: candidate.profile_id,
            active_path: candidate.active_path.to_string_lossy().to_string(),
            previous_digest: previous.as_deref().map(digest),
            candidate_digest: candidate.digest,
            state: "staged".to_string(),
            created_at_ms: now,
            detail: "Candidate prepared; active configuration has not changed.".to_string(),
        };
        atomic_write(&candidate_path, &candidate.content)?;
        let staged = fs::read_to_string(&candidate_path).map_err(|err| {
            format!("config deployment candidate verification read failed: {err}")
        })?;
        if digest(&staged) != report.candidate_digest {
            let _ = fs::remove_file(&candidate_path);
            return Err("config deployment candidate digest verification failed".to_string());
        }
        write_report(&journal_path, &report)?;
        if let Some(previous) = previous {
            atomic_write(&backup_path, &previous)?;
        }
        report.detail = "Candidate and rollback snapshot are ready.".to_string();
        write_report(&journal_path, &report)?;
        Ok(Self {
            state_dir,
            active_root: candidate.active_root,
            active_path: candidate.active_path,
            candidate_path,
            backup_path,
            journal_path,
            report,
            #[cfg(test)]
            injected_fault: None,
        })
    }

    pub fn promote(&mut self) -> Result<(), String> {
        ensure_within(&self.active_path, &self.active_root)?;
        let candidate = fs::read_to_string(&self.candidate_path)
            .map_err(|err| format!("config deployment candidate is unavailable: {err}"))?;
        if digest(&candidate) != self.report.candidate_digest {
            return Err("config deployment candidate changed after validation".to_string());
        }
        atomic_write(&self.active_path, &candidate)?;
        let active = fs::read_to_string(&self.active_path)
            .map_err(|err| format!("config deployment active verification read failed: {err}"))?;
        if digest(&active) != self.report.candidate_digest {
            return Err("config deployment active digest verification failed".to_string());
        }
        self.report.state = "promoted".to_string();
        self.report.detail =
            "Candidate atomically replaced active configuration; runtime verification is pending."
                .to_string();
        write_report(&self.journal_path, &self.report)
    }

    pub fn complete(
        &mut self,
        detail: impl Into<String>,
    ) -> Result<ConfigDeploymentReport, String> {
        self.report.state = "verified".to_string();
        self.report.detail = detail.into();
        #[cfg(test)]
        self.fail_if_injected(TestDeploymentFault::CompleteJournal)?;
        write_report(&self.journal_path, &self.report)?;
        let _ = fs::remove_file(&self.candidate_path);
        self.prune_reports();
        Ok(self.report.clone())
    }

    pub fn rollback(
        &mut self,
        detail: impl Into<String>,
    ) -> Result<ConfigDeploymentReport, String> {
        #[cfg(test)]
        self.fail_if_injected(TestDeploymentFault::RollbackActive)?;
        if self.backup_path.exists() {
            let previous = fs::read_to_string(&self.backup_path)
                .map_err(|err| format!("config deployment rollback snapshot read failed: {err}"))?;
            atomic_write(&self.active_path, &previous)?;
        } else if self.report.previous_digest.is_none() && self.active_path.exists() {
            fs::remove_file(&self.active_path)
                .map_err(|err| format!("config deployment rollback remove failed: {err}"))?;
        } else {
            return Err("config deployment rollback snapshot is unavailable".to_string());
        }
        self.report.state = "rolled-back".to_string();
        self.report.detail = detail.into();
        #[cfg(test)]
        self.fail_if_injected(TestDeploymentFault::RollbackJournal)?;
        write_report(&self.journal_path, &self.report)?;
        let _ = fs::remove_file(&self.candidate_path);
        Ok(self.report.clone())
    }

    pub fn rollback_with_runtime<F>(
        &mut self,
        detail: impl Into<String>,
        restore_runtime: F,
    ) -> Result<ConfigDeploymentReport, String>
    where
        F: FnOnce() -> Result<(), String>,
    {
        let config_restore = self.rollback(detail);
        let runtime_restore = restore_runtime();
        match (config_restore, runtime_restore) {
            (Ok(report), Ok(())) => Ok(report),
            (Err(config_err), Ok(())) => Err(format!(
                "configuration rollback failed: {config_err}; runtime restore was still attempted and completed"
            )),
            (Ok(_), Err(runtime_err)) => Err(format!(
                "configuration rollback completed; runtime restore failed: {runtime_err}"
            )),
            (Err(config_err), Err(runtime_err)) => Err(format!(
                "configuration rollback failed: {config_err}; runtime restore also failed: {runtime_err}"
            )),
        }
    }

    pub fn complete_verified<F>(
        &mut self,
        detail: impl Into<String>,
        restore_runtime: F,
    ) -> Result<ConfigDeploymentReport, String>
    where
        F: FnOnce() -> Result<(), String>,
    {
        let detail = detail.into();
        match self.complete(detail) {
            Ok(report) => Ok(report),
            Err(completion_err) => {
                let rollback = self.rollback_with_runtime(
                    format!("verified deployment finalization failed: {completion_err}"),
                    restore_runtime,
                );
                Err(match rollback {
                    Ok(_) => format!(
                        "deployment finalization failed and configuration/runtime were rolled back: {completion_err}"
                    ),
                    Err(rollback_err) => format!(
                        "deployment finalization failed: {completion_err}; rollback was incomplete: {rollback_err}"
                    ),
                })
            }
        }
    }

    #[cfg(test)]
    fn inject_fault(&mut self, fault: TestDeploymentFault) {
        self.injected_fault = Some(fault);
    }

    #[cfg(test)]
    fn fail_if_injected(&mut self, fault: TestDeploymentFault) -> Result<(), String> {
        if self.injected_fault == Some(fault) {
            self.injected_fault = None;
            Err(format!("injected deployment fault: {fault:?}"))
        } else {
            Ok(())
        }
    }

    fn prune_reports(&self) {
        let Ok(entries) = fs::read_dir(&self.state_dir) else {
            return;
        };
        let mut reports = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                (path.extension().and_then(|item| item.to_str()) == Some("json")).then_some(path)
            })
            .collect::<Vec<_>>();
        reports.sort();
        for path in reports.into_iter().rev().skip(24) {
            let stem = path
                .file_stem()
                .and_then(|item| item.to_str())
                .unwrap_or_default();
            let _ = fs::remove_file(&path);
            let _ = fs::remove_file(self.state_dir.join(format!("{stem}.backup")));
            let _ = fs::remove_file(self.state_dir.join(format!("{stem}.candidate")));
        }
    }
}

pub fn recover_interrupted_deployments(state_root: &Path, active_root: &Path) -> Vec<String> {
    let state_dir = state_root.join("config-deployments");
    let Ok(entries) = fs::read_dir(&state_dir) else {
        return Vec::new();
    };
    let mut recovered = Vec::new();
    for entry in entries.flatten() {
        let journal_path = entry.path();
        if journal_path.extension().and_then(|item| item.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&journal_path) else {
            continue;
        };
        let Ok(mut report) = serde_json::from_str::<ConfigDeploymentReport>(&raw) else {
            continue;
        };
        if report.state != "promoted" {
            continue;
        }
        let active_path = PathBuf::from(&report.active_path);
        if ensure_within(&active_path, active_root).is_err() {
            continue;
        }
        let backup = state_dir.join(format!("{}.backup", report.id));
        let restore: Result<(), String> = if backup.exists() {
            fs::read_to_string(&backup)
                .map_err(|err| format!("config deployment recovery snapshot read failed: {err}"))
                .and_then(|text| atomic_write(&active_path, &text))
        } else if report.previous_digest.is_none() {
            if active_path.exists() {
                fs::remove_file(&active_path)
                    .map_err(|err| format!("config deployment recovery remove failed: {err}"))
            } else {
                Ok(())
            }
        } else {
            Err("config deployment recovery snapshot is missing".to_string())
        };
        if restore.is_ok() {
            report.state = "recovered-after-interruption".to_string();
            report.detail = "A previous configuration deployment did not complete runtime verification and was restored on startup.".to_string();
            if write_report(&journal_path, &report).is_ok() {
                recovered.push(report.operation);
            }
        }
    }
    recovered
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

fn digest(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn ensure_within(path: &Path, root: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let path = canonicalize_allow_missing(&path)?;
    if path.starts_with(&root) {
        Ok(())
    } else {
        Err(format!(
            "config deployment refused path outside managed root: {}",
            path.display()
        ))
    }
}

fn canonicalize_allow_missing(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path.to_path_buf();
    let mut missing = Vec::new();
    while !existing.exists() {
        let name = existing
            .file_name()
            .ok_or_else(|| {
                format!(
                    "config deployment path has no existing ancestor: {}",
                    path.display()
                )
            })?
            .to_os_string();
        missing.push(name);
        if !existing.pop() {
            return Err(format!(
                "config deployment path has no existing ancestor: {}",
                path.display()
            ));
        }
    }
    let mut normalized = fs::canonicalize(&existing).map_err(|err| {
        format!(
            "config deployment path normalization failed {}: {err}",
            existing.display()
        )
    })?;
    for name in missing.into_iter().rev() {
        normalized.push(name);
    }
    Ok(normalized)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "config deployment path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("config deployment parent create failed: {err}"))?;
    let file_name = path
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("config");
    let temp = parent.join(format!(".{file_name}.{}.tmp", now_ms()));
    {
        let mut file = fs::File::create(&temp)
            .map_err(|err| format!("config deployment temp create failed: {err}"))?;
        file.write_all(content.as_bytes())
            .map_err(|err| format!("config deployment temp write failed: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("config deployment temp sync failed: {err}"))?;
    }
    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("config deployment atomic replace failed: {err}")
    })
}

fn write_report(path: &Path, report: &ConfigDeploymentReport) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(report)
        .map_err(|err| format!("config deployment report serialization failed: {err}"))?;
    atomic_write(path, &raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("aegos-config-deployment-{label}-{}", now_ms()))
    }

    #[test]
    fn promotes_verified_candidate_and_keeps_a_rollback_snapshot() {
        let root = temp_root("promote");
        let profiles = root.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        let active = profiles.join("active.yaml");
        atomic_write(&active, "old: true\n").unwrap();
        let candidate =
            ConfigDeploymentCandidate::new(&profiles, &active, "rule apply", "p1", "new: true\n")
                .unwrap();
        let mut transaction = ConfigDeploymentTransaction::stage(&root, candidate).unwrap();
        transaction.promote().unwrap();
        assert_eq!(fs::read_to_string(&active).unwrap(), "new: true\n");
        let report = transaction
            .complete("controller and runtime identity verified")
            .unwrap();
        assert_eq!(report.state, "verified");
        assert!(root
            .join("config-deployments")
            .join(format!("{}.backup", report.id))
            .exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rolls_back_an_existing_config_after_runtime_failure() {
        let root = temp_root("rollback");
        let profiles = root.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        let active = profiles.join("active.yaml");
        atomic_write(&active, "old: true\n").unwrap();
        let candidate =
            ConfigDeploymentCandidate::new(&profiles, &active, "rule apply", "p1", "new: true\n")
                .unwrap();
        let mut transaction = ConfigDeploymentTransaction::stage(&root, candidate).unwrap();
        transaction.promote().unwrap();
        let report = transaction.rollback("runtime reload failed").unwrap();
        assert_eq!(report.state, "rolled-back");
        assert_eq!(fs::read_to_string(&active).unwrap(), "old: true\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn completion_journal_failure_rolls_back_config_and_runtime() {
        let root = temp_root("complete-fault");
        let profiles = root.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        let active = profiles.join("active.yaml");
        atomic_write(&active, "old: true\n").unwrap();
        let candidate =
            ConfigDeploymentCandidate::new(&profiles, &active, "rule apply", "p1", "new: true\n")
                .unwrap();
        let mut transaction = ConfigDeploymentTransaction::stage(&root, candidate).unwrap();
        transaction.promote().unwrap();
        transaction.inject_fault(TestDeploymentFault::CompleteJournal);
        let runtime_restored = std::cell::Cell::new(false);

        let error = transaction
            .complete_verified("runtime verified", || {
                runtime_restored.set(true);
                Ok(())
            })
            .unwrap_err();

        assert!(error.contains("finalization failed"));
        assert!(runtime_restored.get());
        assert_eq!(fs::read_to_string(&active).unwrap(), "old: true\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn runtime_restore_is_attempted_when_active_config_rollback_fails() {
        let root = temp_root("rollback-active-fault");
        let profiles = root.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        let active = profiles.join("active.yaml");
        atomic_write(&active, "old: true\n").unwrap();
        let candidate =
            ConfigDeploymentCandidate::new(&profiles, &active, "rule apply", "p1", "new: true\n")
                .unwrap();
        let mut transaction = ConfigDeploymentTransaction::stage(&root, candidate).unwrap();
        transaction.promote().unwrap();
        transaction.inject_fault(TestDeploymentFault::RollbackActive);
        let runtime_attempted = std::cell::Cell::new(false);

        let error = transaction
            .rollback_with_runtime("runtime apply failed", || {
                runtime_attempted.set(true);
                Ok(())
            })
            .unwrap_err();

        assert!(error.contains("configuration rollback failed"));
        assert!(runtime_attempted.get());
        assert_eq!(fs::read_to_string(&active).unwrap(), "new: true\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn runtime_restore_is_attempted_when_rollback_journal_write_fails() {
        let root = temp_root("rollback-journal-fault");
        let profiles = root.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        let active = profiles.join("active.yaml");
        atomic_write(&active, "old: true\n").unwrap();
        let candidate =
            ConfigDeploymentCandidate::new(&profiles, &active, "rule apply", "p1", "new: true\n")
                .unwrap();
        let mut transaction = ConfigDeploymentTransaction::stage(&root, candidate).unwrap();
        transaction.promote().unwrap();
        transaction.inject_fault(TestDeploymentFault::RollbackJournal);
        let runtime_attempted = std::cell::Cell::new(false);

        let error = transaction
            .rollback_with_runtime("runtime apply failed", || {
                runtime_attempted.set(true);
                Ok(())
            })
            .unwrap_err();

        assert!(error.contains("configuration rollback failed"));
        assert!(runtime_attempted.get());
        assert_eq!(fs::read_to_string(&active).unwrap(), "old: true\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn startup_recovers_promoted_but_unverified_config() {
        let root = temp_root("recovery");
        let profiles = root.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        let active = profiles.join("active.yaml");
        atomic_write(&active, "old: true\n").unwrap();
        let candidate =
            ConfigDeploymentCandidate::new(&profiles, &active, "rule apply", "p1", "new: true\n")
                .unwrap();
        let mut transaction = ConfigDeploymentTransaction::stage(&root, candidate).unwrap();
        transaction.promote().unwrap();
        drop(transaction);
        let recovered = recover_interrupted_deployments(&root, &profiles);
        assert_eq!(recovered, vec!["rule apply"]);
        assert_eq!(fs::read_to_string(&active).unwrap(), "old: true\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn managed_path_guard_accepts_missing_children_and_rejects_escape() {
        let root = temp_root("path-guard");
        let profiles = root.join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        assert!(ensure_within(&profiles.join("new.yaml"), &profiles).is_ok());
        assert!(ensure_within(&root.join("outside.yaml"), &profiles).is_err());
        assert!(ConfigDeploymentCandidate::new(
            &profiles,
            &active_path_for_test(&profiles),
            "empty",
            "p1",
            "  "
        )
        .is_err());
        let _ = fs::remove_dir_all(root);
    }

    fn active_path_for_test(root: &Path) -> PathBuf {
        root.join("candidate.yaml")
    }
}
