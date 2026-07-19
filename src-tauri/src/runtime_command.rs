//! Product-level command semantics.
//!
//! This is deliberately independent from Tauri command names and Mihomo API
//! verbs.  It defines which user-visible operations change the Aegos runtime
//! and therefore must be serialized by the runtime coordinator.

use serde::Serialize;
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeCommand {
    StartCore,
    StopCore,
    RestartCore,
    SetActiveProfile,
    RemoveProfile,
    UpdateSettings,
    SetMode,
    ChangeProxy,
    SelectBestProxy,
    RepairSystemProxy,
    RecoverNetwork,
    ApplyRouting,
    EditRoutingGroup,
    EditRoutingRule,
    ResolveUnboundRoutingRule,
    ImportProfile,
    UpdateProfile,
    RenameProfile,
    DiagnosticsRepair,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeCommandClass {
    /// Changes runtime, profile, configuration, or operating-system state.
    ExclusiveMutation,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RuntimeCommandPolicy {
    pub command: RuntimeCommand,
    pub class: RuntimeCommandClass,
    pub cancellable: bool,
}

impl RuntimeCommand {
    pub fn policy(self) -> RuntimeCommandPolicy {
        use RuntimeCommand::*;
        RuntimeCommandPolicy {
            command: self,
            class: RuntimeCommandClass::ExclusiveMutation,
            cancellable: matches!(self, UpdateProfile | DiagnosticsRepair),
        }
    }

    pub fn from_job_kind(value: &str) -> Option<Self> {
        use RuntimeCommand::*;
        Some(match value {
            "startCore" => StartCore,
            "stopCore" => StopCore,
            "restartCore" => RestartCore,
            "setActiveProfile" => SetActiveProfile,
            "removeProfile" => RemoveProfile,
            "updateSettings" | "updateSetting" => UpdateSettings,
            "setMode" => SetMode,
            "changeProxy" => ChangeProxy,
            "selectBestProxy" => SelectBestProxy,
            "repairSystemProxy" => RepairSystemProxy,
            "recoverNetwork" => RecoverNetwork,
            "applyRoutingDrafts" | "undoRoutingApply" => ApplyRouting,
            "applyRoutingGroupEdit" => EditRoutingGroup,
            "applyRoutingRuleEdit" => EditRoutingRule,
            "resolveUnboundRoutingRule" => ResolveUnboundRoutingRule,
            "addProfileUrl" => ImportProfile,
            "updateProfile" | "updateAllProfiles" => UpdateProfile,
            "renameProfile" => RenameProfile,
            "repairDiagnostic" => DiagnosticsRepair,
            _ => return None,
        })
    }

    /// Maps both background-job identifiers and direct Tauri command labels
    /// to the same product command.  The coordinator is deliberately the
    /// only place that knows these transport names.
    pub fn from_operation_label(value: &str) -> Option<Self> {
        if let Some(command) = Self::from_job_kind(value) {
            return Some(command);
        }
        use RuntimeCommand::*;
        Some(match value {
            "update_settings command" | "updateSetting" => UpdateSettings,
            "apply_routing_drafts command" | "undo_last_routing_apply command" => ApplyRouting,
            "recover_network command" => RecoverNetwork,
            "select_best_proxy command" => SelectBestProxy,
            "set_active_profile command" => SetActiveProfile,
            "remove_profile command" => RemoveProfile,
            "save_manual_node command" => ImportProfile,
            "addProfileUrl apply" => ImportProfile,
            "updateProfile apply" => UpdateProfile,
            _ => return None,
        })
    }
}

/// A stable rule for coordinators: two exclusive mutations may not overlap.
/// Measurement and observation work is handled by their dedicated bounded
/// schedulers and must prove they do not change runtime state.
pub fn conflicts(left: RuntimeCommandPolicy, right: RuntimeCommandPolicy) -> bool {
    matches!(left.class, RuntimeCommandClass::ExclusiveMutation)
        && matches!(right.class, RuntimeCommandClass::ExclusiveMutation)
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOperationSnapshot {
    pub sequence: u64,
    pub active_label: Option<String>,
    pub active_command: Option<String>,
    pub active_cancellable: Option<bool>,
    pub started_at_ms: Option<u128>,
}

#[derive(Clone, Default)]
pub struct RuntimeOperationCoordinator {
    gate: Arc<Mutex<()>>,
    snapshot: Arc<Mutex<RuntimeOperationSnapshot>>,
}

pub struct RuntimeOperationLease<'a> {
    _guard: MutexGuard<'a, ()>,
    snapshot: Arc<Mutex<RuntimeOperationSnapshot>>,
    sequence: u64,
}

impl RuntimeOperationCoordinator {
    pub fn acquire(&self, label: &str) -> Result<RuntimeOperationLease<'_>, String> {
        let guard = self.gate.lock().map_err(|_| {
            format!("Runtime command coordinator poisoned while waiting for {label}")
        })?;
        let mut snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "Runtime command snapshot store poisoned".to_string())?;
        snapshot.sequence = snapshot.sequence.saturating_add(1);
        snapshot.active_label = Some(label.to_string());
        let policy = RuntimeCommand::from_operation_label(label).map(RuntimeCommand::policy);
        if let Some(policy) = policy {
            debug_assert!(conflicts(policy, policy));
            snapshot.active_command = Some(format!("{:?}", policy.command));
            snapshot.active_cancellable = Some(policy.cancellable);
        } else {
            snapshot.active_command = None;
            snapshot.active_cancellable = None;
        }
        snapshot.started_at_ms = Some(now_ms());
        let sequence = snapshot.sequence;
        drop(snapshot);
        Ok(RuntimeOperationLease {
            _guard: guard,
            snapshot: Arc::clone(&self.snapshot),
            sequence,
        })
    }

    pub fn snapshot(&self) -> RuntimeOperationSnapshot {
        self.snapshot
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }
}

impl Drop for RuntimeOperationLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut snapshot) = self.snapshot.lock() {
            if snapshot.sequence == self.sequence {
                snapshot.active_label = None;
                snapshot.active_command = None;
                snapshot.active_cancellable = None;
                snapshot.started_at_ms = None;
            }
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_runtime_changing_background_job_has_a_product_command() {
        for kind in [
            "startCore",
            "stopCore",
            "restartCore",
            "setActiveProfile",
            "updateSettings",
            "setMode",
            "changeProxy",
            "recoverNetwork",
            "applyRoutingDrafts",
            "applyRoutingRuleEdit",
            "addProfileUrl",
        ] {
            assert!(RuntimeCommand::from_job_kind(kind).is_some(), "{kind}");
        }
    }

    #[test]
    fn direct_commands_share_the_same_product_command_vocabulary() {
        assert_eq!(
            RuntimeCommand::from_operation_label("apply_routing_drafts command"),
            Some(RuntimeCommand::ApplyRouting)
        );
        assert_eq!(
            RuntimeCommand::from_operation_label("updateProfile apply"),
            Some(RuntimeCommand::UpdateProfile)
        );
    }

    #[test]
    fn network_mutations_conflict_until_runtime_coordinator_serializes_them() {
        let connect = RuntimeCommand::StartCore.policy();
        let routing = RuntimeCommand::ApplyRouting.policy();
        let repair = RuntimeCommand::RecoverNetwork.policy();
        assert!(conflicts(connect, routing));
        assert!(conflicts(routing, repair));
    }

    #[test]
    fn coordinator_publishes_and_clears_the_active_mutation() {
        let coordinator = RuntimeOperationCoordinator::default();
        let lease = coordinator.acquire("changeProxy").expect("lease");
        let active = coordinator.snapshot();
        assert_eq!(active.active_label.as_deref(), Some("changeProxy"));
        assert_eq!(active.active_command.as_deref(), Some("ChangeProxy"));
        drop(lease);
        assert!(coordinator.snapshot().active_label.is_none());
    }
}
