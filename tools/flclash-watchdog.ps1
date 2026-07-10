param(
  [switch]$Once,
  [switch]$Switch,
  [switch]$EnableControllerInConfig,
  [string]$Controller = "http://127.0.0.1:9090",
  [string]$ProxyUri = "http://127.0.0.1:7890",
  [string]$Secret = "",
  [string]$FlClashConfig = "$env:APPDATA\com.follow\clash\config.yaml",
  [string[]]$PreferredGroups = @("Proxies", "GLOBAL", "Proxy", "节点选择"),
  [string[]]$PreferredCandidates = @("HK", "JP", "SG", "TW", "US"),
  [string[]]$TestUrls = @(
    "https://www.gstatic.com/generate_204",
    "https://api.openai.com/",
    "https://github.com/"
  ),
  [int]$IntervalSeconds = 20,
  [int]$FailureThreshold = 2,
  [int]$ProbeTimeoutSeconds = 8,
  [int]$CandidateDelayTimeoutMs = 3500,
  [int]$MaxCandidateDelayMs = 2000,
  [int]$MaxCandidatesPerGroup = 20,
  [string]$DelayTestUrl = "https://www.gstatic.com/generate_204",
  [int]$CooldownSeconds = 15,
  [string]$LogPath = "$PSScriptRoot\flclash-watchdog.log",
  [string]$PidPath = "$PSScriptRoot\flclash-watchdog.pid"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-WatchdogLog {
  param(
    [string]$Message,
    [string]$Level = "INFO"
  )

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$timestamp][$Level] $Message"
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Start-PidFile {
  if ([string]::IsNullOrWhiteSpace($PidPath)) {
    return
  }

  if (Test-Path -LiteralPath $PidPath) {
    try {
      $existingPid = [int](Get-Content -LiteralPath $PidPath -Raw)
      $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
      if ($existingProcess) {
        Write-WatchdogLog "Watchdog is already running. PID=$existingPid" "WARN"
        exit 0
      }
    } catch {
      Write-WatchdogLog "Ignoring stale PID file: $PidPath" "WARN"
    }
  }

  Set-Content -LiteralPath $PidPath -Value $PID -Encoding ASCII
  Write-WatchdogLog "PID file written: $PidPath"
}

function Stop-PidFile {
  if ([string]::IsNullOrWhiteSpace($PidPath)) {
    return
  }

  if (-not (Test-Path -LiteralPath $PidPath)) {
    return
  }

  try {
    $storedPid = [int](Get-Content -LiteralPath $PidPath -Raw)
    if ($storedPid -eq $PID) {
      Remove-Item -LiteralPath $PidPath -Force
      Write-WatchdogLog "PID file removed: $PidPath"
    }
  } catch {
    Write-WatchdogLog "Could not remove PID file. $($_.Exception.Message)" "WARN"
  }
}

function Get-ControllerHeaders {
  if ([string]::IsNullOrWhiteSpace($Secret)) {
    return @{}
  }

  return @{ Authorization = "Bearer $Secret" }
}

function Invoke-ControllerJson {
  param(
    [ValidateSet("GET", "PUT")]
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $request = [System.Net.HttpWebRequest]::Create("$Controller$Path")
  $request.Method = $Method
  $request.Timeout = $ProbeTimeoutSeconds * 1000
  $request.ReadWriteTimeout = $ProbeTimeoutSeconds * 1000

  if (-not [string]::IsNullOrWhiteSpace($Secret)) {
    $request.Headers["Authorization"] = "Bearer $Secret"
  }

  if ($null -ne $Body) {
    $request.ContentType = "application/json; charset=utf-8"
    $bodyText = $Body | ConvertTo-Json -Depth 8 -Compress
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyText)
    $request.ContentLength = $bodyBytes.Length
    $requestStream = $request.GetRequestStream()
    try {
      $requestStream.Write($bodyBytes, 0, $bodyBytes.Length)
    } finally {
      $requestStream.Dispose()
    }
  }

  $response = $request.GetResponse()
  try {
    $stream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
    try {
      $text = $reader.ReadToEnd()
      if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
      }

      return $text | ConvertFrom-Json
    } finally {
      $reader.Dispose()
    }
  } finally {
    $response.Dispose()
  }
}

function Test-ControllerReady {
  try {
    $null = Invoke-ControllerJson -Method GET -Path "/version"
    return $true
  } catch {
    Write-WatchdogLog "FlClash external controller is not reachable at $Controller. Enable External Controller in FlClash settings first." "WARN"
    return $false
  }
}

function Test-ProxiedNetwork {
  foreach ($url in $TestUrls) {
    try {
      $response = Invoke-WebRequest `
        -Uri $url `
        -Proxy $ProxyUri `
        -TimeoutSec $ProbeTimeoutSeconds `
        -UseBasicParsing `
        -Method GET

      if ([int]$response.StatusCode -lt 500) {
        Write-WatchdogLog "Network probe ok via $ProxyUri -> $url ($($response.StatusCode))."
        return $true
      }
    } catch {
      $statusCode = $null
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $statusCode = [int]$_.Exception.Response.StatusCode
      }

      if ($statusCode -and $statusCode -lt 500) {
        Write-WatchdogLog "Network probe reached $url via $ProxyUri ($statusCode)."
        return $true
      }

      Write-WatchdogLog "Network probe failed via $ProxyUri -> $url. $($_.Exception.Message)" "WARN"
    }
  }

  return $false
}

function Test-CandidateName {
  param([string]$Name)

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return $false
  }

  $blocked = @(
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "COMPATIBLE"
  )
  if ($blocked -contains $Name.ToUpperInvariant()) {
    return $false
  }

  if ($Name -match "Traffic|Expire|剩余|到期|套餐|官网|流量|过期") {
    return $false
  }

  return $true
}

function Get-ProxyGroupNames {
  param([object]$Proxies)

  $names = New-Object System.Collections.Generic.List[string]

  foreach ($name in $PreferredGroups) {
    if ($Proxies.PSObject.Properties.Name -contains $name) {
      $names.Add($name)
    }
  }

  foreach ($property in $Proxies.PSObject.Properties) {
    $proxy = $property.Value
    $type = ""
    if ($proxy.PSObject.Properties.Name -contains "type") {
      $type = [string]$proxy.type
    }

    if (($type -match "Selector|URLTest|Fallback|LoadBalance") -and
        ($proxy.PSObject.Properties.Name -contains "all") -and
        -not $names.Contains($property.Name)) {
      $names.Add($property.Name)
    }
  }

  return $names
}

function Get-OrderedProxyCandidates {
  param([object]$Group)

  if (-not ($Group.PSObject.Properties.Name -contains "all")) {
    return @()
  }

  $all = @($Group.all)
  if ($all.Count -eq 0) {
    return @()
  }

  $current = ""
  if ($Group.PSObject.Properties.Name -contains "now") {
    $current = [string]$Group.now
  }

  $start = 0
  $currentIndex = [array]::IndexOf($all, $current)
  if ($currentIndex -ge 0) {
    $start = ($currentIndex + 1) % $all.Count
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  foreach ($preferred in $PreferredCandidates) {
    if ($all -contains $preferred -and $preferred -ne $current -and (Test-CandidateName -Name $preferred)) {
      $candidates.Add($preferred)
      if ($candidates.Count -ge $MaxCandidatesPerGroup) {
        return $candidates.ToArray()
      }
    }
  }

  for ($i = 0; $i -lt $all.Count; $i++) {
    $candidate = [string]$all[($start + $i) % $all.Count]
    if ($candidate -ne $current -and -not $candidates.Contains($candidate) -and (Test-CandidateName -Name $candidate)) {
      $candidates.Add($candidate)
      if ($candidates.Count -ge $MaxCandidatesPerGroup) {
        break
      }
    }
  }

  return $candidates.ToArray()
}

function Measure-ProxyDelay {
  param([string]$Name)

  $encodedName = [uri]::EscapeDataString($Name)
  $encodedUrl = [uri]::EscapeDataString($DelayTestUrl)
  $result = Invoke-ControllerJson -Method GET -Path "/proxies/$encodedName/delay?timeout=$CandidateDelayTimeoutMs&url=$encodedUrl"

  if ($result.PSObject.Properties.Name -contains "delay") {
    return [int]$result.delay
  }

  return $null
}

function Get-HealthyProxyCandidate {
  param([object]$Group)

  $bestName = $null
  $bestDelay = [int]::MaxValue
  $candidates = @(Get-OrderedProxyCandidates -Group $Group)

  foreach ($candidate in $candidates) {
    try {
      $delay = Measure-ProxyDelay -Name $candidate
      if ($null -eq $delay -or $delay -le 0) {
        Write-WatchdogLog "Candidate '$candidate' returned no valid delay." "WARN"
        continue
      }

      if ($delay -gt $MaxCandidateDelayMs) {
        Write-WatchdogLog "Candidate '$candidate' delay ${delay}ms exceeds limit ${MaxCandidateDelayMs}ms." "WARN"
        continue
      }

      Write-WatchdogLog "Candidate '$candidate' is reachable: ${delay}ms."
      if ($delay -lt $bestDelay) {
        $bestDelay = $delay
        $bestName = $candidate
      }
    } catch {
      Write-WatchdogLog "Candidate '$candidate' delay test failed. $($_.Exception.Message)" "WARN"
    }
  }

  if ([string]::IsNullOrWhiteSpace($bestName)) {
    return $null
  }

  return [pscustomobject]@{
    Name  = $bestName
    Delay = $bestDelay
  }
}

function Switch-FlClashRoute {
  if (-not (Test-ControllerReady)) {
    return $false
  }

  $response = Invoke-ControllerJson -Method GET -Path "/proxies"
  if (-not $response.proxies) {
    Write-WatchdogLog "Controller returned no proxies payload." "WARN"
    return $false
  }

  $groupNames = Get-ProxyGroupNames -Proxies $response.proxies
  foreach ($groupName in $groupNames) {
    $group = $response.proxies.$groupName
    $candidate = Get-HealthyProxyCandidate -Group $group
    if ($null -eq $candidate -or [string]::IsNullOrWhiteSpace($candidate.Name)) {
      Write-WatchdogLog "No reachable candidate found for group '$groupName'." "WARN"
      continue
    }

    $encodedGroupName = [uri]::EscapeDataString($groupName)
    if ($Switch) {
      Invoke-ControllerJson -Method PUT -Path "/proxies/$encodedGroupName" -Body @{ name = $candidate.Name } | Out-Null
      Write-WatchdogLog "Switched FlClash group '$groupName' from '$($group.now)' to '$($candidate.Name)' ($($candidate.Delay)ms)."
      return $true
    } else {
      Write-WatchdogLog "Dry run: would switch FlClash group '$groupName' from '$($group.now)' to '$($candidate.Name)' ($($candidate.Delay)ms). Add -Switch to enable." "WARN"
      return $false
    }
  }

  Write-WatchdogLog "No switchable proxy candidate found from controller groups." "WARN"
  return $false
}

function Enable-ExternalControllerInConfig {
  if (-not (Test-Path -LiteralPath $FlClashConfig)) {
    Write-WatchdogLog "FlClash config not found: $FlClashConfig" "WARN"
    return
  }

  $raw = Get-Content -LiteralPath $FlClashConfig -Raw -Encoding UTF8
  if ($raw -match '(?m)^external-controller:\s*"127\.0\.0\.1:9090"\s*$') {
    Write-WatchdogLog "FlClash config already has external-controller enabled."
    return
  }

  $backup = "$FlClashConfig.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
  Copy-Item -LiteralPath $FlClashConfig -Destination $backup

  $next = [regex]::Replace(
    $raw,
    '(?m)^external-controller:\s*.*$',
    'external-controller: "127.0.0.1:9090"',
    1
  )

  Set-Content -LiteralPath $FlClashConfig -Value $next -Encoding UTF8
  Write-WatchdogLog "Enabled external-controller in config and wrote backup: $backup. Restart FlClash core or toggle the setting in FlClash for it to take effect." "WARN"
}

if ($EnableControllerInConfig) {
  Enable-ExternalControllerInConfig
}

Start-PidFile

$failures = 0
Write-WatchdogLog "Started. Proxy=$ProxyUri Controller=$Controller Switch=$Switch Once=$Once Threshold=$FailureThreshold DelayTimeout=${CandidateDelayTimeoutMs}ms MaxDelay=${MaxCandidateDelayMs}ms"

try {
  do {
    if (Test-ProxiedNetwork) {
      $failures = 0
    } else {
      $failures++
      Write-WatchdogLog "All network probes failed. Consecutive failures: $failures/$FailureThreshold" "WARN"

      if ($failures -ge $FailureThreshold) {
        if (Switch-FlClashRoute) {
          Start-Sleep -Seconds $CooldownSeconds
          if (Test-ProxiedNetwork) {
            $failures = 0
          }
        }
      }
    }

    if ($Once) {
      break
    }

    Start-Sleep -Seconds $IntervalSeconds
  } while ($true)
} finally {
  Stop-PidFile
}
