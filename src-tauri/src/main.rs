#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn app_status() -> serde_json::Value {
    serde_json::json!({
        "product": "Aegos",
        "version": env!("CARGO_PKG_VERSION"),
        "runtime": "mihomo",
        "shell": "tauri",
        "connected": true,
        "mode": "智能分流",
        "node": {
            "region": "HK",
            "name": "香港实验性 IEPL 专线 1",
            "host": "iepl-1.aegos.local",
            "state": "可用"
        },
        "network": {
            "lanIp": "192.168.0.102",
            "proxyPort": "-",
            "outboundIp": "-"
        },
        "protection": {
            "systemProxy": true,
            "dns": true,
            "tun": true,
            "killSwitch": false
        }
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_status])
        .run(tauri::generate_context!())
        .expect("failed to run Aegos");
}
