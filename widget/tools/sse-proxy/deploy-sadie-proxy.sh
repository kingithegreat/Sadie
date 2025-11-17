#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Building and deploying SADIE SSE Proxy (prod) via docker-compose..."
docker compose -f docker-compose.prod.yml up --build -d
echo "Deployed. Proxy available on port 5050 (via nginx on 8080)"
echo "To view logs: docker compose -f docker-compose.prod.yml logs -f sse-proxy"
