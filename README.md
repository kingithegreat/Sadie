# SADIE — Structured AI Desktop Intelligence Engine

> A secure, offline-first desktop AI assistant. Runs primarily on your machine with optional cloud LLM support. Data stays local unless cloud LLM is enabled.

![Platform](https://img.shields.io/badge/platform-Windows%2011-blue)
![Stack](https://img.shields.io/badge/stack-Electron%20%2B%20React%20%2B%20TypeScript-informational)
![AI](https://img.shields.io/badge/AI-Ollama%20%28local%29-green)
![License](https://img.shields.io/badge/license-Private-lightgrey)

---

## What is SADIE?

SADIE is a desktop AI assistant that can search the web, read and write files, inspect your system, understand images, automate browser tasks, and plan multi-step workflows — all without sending your data anywhere.

It combines:
- **Electron + React** for the desktop UI
- **n8n** as a local workflow orchestration engine (tool registry)
- **Ollama** for on-device LLM inference (no API keys, no internet required)

---

## Features

| Tool | What it does |
|------|-------------|
| 🔍 Web Search | DuckDuckGo search via PowerShell |
| 📁 File Manager | Safe read / write / list / move with path validation |
| 🖥️ System Info | Disk, memory, process, and network inspection |
| 👁️ Vision / OCR | Screenshot understanding via Tesseract + LLaVA |
| 🧠 Planning Agent | Multi-step task planning via llama3.2:3b |
| 💾 Memory Manager | Persistent context and fact storage across sessions |
| 🌐 Browser Automation | Automated browser interactions |
| 🔌 API Tool | External HTTP API calls |
| 🌩️ Remote LLM APIs | Optional ChatGPT / Claude model inference (cloud) |
| 📦 Archive Ops | Archive creation and extraction |

All tools are exposed as local HTTP webhook endpoints. SADIE calls whichever tool it needs, gets structured JSON back, and keeps everything on your machine.

---

## Architecture

`
┌─────────────────────────────────┐
│        Electron Shell           │
│   React UI  ←→  IPC Bridge      │
└────────────────┬────────────────┘
                 │ HTTP
┌────────────────▼────────────────┐
│         n8n Tool Engine         │
│  (localhost:5678 via Docker)    │
│                                 │
│  /sadie/tools/web-search        │
│  /sadie/tools/file-manager      │
│  /sadie/tools/system-info       │
│  /sadie/tools/vision            │
│  /sadie/tools/planning-agent    │
│  /sadie/tools/memory-manager    │
│  ... and more                   │
└────────────────┬────────────────┘
                 │ HTTP
┌────────────────▼────────────────┐
│        Ollama (local)           │
│  llama3.2:3b  |  llava:latest   │
│  localhost:11434                │
└─────────────────────────────────┘
`

Each n8n workflow follows the same pattern:
1. Receive webhook POST
2. Parse + validate inputs
3. Execute (PowerShell, Ollama call, HTTP request, etc.)
4. Return structured JSON response

---

## Prerequisites

Before running SADIE, install the following:

| Dependency | Purpose | Install |
|-----------|---------|---------|
| Node.js 18+ | Electron app runtime | [nodejs.org](https://nodejs.org) |
| Docker Desktop | Runs n8n locally | [docker.com](https://docker.com) |
| Ollama | Local LLM inference | [ollama.ai](https://ollama.ai) |
| Tesseract OCR | Vision/OCR tool | [github.com/UB-Mannheim/tesseract](https://github.com/UB-Mannheim/tesseract/wiki) |

**Minimum hardware:**
- Windows 11
- 16GB RAM
- GPU with 8GB+ VRAM recommended (CPU-only works, slower)

---

## Setup

### 1. Clone the repo

`ash
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie
`

### 2. Start n8n via Docker

`ash
docker compose up -d
`

n8n will be available at http://localhost:5678. Import each workflow from the /tools folder via the n8n UI (Settings → Import Workflow).

### 3. Pull AI models

`ash
ollama pull llama3.2:3b
ollama pull llava:latest
`

### 4. Install and run the desktop app

`ash
cd widget
npm install
npm run dev
`

---

## Project Structure

`
Sadie/
├── tools/                    # n8n workflow JSON files
│   ├── web-search.json
│   ├── file-manager.json
│   ├── system-info.json
│   ├── vision-tool.json
│   ├── planning-agent.json
│   ├── memory-manager.json
│   ├── browser-automation.json
│   ├── api-tool.json
│   └── archive-ops.json
├── widget/                   # Electron + React desktop app
│   ├── src/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── scripts/                  # PowerShell helper scripts
│   ├── FileOps.ps1
│   └── SystemInfo.ps1
├── docker-compose.yml
└── README.md
`

---

## Testing

`ash
cd widget

# Unit tests
npm run test

# End-to-end tests
npm run test:e2e
`

Test coverage reports are generated in /coverage.

---

## Academic Context

SADIE is developed as a capstone project at **Toi Ohomai Institute of Technology** (2026).

- **Student:** Aden Kingi
- **Supervisor:** Francisco Roldao
- **Stack:** Electron, React, TypeScript, n8n, Ollama, PowerShell

---

## Roadmap

- [x] Electron + React desktop shell
- [x] n8n tool engine with all core tool endpoints
- [x] Ollama local LLM integration (llama3.2:3b + LLaVA)
- [x] PowerShell-backed system tools
- [ ] Full Jest unit test coverage
- [ ] Playwright E2E test suite
- [ ] Security hardening + path allowlist
- [ ] Windows installer packaging
- [ ] Technical documentation site

---

## License

Private — academic project. All rights reserved by Aden Kingi.
