# SADIE — Environment Status

Current development environment configuration and readiness status.

---

## System Information

| Component | Version / Value |
|---|---|
| **Node.js** | v24.13.0 |
| **npm** | 10.x (ships with Node.js) |
| **TypeScript** | 5.9.3 |
| **Electron** | 28 |
| **electron-vite** | Latest |
| **OS** | Windows 10/11 |
| **Architecture** | x64 |

---

## AI Models

### Ollama (Local)

| Model | Size | Status | Purpose |
|---|---|---|---|
| `llama3.2:3b` | ~2 GB | Required | Primary chat |
| `qwen2.5-coder:3b` | ~2 GB | Required | Code generation |
| `llava:latest` | ~4 GB | Required | Computer vision |
| `dolphin-llama3:8b` | ~5 GB | Optional | Uncensored mode |

**Ollama endpoint**: `http://localhost:11434`

Verify models:

```bash
ollama list
```

### Cloud LLM Providers (Optional)

| Provider | Models | API Key Location |
|---|---|---|
| **OpenAI** | GPT-4o, GPT-4o Mini | Settings → LLM Provider |
| **Anthropic** | Claude Opus 4, Claude Sonnet 4, Claude 3.5 Haiku | Settings → LLM Provider |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash | Settings → LLM Provider |
| **xAI** | Grok-3 | Settings → LLM Provider |
| **DeepSeek** | DeepSeek V3 | Settings → LLM Provider |

Cloud providers are optional. SADIE runs fully offline with Ollama alone.

---

## Services

| Service | Default Address | Required |
|---|---|---|
| **Ollama** | `http://localhost:11434` | Yes |
| **n8n** | `http://localhost:5678` | No (optional workflows) |
| **Docker Desktop** | — | No (required for n8n only) |

### Health Checks

```bash
# Ollama
curl http://localhost:11434/api/tags

# n8n (if Docker is running)
curl http://localhost:5678/healthz
```

---

## Test Suite Status

| Metric | Value |
|---|---|
| **Unit Test Suites** | 110 |
| **Individual Tests** | 1,533 |
| **Failures** | 0 |
| **Framework** | Jest + ts-jest |
| **E2E Framework** | Playwright |

### Run Tests

```bash
cd widget
npx jest --config jest.config.ts --no-coverage
```

---

## Build Status

| Command | Purpose | Status |
|---|---|---|
| `npm run dev` | Development with HMR | Working |
| `npm run build` | Production build | Working |
| `npm run dist` | NSIS installer | Working |
| `npx tsc --noEmit` | Type check | Clean |

---

## Key Directories

| Directory | Purpose |
|---|---|
| `widget/` | Main Electron application |
| `widget/src/main/` | Main process source |
| `widget/src/renderer/` | React UI source |
| `widget/src/preload/` | Context bridge |
| `widget/src/shared/` | Shared types and constants |
| `config/` | Runtime configuration JSON files |
| `prompts/` | System prompts and templates |
| `schemas/` | JSON validation schemas |
| `scripts/` | Build and utility scripts |
| `docs/` | Technical documentation |
| `memory/` | Local memory and RAG index |
| `n8n-workflows/` | n8n workflow definitions |

---

## Disk Space Requirements

| Component | Size |
|---|---|
| `node_modules` | ~400 MB |
| Ollama models (3 required) | ~8 GB |
| Ollama models (all 4) | ~13 GB |
| Build output | ~100 MB |
| Installer | ~80 MB |
| **Total (minimum)** | ~9 GB |
| **Total (recommended)** | ~15 GB |

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode |
| `SADIE_E2E` | unset | Set to `"true"` for test mode |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |

---

## Preflight Checklist

Before starting development:

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm 9+ installed (`npm --version`)
- [ ] Ollama installed and running (`ollama list`)
- [ ] Required models pulled (`llama3.2:3b`, `qwen2.5-coder:3b`, `llava:latest`)
- [ ] Dependencies installed (`cd widget && npm install`)
- [ ] Tests pass (`npx jest --config jest.config.ts --no-coverage`)
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] (Optional) Docker Desktop running for n8n workflows
