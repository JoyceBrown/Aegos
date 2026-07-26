use super::{core_runtime, CoreManager, JsonValue};

fn route_from_policy(policy: Result<JsonValue, String>) -> Option<String> {
    policy.ok().and_then(|value| {
        value
            .get("route")
            .and_then(JsonValue::as_str)
            .map(str::to_string)
    })
}

fn rollback_status(error: Option<String>) -> String {
    error.unwrap_or_else(|| "ok".to_string())
}

impl CoreManager {
    pub(super) fn change_proxy(&mut self, group: &str, proxy: &str) -> Result<bool, String> {
        let groups = self.proxy_groups();
        let preflight = core_runtime::validate_proxy_selection_from_groups(&groups, group, proxy)?;
        if preflight.previous_proxy != proxy {
            self.invalidate_egress_observation();
        }
        let dns_route_before = route_from_policy(self.dns_policy_snapshot());
        let previous_selected_map = self.settings.selected_proxy_map.clone();
        self.add_log(
            format!(
                "Node switch preflight passed: {} -> {} ({})",
                preflight.group, preflight.proxy, preflight.group_type
            ),
            "info",
        );
        let running = self.process.is_some();
        let controller = self.core_controller();
        if running {
            if let Err(apply_error) = controller.apply_proxy_selection_with_cleanup(group, proxy) {
                let rollback_error = if !preflight.previous_proxy.trim().is_empty()
                    && preflight.previous_proxy != proxy
                {
                    controller
                        .apply_proxy_selection_with_cleanup(group, &preflight.previous_proxy)
                        .err()
                } else {
                    None
                };
                return Err(match rollback_error {
                    Some(rollback_error) => format!(
                        "{}; previous runtime node rollback also failed: {}",
                        core_runtime::classified_error("Node switch", apply_error),
                        rollback_error
                    ),
                    None => core_runtime::classified_error("Node switch", apply_error),
                });
            }
        }
        self.settings
            .selected_proxy_map
            .insert(group.to_string(), proxy.to_string());
        if let Err(save_error) = self.save_settings() {
            self.settings.selected_proxy_map = previous_selected_map;
            let rollback_error = if running && !preflight.previous_proxy.trim().is_empty() {
                controller
                    .apply_proxy_selection_with_cleanup(group, &preflight.previous_proxy)
                    .err()
            } else {
                None
            };
            return Err(match rollback_error {
                Some(rollback_error) => format!(
                    "Node preference save failed: {save_error}; runtime rollback also failed: {rollback_error}"
                ),
                None => format!(
                    "Node preference save failed: {save_error}; previous selection was restored"
                ),
            });
        }
        let dns_route_after = route_from_policy(self.dns_policy_snapshot());
        if running && dns_route_before != dns_route_after {
            let profile = self
                .active_profile()
                .ok_or_else(|| "DNS policy reload failed: no active profile".to_string())?;
            if let Err(reload_error) = self.hot_reload_profile(&profile) {
                self.settings.selected_proxy_map = previous_selected_map;
                let settings_rollback = self.save_settings().err();
                let selection_rollback = if !preflight.previous_proxy.trim().is_empty() {
                    controller
                        .apply_proxy_selection_with_cleanup(group, &preflight.previous_proxy)
                        .err()
                } else {
                    None
                };
                let runtime_rollback = self.hot_reload_profile(&profile).err();
                return Err(format!(
                    "DNS policy reload failed after node switch: {reload_error}; settings rollback: {}; node rollback: {}; runtime rollback: {}",
                    rollback_status(settings_rollback),
                    rollback_status(selection_rollback),
                    rollback_status(runtime_rollback)
                ));
            }
            self.add_log(
                format!(
                    "DNS policy switched with current node: {} -> {}",
                    dns_route_before.as_deref().unwrap_or("unknown"),
                    dns_route_after.as_deref().unwrap_or("unknown")
                ),
                "info",
            );
        }
        if running {
            let _ = self.sync_outbound_ip_group_selection();
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_snapshot_ignores_unavailable_policy() {
        assert_eq!(route_from_policy(Err("unavailable".to_string())), None);
    }

    #[test]
    fn rollback_status_preserves_error_or_reports_success() {
        assert_eq!(rollback_status(None), "ok");
        assert_eq!(
            rollback_status(Some("selection failed".to_string())),
            "selection failed"
        );
    }
}
