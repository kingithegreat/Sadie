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
  docker run -d --name sadie-n8n -p 5678:5678 -v n8n_data:/home/node/.n8n -e N8N_BASIC_AUTH_ACTIVE=false -e N8N_ENCRYPTION_KEY="sadie-fixed-dev-key-do-not-change" n8nio/n8n
}
