# SADIE Setup Guide

This guide walks you through installing and running SADIE on a fresh machine, from prerequisites to your first conversation.

---

## Table of Contents

1. [One-Click Install (Recommended)](#one-click-install-recommended)
2. [Prerequisites (Developer Setup)](#prerequisites-developer-setup)
3. [Clone the Repository](#step-1--clone-the-repository)
4. [Automated Setup Script](#step-2--run-the-automated-setup-script)
5. [Start Ollama](#step-3--start-ollama)
6. [Start n8n (Optional)](#step-4--start-n8n-optional)
7. [Launch SADIE](#step-5--launch-sadie)
8. [First-Run Onboarding](#step-6--first-run-onboarding)
9. [Verify Tools](#step-7--verify-tools-are-working)
10. [Troubleshooting](#troubleshooting)
11. [Updating SADIE](#updating-sadie)
12. [File and Directory Reference](#file-and-directory-reference)

---

## One-Click Install (Recommended)

The simplest way to get SADIE running:

1. **Download** `SADIE-Setup.exe` from the latest release, or build it yourself:
   ```bash
   cd widget
   npm run dist    # Outputs to widget/dist-electron/
   ```
2. **Double-click** the installer. It installs to your user profile (no admin rights needed) and launches SADIE automatically.
3. **Follow the setup wizard.** On first launch, SADIE will:
   - Detect your GPU and set a hardware profile.
   - Download and install Ollama if it's not already on your machine.
   - Pull the essential AI models (`qwen2.5:7b` for chat, `nomic-embed-text` for embeddings) with a progress bar.
   - Drop you into the chat interface, ready to go.

That's it — no terminal, no manual model pulls, no Docker. Everything below is for developers who want to run from source.

---

## Prerequisites (Developer Setup)

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org) | 18 LTS or higher | Required to build and run the Electron application |
| [npm](https://nodejs.org) | 9 or higher | Ships with Node.js |
| [Ollama](https://ollama.com/download) | Latest | Runs the local AI models. Current runtime defaults are `qwen2.5:7b` for chat and `moondream` for vision. |
| [Docker Desktop](https://docs.docker.com/get-docker/) | Latest | Required for n8n workflow orchestration (optional) |
| [Git](https://git-scm.com) | Latest | Version control |

### Hardware Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10 | Windows 11 |
| **RAM** | 8 GB | 16 GB |
| **GPU** | Integrated (CPU-only mode) | NVIDIA RTX 2050+ with 4 GB VRAM |
| **Storage** | 15 GB free | 25 GB free (models + dependencies) |
| **Network** | Required for initial setup | Optional after models are downloaded |

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie
```

---

## Step 2 — Run the Automated Setup Script

```powershell
.\scripts\setup\Setup-SADIE.ps1
```

This script will:

1. Verify that Node.js, npm, Docker, and Ollama are installed and meet minimum versions.
2. Create any missing configuration files (`config/api-allowlist.json`, `config/default-config.json`).
3. Run `npm install` inside `widget/` if `node_modules` is absent.
4. Pull the baseline Ollama models (`qwen2.5:7b`, `qwen2.5-coder:7b`, `moondream`, `nomic-embed-text`) for first-run compatibility.
5. Print a checklist summary with instructions for anything requiring manual attention.

> **Note:** Re-running the script is safe. It will not overwrite existing config files or re-pull models that are already installed.

To skip the model pull step (for example, on a CI machine):

```powershell
.\scripts\setup\Setup-SADIE.ps1 -SkipModelPull
```

---

## Step 3 — Start Ollama

```bash
ollama serve
```

Ollama must be running before you start SADIE. If it is already running as a background service (the default after installation), you can skip this step.

Verify it is reachable:

```bash
ollama list
# Or check the API endpoint directly:
curl http://127.0.0.1:11434/api/tags
```

### Recommended Models

```bash
ollama pull qwen2.5:7b           # Primary chat model (4.7 GB)
ollama pull qwen2.5-coder:7b    # Code generation model (optional, 4.4 GB)
ollama pull moondream            # Default vision model (1.7 GB)
ollama pull nomic-embed-text     # Embeddings for RAG and memory enrichment
ollama pull gemma4:e4b           # 16 GB+ GPU recommended (9.6 GB, optional)
```

---

## Step 4 — Start n8n (Optional)

n8n provides optional workflow orchestration for scheduled tasks and external integrations. SADIE's core functionality (all 20+ tool handlers) works without n8n.

```bash
docker compose up -d
```

This starts n8n at `http://localhost:5678` using the credentials in `docker-compose.yml`.

> **First time only:** Open `http://localhost:5678`, complete the n8n onboarding, then import the workflows from `n8n-workflows/core/` via **n8n > Workflows > Import from File**.

---

## Step 5 — Launch SADIE

### Development Mode (with hot-reload)

```bash
cd widget
npm install     # First time only
npm run dev
```

The Vite dev server provides hot module replacement for renderer changes. Main process changes trigger an automatic rebuild. `npm run dev` clears `ELECTRON_RUN_AS_NODE` before starting Electron so the app launches correctly from integrated terminals.

### Production Build

```bash
cd widget
npm run build
```

### Create an Installable Package

```bash
cd widget
npm run dist    # Uses electron-builder; output in widget/dist-electron/
```

---

## Step 6 — First-Run Onboarding

When SADIE opens for the first time, a setup wizard guides you through configuration:

1. **Welcome screen** — Choose between **Local (Ollama)** for fully offline AI or **Cloud API** for hosted inference (GPT-4o, Claude, Gemini, and free-tier providers).
2. **Local path** — The wizard automatically:
   - Detects your GPU and VRAM to set a hardware profile.
   - Checks if Ollama is installed. If not, offers a one-click "Install Ollama automatically" button that downloads and installs it silently.
   - Starts Ollama if it's installed but not running.
   - Pulls essential models (`qwen2.5:7b`, `nomic-embed-text`) with real-time progress bars.
   - Shows "Ollama is ready!" when everything is set up.
3. **Cloud path** — Pick a provider, paste an API key, and test the connection. Free-tier providers are marked.
4. **Done** — Click **Get Started** to enter the chat interface. Telemetry consent is handled automatically (local-only, no remote data).
5. **Global hotkey** — Defaults to `Ctrl+Shift+Space` (Windows). Changeable in **Settings > Widget Hotkey**.
6. **n8n URL** — Defaults to `http://localhost:5678`. Update in **Settings > n8n URL** if you changed the docker-compose port.

---

## Step 7 — Verify Tools Are Working

Open the widget (`Ctrl+Shift+Space`) and try a few commands:

```
List the files in my Downloads folder
What time is it?
Search for "readme" files on my Desktop
What are the current NBA standings?
```

To see all available tools, open **Settings > View Tools** or ask:

```
What tools do you have?
```

---

## Troubleshooting

### Ollama Not Found / Models Not Loading

- Confirm `ollama serve` is running.
- Run `ollama list` to see installed models.
- Manually pull a model: `ollama pull qwen2.5:7b`
- SADIE includes an Ollama heartbeat that auto-restarts Ollama if it goes down. Check the status indicator in the UI.
- Verify the API is reachable: `curl http://127.0.0.1:11434/api/tags`

### Widget Does Not Start / Blank Screen

- Check the DevTools console (`Ctrl+Shift+I` in the widget window).
- Confirm `node_modules` exists: `ls widget/node_modules`. If not, run `npm install` inside `widget/`.
- Check `widget/logs/` for error logs written during startup.
- Try a clean rebuild: `npm run build` then `npm start`.
- If Electron behaves like a plain Node.js process in an integrated terminal, use `npm run dev` or clear `ELECTRON_RUN_AS_NODE` before launching manually.

### n8n Unavailable

- Confirm Docker is running: `docker ps`
- Check n8n logs: `docker compose logs n8n`
- Ensure the n8n URL in Settings matches the port in `docker-compose.yml`.

### Tool Execution Denied

- Check `config/safety-rules.json` — it defines path and operation whitelists.
- Check `config/tool-allowlist.json` — confirms which tools are enabled.
- Some tools (file deletion, process kill) require explicit user confirmation in the UI.

### Custom API Hosts Blocked

Add the hostname to `config/api-allowlist.json`:

```json
["api.myservice.com", "internal.company.net"]
```

Restart the widget after editing (the list is read at startup).

### Speech Recognition Not Working

- Windows SAPI is used for offline speech recognition. Ensure it is available on your system.
- Check that no other application has exclusive access to the microphone.

---

## Updating SADIE

```bash
git pull origin main
cd widget
npm install        # In case new dependencies were added
npm run dev
```

Or re-run the setup script:

```powershell
.\scripts\setup\Setup-SADIE.ps1 -SkipModelPull
```

---

## File and Directory Reference

| Path | Purpose |
|---|---|
| `widget/` | Electron + React application source code |
| `widget/src/main/` | Main process (message-router, tools, IPC handlers) |
| `widget/src/renderer/` | React UI (components, styles, e2e tests) |
| `widget/src/preload/` | Context bridge (sandbox-safe IPC) |
| `widget/src/shared/` | Shared types, constants, and utilities |
| `config/` | Runtime configuration files |
| `config/default-config.json` | Core settings (models, URLs, hotkey, permissions) |
| `config/api-allowlist.json` | Approved API hostnames for the `api_request` tool |
| `config/safety-rules.json` | Path and operation whitelist for file and system tools |
| `config/tool-allowlist.json` | Enabled/disabled state for each tool |
| `n8n-workflows/core/` | n8n workflow definitions (orchestrator, safety validator) |
| `n8n-workflows/tools/` | n8n image generation workflow |
| `memory/json-store/` | Persistent key-value memory store |
| `memory/rag-index.json` | RAG document index |
| `logs/` | Runtime log files |
| `scripts/` | Setup, build, and utility scripts |
| `scripts/setup/Setup-SADIE.ps1` | Automated setup and preflight script |
| `prompts/` | System prompts and intent detection templates |
| `schemas/` | JSON schemas for tool call validation |
| `docs/` | Developer and API documentation |
