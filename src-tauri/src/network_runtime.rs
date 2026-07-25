//! Windows network takeover verification outside the product coordinator.

use crate::windows_process::run_powershell;
use reqwest::blocking::Client;
use serde_json::Value as JsonValue;
use std::time::Duration;

pub(crate) fn windows_tun_evidence() -> Result<JsonValue, String> {
    let output = run_powershell(
        r#"
$pattern = '(?i)^aegos$'
$adapters = @(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match $pattern } |
  Select-Object Name,InterfaceDescription,Status,ifIndex)
$routes = @()
foreach ($adapter in $adapters) {
  $routes += @(Get-NetRoute -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0','0.0.0.0/1','128.0.0.0/1','::/0','::/1','8000::/1') } |
    Select-Object DestinationPrefix,InterfaceIndex,RouteMetric)
}
[pscustomobject]@{
  adapter_count = $adapters.Count
  active_adapter_count = @($adapters | Where-Object { $_.Status -eq 'Up' }).Count
  route_count = $routes.Count
  adapters = $adapters
  routes = $routes
} | ConvertTo-Json -Depth 5 -Compress
"#,
    )?;
    serde_json::from_str(&output).map_err(|err| format!("TUN evidence parse failed: {err}"))
}

pub(crate) fn direct_connectivity_probe() -> Result<String, String> {
    let client = Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(1800))
        .timeout(Duration::from_millis(3200))
        .user_agent("Aegos/3 tun-verification")
        .build()
        .map_err(|err| format!("TUN connectivity client failed: {err}"))?;
    let endpoints = [
        "https://cp.cloudflare.com/generate_204",
        "https://www.msftconnecttest.com/connecttest.txt",
    ];
    let mut last_error = String::new();
    for endpoint in endpoints {
        match client
            .get(endpoint)
            .send()
            .and_then(|res| res.error_for_status())
        {
            Ok(_) => return Ok(endpoint.to_string()),
            Err(err) => last_error = err.to_string(),
        }
    }
    Err(format!(
        "TUN direct connectivity verification failed: {last_error}"
    ))
}
