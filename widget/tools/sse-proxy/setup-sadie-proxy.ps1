<#
PowerShell setup script for SADIE SSE Proxy
Usage: .\setup-sadie-proxy.ps1 [-Mode dev|prod]
#>
param(
  [ValidateSet('dev','prod')][string]$Mode = 'dev'
)

function Read-Secret([string]$prompt) {
  Write-Host -NoNewline "$prompt: ";
  return Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
}

Write-Host "Setting up SADIE SSE Proxy in '$Mode' mode"

if (-not (Test-Path .\node_modules)) {
  Write-Host "Installing dependencies..."
  npm install
}

$port = Read-Host -Prompt "Proxy port (default 5050)";
if (-not $port) { $port = 5050 }

$proxyKey = Read-Host -Prompt "Proxy API Key (changeme)"; if (-not $proxyKey) { $proxyKey = 'changeme' }
$adminKey = Read-Host -Prompt "Admin Key (adminchangeme)"; if (-not $adminKey) { $adminKey = 'adminchangeme' }
$openaiKey = Read-Host -Prompt "OpenAI API Key (optional)";

Write-Host "Writing .env..."
@"
PORT=$port
PROXY_API_KEYS=$proxyKey
PROXY_REQUIRE_API_KEY=true
ADMIN_API_KEY=$adminKey
OPENAI_API_KEY=$openaiKey
REDIS_URL=redis://localhost:6379
ENFORCE_SERVER_AUTH=true
"@ | Out-File -FilePath .env -Encoding utf8

if ($Mode -eq 'dev') {
  Write-Host "Starting dev server (hot-reload)..."
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev"
} else {
  Write-Host "Building and running via Docker Compose (prod)..."
  docker compose -f docker-compose.prod.yml up --build -d
}

Write-Host "Spinning up mock upstream..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node dist/test/mock-upstream.js"

Write-Host "Testing SSE proxy with mock upstream..."
Start-Sleep 2
$testCmd = "curl -N -X POST 'http://localhost:$port/stream' -H 'Content-Type: application/json' -H 'x-sadie-key: $proxyKey' -d '{\"provider\":\"openai\",\"model\":\"test\",\"prompt\":\"test\" }'"
Write-Host "Run this curl to test streaming:"
Write-Host $testCmd

Write-Host "Setup complete. Visit http://localhost:$port/admin/ui (admin header required)"
