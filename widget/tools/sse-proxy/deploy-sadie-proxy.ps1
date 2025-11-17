param()
Write-Host "Deploying SADIE SSE Proxy via Docker Compose (prod)"
docker compose -f docker-compose.prod.yml up --build -d
Write-Host "Deploy finished. Logs: docker compose -f docker-compose.prod.yml logs -f sse-proxy"
