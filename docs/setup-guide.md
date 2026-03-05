# SADIE Setup Guide

This guide walks you through installing and running SADIE on a fresh machine.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org) | ≥ 18 LTS | Required to build and run the widget |
| [npm](https://nodejs.org) | ≥ 9 | Ships with Node.js |
| [Ollama](https://ollama.com/download) | Latest | Runs the local AI models |
| [Docker Desktop](https://docs.docker.com/get-docker/) | Latest | Required for n8n workflow orchestration |
| Windows 10/11 or macOS 12+ | — | Linux supported (no systray on Wayland) |
| RAM | ≥ 8 GB | 16 GB recommended for `qwen2.5:7b` |

---

## Step 1 — Clone the repository

```powershell
git clone https://github.com/your-org/sadie.git
cd sadie
```

---

## Step 2 — Run the automated setup script

```powershell
.\scripts\setup\Setup-SADIE.ps1
```

This script will:

1. Verify Node.js, npm, Docker and Ollama are installed and meet the minimum versions.
2. Create any missing config files (`config/api-allowlist.json`, `config/default-config.json`).
3. Run `npm install` inside `widget/` if `node_modules` is absent.
4. Pull the required Ollama models  (`qwen2.5:7b`, `qwen2.5-coder:3b`, `llava:latest`).
5. Print a checklist summary with instructions for anything that needs manual attention.

> **Tip:** Re-running the script is safe — it won't overwrite existing config files or re-pull models that are already installed.

If you want to skip the model pull step (e.g. on a CI machine):

```powershell
.\scripts\setup\Setup-SADIE.ps1 -SkipModelPull
```

---

## Step 3 — Start Ollama (if not already running)

```powershell
ollama serve
```

Ollama must be running before you start SADIE. If it is already running as a background service (the default after installation) you can skip this step.

You can verify it is reachable at `http://localhost:11434/api/tags`.

---

## Step 4 — Start n8n (for workflow automation)

```powershell
docker compose up -d
```

This starts n8n at `http://localhost:5678` using the credentials in `docker-compose.yml`.

> **First-time only:** Open `http://localhost:5678`, complete the n8n onboarding, then import the workflows located in `n8n-workflows/core/`.  
> Go to **n8n → Workflows → Import from File** and import each `.json` file.

---

## Step 5 — Launch the widget

### Development mode (with hot-reload)

```powershell
cd widget
npm run dev
```

### Production build

```powershell
cd widget
npm run build      # builds the Electron app into widget/dist-electron/
npm run preview    # optionally preview the renderer in a browser
```

To create an installable desktop package:

```powershell
cd widget
npm run dist       # uses electron-builder; output in widget/release/
```

---

## Step 6 — First-run onboarding

When SADIE opens for the first time:

1. **Hotkey** — The global hotkey defaults to `Ctrl+Shift+Space` (Windows/Linux) or `Cmd+Shift+Space` (macOS). You can change it in **Settings → Widget Hotkey**.
2. **Model selection** — Settings defaults to `qwen2.5:7b` for chat. If you pulled a different model, update **Settings → Chat Model**.
3. **Telemetry consent** — A consent prompt will appear on first launch. Telemetry is opt-in only and stores data locally; nothing is sent to a remote server.
4. **n8n URL** — Defaults to `http://localhost:5678`. If you changed the docker-compose port, update it in **Settings → n8n URL**.

---

## Step 7 — Verify tools are working

Open the widget (`Ctrl+Shift+Space`) and try a few commands:

```
List the files in my Downloads folder
What time is it?
Search for "readme" files on my Desktop
```

To see all available tools, click **⚙ Settings → View Tools** or ask:

```
What tools do you have?
```

---

## Troubleshooting

### "Ollama not found" / models not loading

- Make sure `ollama serve` is running.
- Run `ollama list` to see installed models.
- Manually pull a model: `ollama pull qwen2.5:7b`

### Widget won't start / blank screen

- Check the DevTools console (`Ctrl+Shift+I` in the widget window).
- Confirm `node_modules` exists: `ls widget/node_modules`.  If not, run `npm install` inside `widget/`.
- Check `widget/logs/` for any error logs written during startup.

### n8n unavailable

- Confirm Docker is running: `docker ps`
- Check n8n logs: `docker compose logs n8n`
- Make sure the n8n URL in Settings matches the port in `docker-compose.yml`.

### Tool execution denied

- Check `config/safety-rules.json` — it defines path and operation whitelists.
- Check `config/tool-allowlist.json` — confirms which tools are enabled.
- Some tools (file deletion, process kill) require explicit user confirmation in the UI.

### Custom API hosts blocked

- Add the hostname to `config/api-allowlist.json`:
  ```json
  ["api.myservice.com", "internal.company.net"]
  ```
- Restart the widget (the list is read at startup).

---

## Updating SADIE

```powershell
git pull origin main
cd widget
npm install        # in case new dependencies were added
.\scripts\setup\Setup-SADIE.ps1 -SkipModelPull
```

---

## File / directory reference

| Path | Purpose |
|---|---|
| `widget/` | Electron + React application |
| `config/` | Runtime configuration files |
| `config/default-config.json` | Core settings (models, URLs, hotkey) |
| `config/api-allowlist.json` | Additional API hostnames the api_request tool may reach |
| `config/safety-rules.json` | Path and operation whitelist for file/system tools |
| `config/tool-allowlist.json` | Enabled/disabled state for each tool |
| `n8n-workflows/core/` | n8n workflow definitions to import |
| `memory/json-store/` | Persistent key-value memory store |
| `logs/` | Runtime log files |
| `scripts/setup/Setup-SADIE.ps1` | Preflight / first-run automation script |
| `docs/` | Additional documentation |
