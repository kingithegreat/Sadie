# SADIE Widget Launcher
# Run this script from anywhere to start the SADIE widget

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$widgetDir = Join-Path $scriptDir "widget"

# Kill any existing Electron processes
Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Starting SADIE Widget..." -ForegroundColor Cyan
Write-Host "Working directory: $widgetDir" -ForegroundColor Gray

Set-Location $widgetDir
npm start
