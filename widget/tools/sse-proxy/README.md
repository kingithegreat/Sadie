# SADIE SSE Proxy

This microservice forwards streaming responses from vision/text models (OpenAI / Ollama) to clients via Server-Sent Events (SSE).

Features
- POST `/stream` endpoint
- Forwards streaming requests to OpenAI or Ollama
- Supports `messages`, `prompt`, and base64 `images[]`
- Streams model output back as SSE: `data: { "chunk": "..." }`, `data: { "error": true }`, `data: [DONE]`
- Handles client disconnects (AbortController)
- Timeout handling
- CORS, body-size limits, basic validation and logging
 - Optional API key authentication via `x-sadie-key` header

Requirements
- Node 18+ (or Node with `undici` compatibility)
- n8n or SADIE configured to call this proxy for streaming

Quick start

Install dependencies:

```powershell
cd widget/tools/sse-proxy
npm install
```

Development

```powershell
npm run dev
```

Integration test (manual)
1. Build the project:
```powershell
npm run build
```
2. Start the mock upstream in one terminal (or run the test harness):
```powershell
node dist/test/mock-upstream.js
```
3. In another terminal, start the proxy:
```powershell
npm run start
```
4. Run the integration script (this will fire a request and print SSE chunks):
```powershell
node dist/test/run-integration.js
```

WebSocket support
 - The proxy exposes a WebSocket endpoint at `ws://<host>:5050/ws`.
 - Connect and send the initial JSON body (same schema as /stream). The proxy will stream chunks via the WebSocket connection.
 - Example (JavaScript):
 ```js
 const ws = new WebSocket('ws://localhost:5050/ws');
 ws.onopen = () => {
   ws.send(JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini-vision', prompt: 'Describe this image' }));
 };
 ws.onmessage = (m) => { console.log('CHUNK', JSON.parse(m.data)); };
 ws.onclose = () => { console.log('closed'); };
 ```


Production build & run

```powershell
npm run build
npm run start
```

Default config is in `proxy.config.json`. Use environment variables for overrides (e.g. `OLLAMA_ENDPOINT`, `OPENAI_ENDPOINT`, `PORT`).

Environment variables
- `PROXY_API_KEY` — single API key string.
- `PROXY_API_KEYS` — comma-separated API keys string (e.g. `k1,k2,k3`). Overrides `proxyApiKeys` in the config.
- `PROXY_REQUIRE_API_KEY` — set to `true` to enforce key requirement (or `false`). Defaults to the `requireApiKey` in `proxy.config.json`.
 - `KEY_ENCRYPTION_SECRET` — optional; if provided, admin-persisted keys will be encrypted using this secret.
 - `ADMIN_API_KEY` — optional admin API key (or set in config file under `admin.adminApiKey`) for admin endpoints.

Set keys in Powershell (example):
```powershell
$env:PROXY_API_KEYS = "changeme,otherkey"
npm run dev
```

Authentication
- The proxy supports API keys for request authentication. When enabled (via `requireApiKey` in `proxy.config.json` or `PROXY_REQUIRE_API_KEY=true` env), every POST `/stream` must include the header `x-sadie-key: <key>` where `<key>` is one of the configured keys (via `proxyApiKeys` in config or `PROXY_API_KEYS` comma-separated env var or `PROXY_API_KEY` single key). If missing or invalid, the proxy returns a 401 with an SSE error frame:

```
data: { "error": true, "code": "AUTH_FAILED", "message": "Invalid or missing API key" }
```

Admin endpoints
- The proxy exposes admin endpoints to manage API keys (enable via `admin.enabled` in `proxy.config.json` or `ADMIN_ENDPOINT_ENABLED=true` env).
- Endpoints:
  - GET `/admin/keys` — list keys (masked)
  - POST `/admin/keys` — add a new key (body: `{ key: '...' }`)
  - DELETE `/admin/keys` — delete a key (body: `{ key: '...' }`)
- Admin endpoints require `x-sadie-admin-key: <adminKey>` header where adminKey is configured via `ADMIN_API_KEY` env var or `admin.adminApiKey` in `proxy.config.json`.

Note: If `persistKeys` is enabled, keys managed via admin endpoints are written into `proxy.config.json` in plaintext. For production, prefer environment variables or a secure secret store and set `persistKeys` to false.

Example cURL — list keys:
```powershell
curl -X GET "http://localhost:5050/admin/keys" -H "x-sadie-admin-key: adminchangeme"
```

Example cURL — add key:
```powershell
curl -X POST "http://localhost:5050/admin/keys" -H "Content-Type: application/json" -H "x-sadie-admin-key: adminchangeme" -d "{ \"key\": \"newkey\" }"
```


POST /stream

Request schema (JSON):

```json
{
  "provider": "openai" | "ollama",
  "model": "gpt-4o" | "gpt-4.1" | "phi3-vision" | "...",
  "messages": [...],
  "prompt": "...",
  "images": [{"data":"<base64>", "mimeType":"image/png", "filename":"screenshot.png"}],
  "headers": { "Authorization": "Bearer ..." }
}
```

Response: SSE streamed chunks. Example events:
```
data: {"chunk": "first partial text"}

data: {"chunk": "next partial text"}

data: [DONE]
```

Example cURL (OpenAI streaming)

```powershell
curl -N -X POST "http://localhost:5050/stream" -H "Content-Type: application/json" -H "x-sadie-key: changeme" -d "{
  \"provider\": \"openai\",
  \"model\": \"gpt-4o-mini-vision\",
  \"prompt\": \"Describe the following image\",
  \"images\": [{\"data\": \"<BASE64>\", \"mimeType\": \"image/png\", \"filename\": \"img.png\"}],
  \"headers\": { \"Authorization\": \"Bearer $OPENAI_API_KEY\" }
}"
```

Example cURL (Ollama streaming)

```powershell
curl -N -X POST "http://localhost:5050/stream" -H "Content-Type: application/json" -H "x-sadie-key: changeme" -d "{
  \"provider\": \"ollama\",
  \"model\": \"phi3-vision\",
  \"prompt\": \"Describe this image\",
  \"images\": [{\"data\": \"<BASE64>\", \"mimeType\": \"image/png\", \"filename\": \"img.png\"}]
}"
```

SADIE (Electron main process) call example (fetch with streaming)

```ts
// In the main process or preload, make a fetch to the proxy and handle SSE chunks
const resp = await fetch('http://localhost:5050/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sadie-key': 'changeme' },
  body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini-vision', prompt: 'Describe image', images })
});

const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  while (buf.indexOf('\n\n') !== -1) {
    const idx = buf.indexOf('\n\n');
    const chunk = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    // chunk looks like: data: {...}
    if (chunk.startsWith('data: ')) {
      const data = chunk.slice(6);
      if (data === '[DONE]') {
        // Finished
      } else {
        try { const json = JSON.parse(data); handleChunk(json); } catch (e) { handleChunk({ text: data }); }
      }
    }
  }
}
```

n8n workflows - call SSE Proxy instead of direct model endpoints

- Replace `Call Vision Model` HTTP Request nodes with a POST to `http://<proxy-host>:5050/stream`. Provide the `provider` (`openai` or `ollama`), `model`, `prompt/messages`, and pass `headers` with `Authorization` if needed.
 - Replace `Call Vision Model` HTTP Request nodes with a POST to `http://<proxy-host>:5050/stream`. Provide the `provider` (`openai` or `ollama`), `model`, `prompt/messages`, and pass `headers` with `Authorization` if needed. If proxy authentication is enabled, add a header `x-sadie-key` with the configured key.
 - If `ENFORCE_SERVER_AUTH` is enabled, you can omit the `Authorization` header; the proxy will use `OPENAI_API_KEY` or `OLLAMA_API_KEY` from the server environment.
- Responses will be streamed back. If you need streaming inside the workflow, add a proxy or integration to capture SSE; n8n's HTTP Request node does not currently expose streaming chunks as workflow items.

Security & notes
- The proxy forwards headers but blocks host and connection headers to avoid protocol attacks.
- Keep your environment variables secure. Consider running this proxy next to your n8n or behind a firewall.
- Consider adding authentication to the proxy itself for production.
- Rate limiting: the proxy supports per-key rate limiting via `proxy.config.json.rateLimit` settings. Default is 30 requests per minute per key. Adjust as needed.
- Server-side credentials: set `ENFORCE_SERVER_AUTH=true` to force the proxy to use server-side API keys (`OPENAI_API_KEY` / `OLLAMA_API_KEY`) instead of client-supplied Authorization header.
- Configure `proxy.config.json` and environment variables to adapt endpoints, timeouts, allowed origins, and JSON size limits.

Deployment (Docker)
- `docker-compose.yml` - development compose, `docker-compose.prod.yml` - production-ready compose with nginx reverse proxy, Redis, mock upstream and sse-proxy
- `Dockerfile.prod` - multi-stage build for production
- For prod deploy (one-liner): `./deploy-sadie-proxy.sh` (bash) or `./deploy-sadie-proxy.ps1` (PowerShell). These run `docker compose -f docker-compose.prod.yml up --build -d`.

Rotating keys and admin UI
- CLI: `node cli/rotate-keys.js add <key>` / `remove` / `list` — or use the admin endpoints with `x-sadie-admin-key`.
- GUI: `GET /admin/ui` (requires admin header) shows a simple UI that lets you add/delete keys interactively.

Mapping to SADIE
- If SADIE runs locally (outside Docker), call `http://localhost:5050/stream` directly.
- If SADIE runs inside Docker, use docker networking or `host.docker.internal` to reach the proxy.
- For Linux here is a simple `docker run` mapping to host network: `docker run --rm --network host -e PROXY_API_KEYS=changeme sadie/sse-proxy`

Testing
- Run TypeScript build: `npm run build`. If the build complains about Node types, install dependencies via `npm i` and re-run.
- Unit tests: `npm test` (Jest). The default test harness uses an in-memory mock server and doesn't require Redis.
- Integration tests: `npm run test:integration` requires Docker/Redis running. Dev steps:
  1) Start Redis and mock upstream: `docker compose -f docker-compose.yml up -d redis mock-upstream`
  2) Run the test runner: `npm run test:integration`

Key concepts and behavior
- The proxy exposes `/stream` (POST) for SSE streaming and `/ws` for WebSocket streaming. Requests should include `provider` (openai|ollama), `model`, and one of `prompt`, `messages`, or `images`.
- Authentication: `x-sadie-key: <key>` for proxy API keys. Admin operations require `x-sadie-admin-key`.
- Server-side auth enforcement: set `ENFORCE_SERVER_AUTH=true` to force upstream API calls to use server environment keys (`OPENAI_API_KEY` / `OLLAMA_API_KEY`) rather than any client-provided Authorization header.
- Rate limiting: per-key or per-IP rate limiting governed by Redis when `REDIS_URL` is set, otherwise in-memory fallback.
- Persistent keys (optional): `persistKeys=true` will store keys in `proxy.config.json`. If `KEY_ENCRYPTION_SECRET` is set, keys will be stored encrypted.

Troubleshooting
- TypeScript errors complaining about Node globals (e.g., __dirname, Buffer, process) — ensure `npm i` has been run and `@types/node` is installed. The `tsconfig.json` sets `types: ['node']`.
- If integration tests fail with Redis errors, ensure `docker compose -f docker-compose.yml up -d redis` works and that nothing else is bound on 6379.
- If the admin UI 401s, check `PROXY_ADMIN_KEY`/`ADMIN_API_KEY` or `proxy.config.json` admin key settings.



"""
