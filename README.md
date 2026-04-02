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
| 🔍 Web Search | Multi-engine cascade (Tavily → Serper → DDG → Google → Brave) with content fetching & SSRF protection |
| 📁 File Manager | Safe read / write / list / move / delete with path validation |
| 🖥️ System Info | Disk, memory, process, and network inspection |
| 👁️ Vision / OCR | Describe images and extract text via `vision_describe` & `vision_query` (LLaVA) |
| 📎 RAG | Drag-and-drop document indexing with TF-IDF semantic search (`rag_index`, `rag_query`) |
| 🧠 Planning Agent | Multi-step task planning with persistent plans |
| 💾 Memory Manager | Persistent context and fact storage across sessions |
| 🌐 Browser Automation | Automated browser interactions + content extraction |
| 🔌 API Tool | External HTTPS requests to an approved host allowlist |
| ☁️ Code Cloud API | Route coding queries to OpenAI / Anthropic / OpenRouter |
| 🌩️ Embedded Web Services | ChatGPT, Claude, and Gemini accessible in-app via sandboxed panels |
| 🎨 Themes | Light / dark / system theme support with futuristic UI accents |
| 📄 Word Documents | Generate `.docx` files with headings, paragraphs, and formatting |
| 🖼️ Image Generation | Pollinations.ai → Stable Horde fallback cascade with progress indicator |
| 🏀 Sports / NBA | Live scores, standings, player stats via ESPN integration |
| 📦 Archive Ops | ZIP archive creation and extraction |
| ⌨️ Global Hotkey | `Ctrl+Shift+Space` to toggle SADIE from anywhere |
| 🔄 Auto-Update | Electron-updater with IPC progress events |
| 🔊 Voice Input | Offline speech recognition via Windows SAPI |

All tools are exposed as local HTTP webhook endpoints. SADIE calls whichever tool it needs, gets structured JSON back, and keeps everything on your machine.

---

## Architecture

`
┌──────────────────────────────────────┐
│         Electron 28 Shell            │
│  React UI ←→ IPC Bridge ←→ Main     │
│  (Themes, Animations, Glass UI)      │
├──────────────────────────────────────┤
│  Message Router  │  Tool Handlers    │
│  (intent detect, │  (TS, local exec) │
│   recursion cap) │                   │
├──────────────────┼───────────────────┤
│  Vision Tools    │  RAG Engine       │
│  (LLaVA)         │  (TF-IDF)         │
├──────────────────┼───────────────────┤
│  Code Cloud API  │  Embedded Web     │
│  (OpenAI/Claude) │  (ChatGPT/Gemini) │
└────────────────┬─┴───────────────────┘
                 │ HTTP
┌────────────────▼────────────────┐
│        Ollama (local)           │
│  llama3.2:3b │ dolphin-llama3   │
│  qwen2.5-coder │ llava │ mistral│
│  localhost:11434                │
└─────────────────────────────────┘
`

---

## Prerequisites

Before running SADIE, install the following:

| Dependency | Purpose | Install |
|-----------|---------|---------|
| Node.js 18+ | Electron app runtime | [nodejs.org](https://nodejs.org) |
| Ollama | Local LLM inference | [ollama.ai](https://ollama.ai) |
| Docker Desktop | Runs n8n (optional) | [docker.com](https://docker.com) |

**Minimum hardware:**
- Windows 10/11
- 16 GB RAM
- GPU with 4 GB+ VRAM recommended (RTX 2050 or better; CPU-only works, slower)

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
ollama pull qwen2.5-coder:3b
ollama pull llava:latest
ollama pull dolphin-llama3:8b    # optional — uncensored mode
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
├── widget/                   # Electron + React desktop app
│   ├── src/
│   │   ├── main/             # Main process (message-router, tools, IPC)
│   │   │   └── __tests__/    # 60+ main-process test suites
│   │   ├── renderer/         # React UI (components, styles, e2e)
│   │   │   └── __tests__/    # 20+ renderer test suites
│   │   ├── preload/          # Context bridge (sandbox-safe IPC)
│   │   └── shared/           # Types & utils shared across processes
│   ├── package.json
│   └── jest.config.ts
├── n8n-workflows/            # n8n workflow definitions
│   ├── core/                 # Orchestrator, safety validator
│   └── tools/                # image-generate (only active workflow)
├── config/                   # JSON configs (safety rules, allowlists)
├── scripts/                  # Setup, build, and utility scripts
├── prompts/                  # System prompts, intent detection
├── schemas/                  # JSON schemas for tool validation
├── docs/                     # Developer & API documentation
├── docker-compose.yml
└── README.md
`

---

## Testing

`ash
cd widget

# Unit tests (87 suites, 1339 tests)
npx jest --config jest.config.ts

# End-to-end tests (Playwright)
npm run e2e
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
- [x] Vision tools (describe & query images)
- [x] RAG document indexing and semantic search
- [x] Embedded web services (ChatGPT, Claude, Gemini)
- [x] Code cloud API routing (OpenAI / Anthropic / OpenRouter)
- [x] Light / dark / system theme support
- [x] Global hotkey (Ctrl+Shift+Space)
- [x] Auto-update via electron-updater
- [x] Futuristic UI accents (animations, glass morphism, neon glows)
- [x] Full Jest unit test coverage (87 suites / 1339 tests)
- [x] Playwright E2E test suite (12+ scenarios)
- [x] Security hardening (SSRF, IPC path traversal, webhook auth, PID injection)
- [x] Windows NSIS installer packaging
- [ ] i18n / localization
- [ ] Technical documentation site

---

## License

Private — academic project. All rights reserved by Aden Kingi.
