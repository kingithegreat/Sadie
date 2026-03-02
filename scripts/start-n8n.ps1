# Start or ensure n8n Docker container is running
$container = docker ps -a --filter "name=sadie-n8n" --format "{{.Names}}"

if ($container -eq "sadie-n8n") {
  try {
    docker start sadie-n8n | Out-Null
    Write-Output "Started existing sadie-n8n container"
  } catch {
    Write-Output "Failed to start existing sadie-n8n container: $_"
  }
} else {
  Write-Output "Creating and running new sadie-n8n container..."
  # Load N8N_ENCRYPTION_KEY from .env if present
  $envFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".." ".env"
  if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^[^#]' } | ForEach-Object {
      $parts = $_ -split '=', 2; if ($parts.Length -eq 2) { [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim()) }
    }
  }
  $encKey = [Environment]::GetEnvironmentVariable('N8N_ENCRYPTION_KEY')
  if (-not $encKey) { $encKey = 'sadie-fixed-dev-key-do-not-change' }
  docker run -d --name sadie-n8n -p 5678:5678 -v n8n_data:/home/node/.n8n -e N8N_BASIC_AUTH_ACTIVE=false -e "N8N_ENCRYPTION_KEY=$encKey" n8nio/n8n
}
