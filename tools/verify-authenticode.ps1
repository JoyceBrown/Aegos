[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('preflight', 'verify')]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'

function Add-Check {
  param(
    [System.Collections.Generic.List[object]]$Checks,
    [string]$Name,
    [bool]$Passed,
    [string]$Detail
  )
  $Checks.Add([pscustomobject]@{
      name = $Name
      ok = $Passed
      detail = $Detail
    })
}

$checks = [System.Collections.Generic.List[object]]::new()
$resolvedInstaller = [System.IO.Path]::GetFullPath($InstallerPath)
Add-Check $checks 'installer exists' (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf) 'candidate path is available'

if ($Mode -eq 'preflight') {
  $certificatePath = [Environment]::GetEnvironmentVariable('AEGOS_SIGNING_CERTIFICATE_PATH')
  $subject = [Environment]::GetEnvironmentVariable('AEGOS_SIGNING_EXPECTED_SUBJECT')
  $timestampUrl = [Environment]::GetEnvironmentVariable('AEGOS_SIGNING_TIMESTAMP_URL')
  $signTool = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue

  Add-Check $checks 'certificate reference is configured' (-not [string]::IsNullOrWhiteSpace($certificatePath) -and (Test-Path -LiteralPath $certificatePath -PathType Leaf)) 'certificate reference is available'
  Add-Check $checks 'expected signing subject is configured' (-not [string]::IsNullOrWhiteSpace($subject)) 'signing subject policy is available'
  $timestampIsHttps = $false
  if (-not [string]::IsNullOrWhiteSpace($timestampUrl)) {
    $timestampUri = $null
    $timestampIsHttps = [System.Uri]::TryCreate($timestampUrl, [System.UriKind]::Absolute, [ref]$timestampUri) -and $timestampUri.Scheme -eq 'https'
  }
  Add-Check $checks 'RFC 3161 timestamp endpoint is HTTPS' $timestampIsHttps 'timestamp policy is available'
  Add-Check $checks 'SignTool is available' ($null -ne $signTool) 'Windows signing tool is available'
} else {
  $subject = [Environment]::GetEnvironmentVariable('AEGOS_SIGNING_EXPECTED_SUBJECT')
  Add-Check $checks 'expected signing subject is configured' (-not [string]::IsNullOrWhiteSpace($subject)) 'signing subject policy is available'
  if (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf) {
    $signature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
    Add-Check $checks 'Authenticode signature is valid' ($signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid) "signature status is $($signature.Status)"
    $actualSubject = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    Add-Check $checks 'signer subject matches policy' (-not [string]::IsNullOrWhiteSpace($subject) -and $actualSubject -eq $subject) 'signer subject matches configured policy'
    Add-Check $checks 'trusted timestamp is present' ($null -ne $signature.TimeStamperCertificate) 'timestamp certificate is present'
  }
}

$result = [pscustomobject]@{
  mode = $Mode
  ok = @($checks | Where-Object { -not $_.ok }).Count -eq 0
  checks = $checks
}
$result | ConvertTo-Json -Depth 4 -Compress
if (-not $result.ok) { exit 2 }
