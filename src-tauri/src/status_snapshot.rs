use super::{lock_state, JsonValue};
use serde_json::json;
use std::sync::{Arc, Mutex};

pub(super) fn cached_status_snapshot(
    cache: &Arc<Mutex<Option<JsonValue>>>,
    operation: JsonValue,
) -> Result<JsonValue, String> {
    let mut status = lock_state(cache, "status cache")?
        .clone()
        .unwrap_or_else(|| {
            json!({
                "coreReady": false,
                "running": false,
                "standby": false,
                "trafficTakeover": false,
                "traffic": {},
                "settings": {},
                "network": { "availability": { "state": "unverified", "networkUsable": false } }
            })
        });
    if let Some(map) = status.as_object_mut() {
        map.insert("runtimeOperation".to_string(), operation);
        map.insert(
            "runtimeObservationMs".to_string(),
            json!({ "cached": true }),
        );
    }
    Ok(status)
}

pub(super) fn cached_connections_snapshot(
    cache: &Arc<Mutex<Option<JsonValue>>>,
) -> Result<JsonValue, String> {
    lock_state(cache, "connections cache")?
        .clone()
        .ok_or_else(|| {
            "Connections are preparing; retry after the active operation publishes its first snapshot"
                .to_string()
        })
}
