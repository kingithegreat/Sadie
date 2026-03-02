# generate-env.ps1
# Generates a .env file with a random N8N_ENCRYPTION_KEY if one doesn't exist.
# Safe to run multiple times — will not overwrite an existing .env.

$envPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".." ".env"
$envPath = [System.IO.Path]::GetFullPath($envPath)

if (Test-Path $envPath) {
    Write-Host "[generate-env] .env already exists at $envPath — skipping." -ForegroundColor Yellow
    exit 0
}

# Generate a cryptographically random 32-byte base64 key
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = [System.Convert]::ToBase64String($bytes)

$content = @"
# SADIE Environment Variables — auto-generated $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
# Do NOT commit this file to source control.

N8N_ENCRYPTION_KEY=$key
"@

[System.IO.File]::WriteAllText($envPath, $content, [System.Text.Encoding]::UTF8)
Write-Host "[generate-env] Created .env with a new N8N_ENCRYPTION_KEY." -ForegroundColor Green
Write-Host "[generate-env] Path: $envPath" -ForegroundColor Gray
