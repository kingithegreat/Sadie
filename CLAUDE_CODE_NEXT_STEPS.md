# Claude Code Next Steps

Date: 2026-06-05

## Current State

SADIE's core local stack is connected:

- Ollama is online at `http://127.0.0.1:11434`.
- n8n is online at `http://127.0.0.1:5678`.
- Docker shows `sadie-n8n` and `sadie-qdrant` running.
- Ollama is currently running as the Windows host process, not as the `sadie-ollama` Docker container.
- n8n containers should call host Ollama through `http://host.docker.internal:11434`.
- SADIE/Electron should call Ollama through `http://127.0.0.1:11434`.

Local Ollama models currently visible include:

- `qwen2.5:7b`
- `qwen2.5-coder:7b`
- `qwen2.5:3b`
- `mistral:latest`
- `moondream:latest`
- `phi4-mini:latest`
- `dolphin-phi:2.7b`
- `llama3.2:3b`
- `nomic-embed-text:latest`

## Recent Fix

The Ollama chat path was fixed so the main router no longer uses a stale module-level `OLLAMA_URL`. It now resolves the configured Ollama base URL at call time, normalizes `localhost` to `127.0.0.1`, and trims trailing slashes.

Touched files:

- `widget/src/main/message-router.ts`
- `widget/src/main/ipc-handlers.ts`
- `widget/src/main/__tests__/synthesis-guard.test.ts`

Verified:

- `npm run test:file -- synthesis-guard.test.ts`
- `npm run test:file -- stream-from-llm.test.ts`
- `npm run build`

## Important Worktree Note

These files were already modified before this handoff and should not be reverted unless the user explicitly asks:

- `AUDIT_SUMMARY.md`
- `COPILOT_HANDOFF.md`
- `ENVIRONMENT_STATUS.md`
- `PROGRESS_REPORT.md`

## Model Switching Status

The app already has model switching support:

- Chat/status area uses `ModelSelector`.
- Local Ollama models are fetched through `sadie:list-ollama-models`.
- Cloud/API models can be configured in Settings with provider, API URL/key, fetched model list, model chips, and a `useCustomLLM` toggle.
- Supported cloud/provider paths include OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google, Hugging Face, Cerebras, SambaNova, Together, and custom OpenAI-compatible endpoints.

## Recommended Next Work

1. Verify the actual chat UI can switch from `qwen2.5:7b` to another installed local model and that the saved setting updates.
2. Test one cloud provider flow end to end from Settings: enter API key, fetch models, select one, enable cloud usage, send a chat message.
3. Add a small UI/status clarification when Ollama is running on the host process versus Docker, because the repo has both an `ollama` compose service and host-Ollama documentation.
4. Decide whether SADIE should keep using host Ollama as the default, or whether `docker compose up -d ollama` should be part of the preferred local stack.
5. If Docker Ollama becomes preferred, pull/start `ollama/ollama:latest`, migrate/pull required models into the Docker volume, and verify n8n uses `host.docker.internal` or the Docker service name consistently.

## Useful Checks

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
Invoke-WebRequest http://127.0.0.1:5678/healthz -UseBasicParsing
docker ps
Get-Process ollama -ErrorAction SilentlyContinue
```
