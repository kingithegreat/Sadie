<#
.SYNOPSIS
    SADIE Preflight Setup & Health Check

.DESCRIPTION
    Verifies all prerequisites, pulls required Ollama models, creates missing
    config files, and prints a summary of what is ready and what needs action.

    Run once after cloning or on a fresh machine before starting SADIE for the
    first time.  Re-running this script is idempotent — it will not overwrite
    any files that already exist and contain valid data.

.EXAMPLE
    .\Setup-SADIE.ps1
    .\Setup-SADIE.ps1 -SkipModelPull
    .\Setup-SADIE.ps1 -Base "D:\projects\sadie"
#>
[CmdletBinding()]
param(
    [string]  $Base           = $PSScriptRoot | Split-Path | Split-Path,
    [switch]  $SkipModelPull,
    [switch]  $Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Write-Step  { param([string]$Msg) if (-not $Quiet) { Write-Host "  $Msg" } }
function Write-Ok    { param([string]$Msg) Write-Host ("  [OK]  " + $Msg) -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host ("  [!!]  " + $Msg) -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host ("  [✗]   " + $Msg) -ForegroundColor Red }
function Write-Head  { param([string]$Msg) Write-Host "`n$Msg" -ForegroundColor Cyan }

$Script:issues = @()

function Record-Issue { param([string]$Msg) $Script:issues += $Msg; Write-Fail $Msg }

# ─── 1. Check prerequisites ───────────────────────────────────────────────────

Write-Head "1/6  Prerequisites"

# Node.js
try {
    $nodeVer = node --version 2>&1
    if ($nodeVer -match '^v(\d+)') {
        $major = [int]$Matches[1]
        if ($major -ge 18) {
            Write-Ok "Node.js $nodeVer"
        } else {
            Record-Issue "Node.js $nodeVer is below v18 minimum. Please upgrade: https://nodejs.org"
        }
    } else {
        Record-Issue "Could not determine Node.js version (got: $nodeVer)"
    }
} catch {
    Record-Issue "Node.js not found. Install from https://nodejs.org"
}

# npm
try {
    $npmVer = npm --version 2>&1
    Write-Ok "npm $npmVer"
} catch {
    Record-Issue "npm not found. It ships with Node.js — reinstall Node."
}

# Docker
try {
    $dockerVer = docker --version 2>&1
    Write-Ok "Docker: $dockerVer"
} catch {
    Write-Warn "Docker not found — n8n workflow orchestration requires Docker. Install from https://docs.docker.com/get-docker/"
    $Script:issues += "Docker not installed (required for n8n)"
}

# Docker running
try {
    $null = docker info 2>&1
    Write-Ok "Docker daemon is running"
} catch {
    Write-Warn "Docker daemon is not running. Start Docker Desktop before launching n8n."
}

# Ollama
try {
    $ollamaVer = ollama --version 2>&1
    Write-Ok "Ollama: $ollamaVer"
} catch {
    Record-Issue "Ollama not found. Install from https://ollama.com/download"
}

# PowerShell version (for tool scripts)
if ($PSVersionTable.PSVersion.Major -ge 5) {
    Write-Ok "PowerShell $($PSVersionTable.PSVersion)"
} else {
    Record-Issue "PowerShell 5 or later required (found $($PSVersionTable.PSVersion))"
}

# ─── 2. Project directory sanity check ───────────────────────────────────────

Write-Head "2/6  Project structure"

$requiredDirs = @(
    "widget",
    "config",
    "scripts",
    "n8n-workflows",
    "memory",
    "logs"
)

foreach ($d in $requiredDirs) {
    $full = Join-Path $Base $d
    if (-not (Test-Path $full)) {
        New-Item -ItemType Directory -Path $full -Force | Out-Null
        Write-Ok "Created missing directory: $d"
    } else {
        Write-Step "Directory OK: $d"
    }
}

# ─── 3. Config files ──────────────────────────────────────────────────────────

Write-Head "3/6  Config files"

# default-config.json
$dfgPath = Join-Path $Base "config\default-config.json"
if (-not (Test-Path $dfgPath)) {
    $defaultConfig = [ordered]@{
        n8nUrl            = "http://localhost:5678"
        ollamaUrl         = "http://localhost:11434"
        chatModel         = "qwen2.5:7b"
        visionModel       = "llava:latest"
        alwaysOnTop       = $false
        widgetHotkey      = "CommandOrControl+Shift+Space"
        telemetryEnabled  = $false
    }
    $defaultConfig | ConvertTo-Json -Depth 3 | Out-File $dfgPath -Encoding UTF8
    Write-Ok "Created default-config.json"
} else {
    Write-Step "default-config.json already exists"
}

# api-allowlist.json
$allowlistPath = Join-Path $Base "config\api-allowlist.json"
if (-not (Test-Path $allowlistPath)) {
    @(
        "# Add additional API hostnames (one per line as a JSON array)",
        "# Example: 'api.myservice.com'",
        "# Built-in allowlist is already in widget/src/main/tools/api-tool.ts"
    ) | Out-Null  # just a reminder — the actual file is JSON:
    '[]' | Out-File $allowlistPath -Encoding UTF8
    Write-Ok "Created config/api-allowlist.json (empty — add custom API hosts here)"
} else {
    Write-Step "api-allowlist.json already exists"
}

# safety-rules.json
$safetyPath = Join-Path $Base "config\safety-rules.json"
if (-not (Test-Path $safetyPath)) {
    Write-Warn "config/safety-rules.json missing — tools that check safety rules may reject all operations."
} else {
    Write-Step "safety-rules.json OK"
}

# tool-allowlist.json
$toolListPath = Join-Path $Base "config\tool-allowlist.json"
if (Test-Path $toolListPath) {
    Write-Step "tool-allowlist.json OK"
} else {
    Write-Warn "config/tool-allowlist.json missing — default allow-all policy will apply."
}

# ─── 4. Widget npm dependencies ───────────────────────────────────────────────

Write-Head "4/6  Widget dependencies"

$widgetDir = Join-Path $Base "widget"
$nodeModules = Join-Path $widgetDir "node_modules"

if (-not (Test-Path $nodeModules)) {
    Write-Step "node_modules not found — running npm install..."
    Push-Location $widgetDir
    try {
        npm install --prefer-offline 2>&1 | Where-Object { $_ -match '(warn|error|added)' } | ForEach-Object { Write-Step $_ }
        Write-Ok "npm install complete"
    } catch {
        Record-Issue "npm install failed: $_"
    } finally {
        Pop-Location
    }
} else {
    Write-Step "node_modules already installed"
}

# ─── 5. Ollama models ─────────────────────────────────────────────────────────

Write-Head "5/6  Ollama models"

$requiredModels = @(
    @{ name = "qwen2.5:7b";           desc = "Primary chat + tool-calling model" },
    @{ name = "qwen2.5-coder:3b";     desc = "Code model (fits in 4GB VRAM)" },
    @{ name = "llava:latest";         desc = "Vision/image analysis model" }
)

if ($SkipModelPull) {
    Write-Warn "Skipping Ollama model pull (--SkipModelPull flag set)"
} else {
    # Fetch list of local models
    try {
        $localModelsRaw = ollama list 2>&1
        $localModels = $localModelsRaw -join "`n"
    } catch {
        $localModels = ""
        Write-Warn "Could not contact Ollama daemon. Make sure 'ollama serve' is running."
    }

    foreach ($model in $requiredModels) {
        $shortName = ($model.name -split ':')[0]
        if ($localModels -match [regex]::Escape($shortName)) {
            Write-Step "Already installed: $($model.name) ($($model.desc))"
        } else {
            Write-Step "Pulling: $($model.name) ($($model.desc))..."
            try {
                ollama pull $model.name 2>&1 | ForEach-Object { Write-Step "  | $_" }
                Write-Ok "Pulled $($model.name)"
            } catch {
                Write-Warn "Could not pull $($model.name): $_  (you can pull it later with: ollama pull $($model.name))"
            }
        }
    }
}

# ─── 6. n8n workflow check ────────────────────────────────────────────────────

Write-Head "6/6  n8n workflows"

$workflowDir = Join-Path $Base "n8n-workflows\core"
if (Test-Path $workflowDir) {
    $workflows = Get-ChildItem -Path $workflowDir -Filter "*.json" -ErrorAction SilentlyContinue
    if ($workflows.Count -gt 0) {
        Write-Ok "$($workflows.Count) workflow JSON files found in n8n-workflows/core/"
        Write-Step "To import them, open n8n (http://localhost:5678) → Workflows → Import from File"
    } else {
        Write-Warn "No workflow JSON files found in n8n-workflows/core/"
    }
} else {
    Write-Warn "n8n-workflows/core/ directory missing"
}

# ─── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SADIE Setup Summary" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

if ($Script:issues.Count -eq 0) {
    Write-Host ""
    Write-Host "  All checks passed! SADIE is ready to start." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor Cyan
    Write-Host "    1. Start Docker, then run: docker compose up -d  (for n8n)" -ForegroundColor Gray
    Write-Host "    2. Import n8n workflows from n8n-workflows/core/" -ForegroundColor Gray
    Write-Host "    3. Run the app:  cd widget  &&  npm run dev" -ForegroundColor Gray
    Write-Host "    4. Or build:     cd widget  &&  npm run build" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  $($Script:issues.Count) issue(s) need attention before SADIE will run correctly:" -ForegroundColor Yellow
    foreach ($issue in $Script:issues) {
        Write-Host "    • $issue" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "  Fix the issues above, then re-run this script." -ForegroundColor Yellow
}

Write-Host ""
