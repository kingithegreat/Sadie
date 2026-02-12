Param()

$appStart = Join-Path $env:APPDATA 'SADIE\logs\startup.log'
$appConsent = Join-Path $env:APPDATA 'SADIE\logs\telemetry-consent.log'

$tempStartup = Get-ChildItem -Path "$env:TEMP\sadie-test-*\logs\startup.log" -ErrorAction SilentlyContinue | Select-Object -First 1
$tempConsent = Get-ChildItem -Path "$env:TEMP\sadie-test-*\logs\telemetry-consent.log" -ErrorAction SilentlyContinue | Select-Object -First 1

$toTail = @()

if (Test-Path $appStart) { $toTail += $appStart } elseif ($tempStartup) { $toTail += $tempStartup.FullName }
if (Test-Path $appConsent) { $toTail += $appConsent } elseif ($tempConsent) { $toTail += $tempConsent.FullName }

if ($toTail.Count -eq 0) {
  Write-Output "No log files found to tail."
  Write-Output "Checked: $appStart"
  Write-Output "Checked: $appConsent"
  if ($tempStartup) { Write-Output "Found temp startup: $($tempStartup.FullName)" }
  if ($tempConsent) { Write-Output "Found temp consent: $($tempConsent.FullName)" }
  exit 2
} else {
  Write-Output "Tailing files:"
  $toTail | ForEach-Object { Write-Output " - $_" }
  Get-Content -Path $toTail -Tail 50 -Wait
}
