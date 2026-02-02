<#
Create the `sadie-webapp` directory layout for Phase 1.
Usage (PowerShell):
  - Open PowerShell as the user who owns the project and run:
    .\create-sadie-webapp.ps1
  - Optionally provide a different base path:
    .\create-sadie-webapp.ps1 -Base "C:\Path\To\sadie"
#>
param(
    [string]$Base = "C:\Users\adenk\Desktop\sadie"
)

$target = Join-Path $Base "sadie-webapp"
$dirs = @(
    $target,
    Join-Path $target "src",
    Join-Path $target "src\components",
    Join-Path $target "public"
)

foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Host "Created: $d"
    }
    else {
        Write-Host "Exists:  $d"
    }
}

Write-Host "\nDirectory listing for $target:" -ForegroundColor Cyan
Get-ChildItem -Path $target -Force | Format-Table Mode, LastWriteTime, Length, Name -AutoSize

Write-Host "\nIf everything looks correct, reply here with 'Phase 1 complete' and paste the output above." -ForegroundColor Green
