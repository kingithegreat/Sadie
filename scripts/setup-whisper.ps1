<#
.SYNOPSIS
    SADIE Whisper Model Setup Script
.DESCRIPTION
    Downloads the Whisper base.en model for offline speech-to-text via whisper-node.
    Requirements: Node.js + npm (already present), make utility (installed if missing).
    
    whisper-node uses a precompiled whisper.cpp binary. The only download step is
    the GGML model file (~140 MB for base.en).
.NOTES
    Run once before using the voice input feature in SADIE.
    The model is stored in: widget/node_modules/whisper-node/lib/whisper.cpp/models/
#>

$ErrorActionPreference = "Stop"
$script:sadieRoot = $PSScriptRoot | Split-Path -Parent   # scripts/ → project root

Write-Host "=== SADIE Whisper Setup ===" -ForegroundColor Cyan

# ── Step 1: Verify Node/npm ───────────────────────────────────────────────────
Write-Host "`n[1/4] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version 2>&1
    $npmVer  = npm  --version 2>&1
    Write-Host "  Node: $nodeVer   npm: $npmVer" -ForegroundColor Green
} catch {
    Write-Error "Node.js not found. Install from https://nodejs.org and retry."
}

# ── Step 2: Check for 'make' (required by whisper.cpp) ───────────────────────
Write-Host "`n[2/4] Checking for 'make'..." -ForegroundColor Yellow
$makeCmd = Get-Command make -ErrorAction SilentlyContinue
if (-not $makeCmd) {
    Write-Host "  'make' not found. Attempting install via winget..." -ForegroundColor Yellow
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install --id GnuWin32.Make --silent --accept-source-agreements --accept-package-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $makeCmd = Get-Command make -ErrorAction SilentlyContinue
    }
    if (-not $makeCmd) {
        Write-Warning "Could not auto-install 'make'. Install manually: https://gnuwin32.sourceforge.net/packages/make.htm"
        Write-Warning "Alternatively install Git for Windows (includes make) or use WSL."
        Write-Host "`nPress any key to attempt model download anyway (may fail)..." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    } else {
        Write-Host "  make installed: $(make --version | Select-Object -First 1)" -ForegroundColor Green
    }
} else {
    Write-Host "  make found: $($makeCmd.Source)" -ForegroundColor Green
}

# ── Step 3: Ensure whisper-node is installed ──────────────────────────────────
Write-Host "`n[3/4] Checking whisper-node package..." -ForegroundColor Yellow
$widgetDir = Join-Path $script:sadieRoot "widget"
$whisperDir = Join-Path $widgetDir "node_modules\whisper-node"

if (-not (Test-Path $whisperDir)) {
    Write-Host "  Installing whisper-node..." -ForegroundColor Yellow
    Push-Location $widgetDir
    try { npm install whisper-node } finally { Pop-Location }
}

if (Test-Path $whisperDir) {
    Write-Host "  whisper-node found at: $whisperDir" -ForegroundColor Green
} else {
    Write-Error "whisper-node installation failed. Run 'npm install whisper-node' manually in widget/."
}

# ── Step 4: Download the base.en model ───────────────────────────────────────
Write-Host "`n[4/4] Downloading Whisper base.en model (~140 MB)..." -ForegroundColor Yellow

$modelDir = Join-Path $whisperDir "lib\whisper.cpp\models"
$modelFile = Join-Path $modelDir "ggml-base.en.bin"

if (Test-Path $modelFile) {
    $sizeMB = [math]::Round((Get-Item $modelFile).Length / 1MB, 1)
    Write-Host "  Model already downloaded: $modelFile ($sizeMB MB)" -ForegroundColor Green
} else {
    $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
    
    # Ensure model directory exists
    if (-not (Test-Path $modelDir)) { New-Item -ItemType Directory -Path $modelDir -Force | Out-Null }
    
    Write-Host "  Source: $modelUrl"
    Write-Host "  Target: $modelFile"
    
    # Try whisper-node's own download script first
    $downloadScript = Join-Path $whisperDir "lib\whisper.cpp\models\download-ggml-model.sh"
    $downloadScriptPs = Join-Path $whisperDir "lib\whisper.cpp\download-model.js"
    
    $downloaded = $false
    
    if (Test-Path $downloadScriptPs) {
        Write-Host "  Using whisper-node download script..."
        Push-Location $widgetDir
        try { node $downloadScriptPs "base.en"; $downloaded = $true } catch { } finally { Pop-Location }
    }
    
    if (-not $downloaded) {
        Write-Host "  Downloading via Invoke-WebRequest (this may take a few minutes)..."
        
        $progressPreference = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'   # Much faster without progress bar
        try {
            Invoke-WebRequest -Uri $modelUrl -OutFile $modelFile -UseBasicParsing
            $downloaded = $true
        } catch {
            # Fallback: try npx whisper-node download
            Write-Host "  Invoke-WebRequest failed. Trying npx whisper-node..." -ForegroundColor Yellow
            Push-Location $widgetDir
            try { npx whisper-node download "base.en"; $downloaded = $true } catch { } finally { Pop-Location }
        } finally {
            $ProgressPreference = $progressPreference
        }
    }
    
    if ($downloaded -and (Test-Path $modelFile)) {
        $sizeMB = [math]::Round((Get-Item $modelFile).Length / 1MB, 1)
        Write-Host "  Downloaded successfully: $modelFile ($sizeMB MB)" -ForegroundColor Green
    } else {
        Write-Error "Model download failed. Download manually from:`n  $modelUrl`nand place at:`n  $modelFile"
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host "`n=== Whisper setup complete ===" -ForegroundColor Cyan
Write-Host "Voice input is now available in SADIE." -ForegroundColor Green
Write-Host "To use: enable the microphone button in the SADIE chat interface." -ForegroundColor Gray
