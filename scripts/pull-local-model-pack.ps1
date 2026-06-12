param(
  [int]$MaxRounds = 20,
  [int]$WaitSeconds = 30
)

$ErrorActionPreference = 'Stop'

$desiredModels = @(
  'qwen2.5:7b',
  'qwen2.5-coder:7b',
  'moondream',
  'nomic-embed-text',
  'gemma4:e4b'
)

function Normalize-ModelId {
  param([string]$Model)

  if ([string]::IsNullOrWhiteSpace($Model)) {
    return ''
  }

  $normalized = $Model.Trim().ToLowerInvariant()
  if ($normalized.EndsWith(':latest')) {
    $normalized = $normalized.Substring(0, $normalized.Length - 7)
  }

  return $normalized
}

function Get-MissingModels {
  param(
    [string[]]$Desired,
    [string[]]$Installed
  )

  $installedNormalized = @{}
  foreach ($model in $Installed) {
    $installedNormalized[(Normalize-ModelId $model)] = $true
  }

  return $Desired | Where-Object {
    -not $installedNormalized.ContainsKey((Normalize-ModelId $_))
  }
}

function Get-InstalledModels {
  $lines = ollama list | Select-Object -Skip 1
  return ($lines | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ })
}

function Test-OllamaRegistryDns {
  try {
    $null = Resolve-DnsName -Name 'registry.ollama.ai' -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

Write-Host "Target local model set:" -ForegroundColor Cyan
$desiredModels | ForEach-Object { Write-Host " - $_" }

for ($round = 1; $round -le $MaxRounds; $round++) {
  Write-Host "`n=== Round $round/$MaxRounds ===" -ForegroundColor Yellow

  if (-not (Test-OllamaRegistryDns)) {
    Write-Host "DNS for registry.ollama.ai is unavailable. Waiting $WaitSeconds seconds..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds $WaitSeconds
    continue
  }

  $installed = Get-InstalledModels
  $missing = Get-MissingModels -Desired $desiredModels -Installed $installed

  if (-not $missing -or $missing.Count -eq 0) {
    Write-Host "All target models are installed." -ForegroundColor Green
    break
  }

  Write-Host "Missing models:" -ForegroundColor Cyan
  $missing | ForEach-Object { Write-Host " - $_" }

  foreach ($model in $missing) {
    Write-Host "`nPulling $model" -ForegroundColor Magenta
    try {
      ollama pull $model
    } catch {
      Write-Host "Pull failed for ${model}: $($_.Exception.Message)" -ForegroundColor Red
    }
  }

  $installedAfter = Get-InstalledModels
  $stillMissing = Get-MissingModels -Desired $desiredModels -Installed $installedAfter

  if (-not $stillMissing -or $stillMissing.Count -eq 0) {
    Write-Host "All target models are installed." -ForegroundColor Green
    break
  }

  Write-Host "Still missing after round ${round}:" -ForegroundColor DarkYellow
  $stillMissing | ForEach-Object { Write-Host " - $_" }

  if ($round -lt $MaxRounds) {
    Write-Host "Waiting $WaitSeconds seconds before retry..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds $WaitSeconds
  }
}

$finalInstalled = Get-InstalledModels
$finalMissing = Get-MissingModels -Desired $desiredModels -Installed $finalInstalled

Write-Host "`n=== Final status ===" -ForegroundColor Cyan
if (-not $finalMissing -or $finalMissing.Count -eq 0) {
  Write-Host "All target models are installed." -ForegroundColor Green
  exit 0
}

Write-Host "Some models are still missing:" -ForegroundColor Red
$finalMissing | ForEach-Object { Write-Host " - $_" }
exit 1
