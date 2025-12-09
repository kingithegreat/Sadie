# SADIE Start Script
# This script checks all dependencies and starts SADIE

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "SADIE Launcher"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "        SADIE Startup Script           " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WidgetDir = Join-Path $ScriptDir "widget"

# Track issues
$issues = @()
$warnings = @()

# ============================================
# 1. Check Node.js
# ============================================
Write-Host "[1/6] Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = $null
try {
    $nodeVersion = node --version 2>$null
}
catch {
    $nodeVersion = $null
}

if ($nodeVersion) {
    Write-Host "  [OK] Node.js $nodeVersion installed" -ForegroundColor Green
}
else {
    $issues += "Node.js is not installed. Download from https://nodejs.org/"
    Write-Host "  [X] Node.js not found" -ForegroundColor Red
}

# ============================================
# 2. Check npm
# ============================================
Write-Host "[2/6] Checking npm..." -ForegroundColor Yellow
$npmVersion = $null
try {
    $npmVersion = npm --version 2>$null
}
catch {
    $npmVersion = $null
}

if ($npmVersion) {
    Write-Host "  [OK] npm $npmVersion installed" -ForegroundColor Green
}
else {
    $issues += "npm is not installed (should come with Node.js)"
    Write-Host "  [X] npm not found" -ForegroundColor Red
}

# ============================================
# 3. Check Docker
# ============================================
Write-Host "[3/6] Checking Docker..." -ForegroundColor Yellow
$dockerVersion = $null
try {
    $dockerVersion = docker --version 2>$null
}
catch {
    $dockerVersion = $null
}

if ($dockerVersion) {
    Write-Host "  [OK] $dockerVersion" -ForegroundColor Green
    
    # Check if Docker is running
    $dockerRunning = $false
    try {
        docker info 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $dockerRunning = $true
        }
    }
    catch {
        $dockerRunning = $false
    }
    
    if ($dockerRunning) {
        Write-Host "  [OK] Docker daemon is running" -ForegroundColor Green
    }
    else {
        $warnings += "Docker is installed but not running."
        Write-Host "  [!] Docker not running" -ForegroundColor Yellow
    }
}
else {
    $warnings += "Docker is not installed. Some features may not work."
    Write-Host "  [!] Docker not found (optional)" -ForegroundColor Yellow
}

# ============================================
# 3b. Check/Start Qdrant (Memory)
# ============================================
if ($dockerRunning) {
    Write-Host "[3b] Checking Qdrant (memory)..." -ForegroundColor Yellow
    
    # Check if Qdrant container exists and is running
    $qdrantStatus = docker ps -a --filter "name=qdrant" --format "{{.Status}}" 2>$null
    
    if ($qdrantStatus -like "Up*") {
        Write-Host "  [OK] Qdrant is running" -ForegroundColor Green
    }
    elseif ($qdrantStatus) {
        # Container exists but stopped, start it
        Write-Host "  -> Starting Qdrant container..." -ForegroundColor Yellow
        docker start qdrant 2>$null | Out-Null
        Start-Sleep -Seconds 3
        Write-Host "  [OK] Qdrant started" -ForegroundColor Green
    }
    else {
        # Container doesn't exist, create it
        Write-Host "  -> Creating Qdrant container..." -ForegroundColor Yellow
        docker run -d --name qdrant -p 6333:6333 -p 6334:6334 -v qdrant_storage:/qdrant/storage qdrant/qdrant 2>$null | Out-Null
        Start-Sleep -Seconds 5
        Write-Host "  [OK] Qdrant created and started" -ForegroundColor Green
    }
}

# ============================================
# 4. Check Ollama
# ============================================
Write-Host "[4/6] Checking Ollama..." -ForegroundColor Yellow
$ollamaRunning = $false

try {
    $ollamaResponse = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    if ($ollamaResponse.StatusCode -eq 200) {
        Write-Host "  [OK] Ollama is running" -ForegroundColor Green
        $ollamaRunning = $true
        
        # Check for required models
        $modelsData = $ollamaResponse.Content | ConvertFrom-Json
        $modelNames = @()
        if ($modelsData.models) {
            $modelNames = $modelsData.models | ForEach-Object { $_.name }
        }
        
        $hasLlama = $false
        $hasLlava = $false
        foreach ($name in $modelNames) {
            if ($name -like "*llama3*") { $hasLlama = $true }
            if ($name -like "*llava*") { $hasLlava = $true }
        }
        
        if ($hasLlama) {
            Write-Host "  [OK] llama3 model available" -ForegroundColor Green
        }
        else {
            $warnings += "llama3 model not found. Run: ollama pull llama3.2:3b"
            Write-Host "  [!] llama3 model not found" -ForegroundColor Yellow
        }
        
        if ($hasLlava) {
            Write-Host "  [OK] llava model available (vision)" -ForegroundColor Green
        }
        else {
            $warnings += "llava model not found (needed for image analysis). Run: ollama pull llava"
            Write-Host "  [!] llava model not found (optional, for images)" -ForegroundColor Yellow
        }
    }
}
catch {
    Write-Host "  [!] Ollama not running, attempting to start..." -ForegroundColor Yellow
    
    # Try to start Ollama
    $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($ollamaCmd) {
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
        Write-Host "  -> Waiting for Ollama to start (10 seconds)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
        
        # Check again
        try {
            $ollamaResponse = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            if ($ollamaResponse.StatusCode -eq 200) {
                Write-Host "  [OK] Ollama started successfully" -ForegroundColor Green
                $ollamaRunning = $true
            }
        }
        catch {
            $issues += "Failed to start Ollama. Please start it manually."
            Write-Host "  [X] Failed to start Ollama" -ForegroundColor Red
        }
    }
    else {
        $issues += "Ollama is not installed. Download from https://ollama.ai/"
        Write-Host "  [X] Ollama not installed" -ForegroundColor Red
    }
}

# ============================================
# 5. Check Widget Dependencies
# ============================================
Write-Host "[5/6] Checking widget dependencies..." -ForegroundColor Yellow
if (Test-Path $WidgetDir) {
    $nodeModules = Join-Path $WidgetDir "node_modules"
    if (Test-Path $nodeModules) {
        Write-Host "  [OK] node_modules exists" -ForegroundColor Green
    }
    else {
        Write-Host "  -> Installing dependencies..." -ForegroundColor Yellow
        Push-Location $WidgetDir
        npm install 2>&1 | Out-Null
        Pop-Location
        Write-Host "  [OK] Dependencies installed" -ForegroundColor Green
    }
    
    # Check if build exists
    $distDir = Join-Path $WidgetDir "dist"
    if (Test-Path $distDir) {
        Write-Host "  [OK] Build exists" -ForegroundColor Green
    }
    else {
        Write-Host "  -> Building widget..." -ForegroundColor Yellow
        Push-Location $WidgetDir
        npm run build 2>&1 | Out-Null
        Pop-Location
        Write-Host "  [OK] Build complete" -ForegroundColor Green
    }
}
else {
    $issues += "Widget directory not found at $WidgetDir"
    Write-Host "  [X] Widget directory not found" -ForegroundColor Red
}

# ============================================
# 6. Check Internet Connection
# ============================================
Write-Host "[6/6] Checking internet connection..." -ForegroundColor Yellow
$hasInternet = $false
try {
    $hasInternet = Test-Connection -ComputerName "google.com" -Count 1 -Quiet -ErrorAction SilentlyContinue
}
catch {
    $hasInternet = $false
}

if ($hasInternet) {
    Write-Host "  [OK] Internet connected (voice input will work)" -ForegroundColor Green
}
else {
    $warnings += "No internet connection. Voice input (speech-to-text) will not work."
    Write-Host "  [!] No internet (voice input disabled)" -ForegroundColor Yellow
}

# ============================================
# Summary
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

if ($issues.Count -gt 0) {
    Write-Host "CRITICAL ISSUES:" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "  [X] $issue" -ForegroundColor Red
    }
    Write-Host ""
}

if ($warnings.Count -gt 0) {
    Write-Host "WARNINGS:" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "  [!] $warning" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($issues.Count -eq 0) {
    Write-Host "All critical checks passed!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Starting SADIE..." -ForegroundColor Cyan
    Write-Host ""
    
    # Set environment variables
    $env:SADIE_DIRECT_OLLAMA = "true"
    $env:OLLAMA_URL = "http://127.0.0.1:11434"
    
    # Start the app
    Push-Location $WidgetDir
    npx electron .
    Pop-Location
}
else {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Please fix the critical issues above before starting SADIE." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
}
