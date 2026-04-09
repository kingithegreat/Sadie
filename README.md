# SADIE — Structured AI Desktop Intelligence Engine

> A secure, offline-first desktop AI assistant built with Electron, React, and TypeScript. Runs entirely on your machine with optional cloud LLM support. Your data stays local unless you explicitly enable a cloud provider.

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![Electron](https://img.shields.io/badge/Electron-28-9feaf9)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178c6)
![React](https://img.shields.io/badge/React-18-61dafb)
![AI](https://img.shields.io/badge/AI-Ollama%20(local)-green)
![Tests](https://img.shields.io/badge/tests-115%20suites%20%7C%201716%20passing-brightgreen)
![License](https://img.shields.io/badge/license-Private-lightgrey)

---

## What is SADIE?

SADIE is a **privacy-first desktop AI assistant** that can search the web, read and write files, inspect your system, understand images, generate images, automate browser tasks, index documents for semantic search, track NBA scores, chain multi-step tool workflows autonomously, and greet you each morning with a personalized briefing — all without sending your data to a third party.

It combines:

- **Electron 28 + React 18** for a modern, themeable desktop UI with futuristic glass-morphism accents
- **Ollama** for fully offline LLM inference — no API keys or internet connection required
- **60+ TypeScript tool handlers** executed locally with structured JSON tool-calling
- **Agentic tool loop** — the LLM autonomously chains tools for multi-step requests ("search for X, save it, then email me")
- **Optional cloud LLM routing** to OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google AI Studio, or any OpenAI-compatible endpoint
- **n8n** as an optional workflow orchestration engine for scheduled tasks and external integrations

---

## Feature Overview

### Core AI and Tools

| Capability | Description |
|---|---|
| **Web Search** | Multi-engine cascade (Tavily, Serper, DuckDuckGo, Google, Brave) with automatic content fetching and SSRF protection |
| **File Manager** | Safe read, write, list, move, delete, and search with path validation and directory whitelisting |
| **System Info** | Disk usage, memory, running processes, and network adapter inspection |
| **Vision / OCR** | Describe images and extract text via `vision_describe` and `vision_query` using Ollama moondream |
| **RAG Engine** | Drag-and-drop document indexing (PDF, Word, code, CSV, Markdown) with hybrid TF-IDF + semantic embedding search via nomic-embed-text |
| **Agentic Tool Loops** | Multi-step requests are automatically detected and the LLM chains tools autonomously with streaming progress indicators |
| **Morning Briefing** | Proactive daily summary of weather, calendar events, and reminders on first interaction |
| **Planning Agent** | Multi-step task planning with persistent plans |
| **Memory Manager** | Persistent context and fact storage across sessions |
| **Browser Automation** | Automated browser interactions and content extraction |
| **API Tool** | External HTTPS requests restricted to an approved host allowlist |
| **Code Cloud API** | Route coding queries to OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google AI Studio, or a custom endpoint |
| **Image Generation** | Text-to-image via Pollinations.ai with automatic Stable Horde fallback and progress indicator |
| **Sports / NBA** | Live scores, full-season results, standings, and player stats via ESPN integration |
| **Word Documents** | Generate `.docx` files with headings, paragraphs, and formatting |
| **Archive Ops** | ZIP archive creation, extraction, and inspection with size and path-traversal guards |
| **Scheduler** | Persistent reminders and scheduled jobs that survive app restarts |

### User Experience

| Feature | Description |
|---|---|
| **Themes** | Light, dark, and system-auto theme with futuristic UI accents, glass morphism, neon glows, and 15+ CSS keyframe animations |
| **Global Hotkey** | `Ctrl+Shift+Space` toggles SADIE from any application |
| **Auto-Update** | Background updates via electron-updater with IPC progress events |
| **Voice Input** | Offline speech recognition via Windows SAPI |
| **Embedded Web Services** | Access ChatGPT, Claude, and Gemini directly inside SADIE via sandboxed browser panels |
| **Conversation Management** | Sidebar with timestamps, message counts, pinning, archiving, tags, reactions, and full-text search |
| **Markdown Export** | Export any conversation to a clean `.md` file |
| **Keyboard Shortcuts** | Configurable shortcuts for common actions |
| **Analytics Dashboard** | Visual dashboard for conversation and tool usage analytics |
| **Message Density Toggle** | Compact or comfortable message spacing |
| **Focus Mode** | Distraction-free full-screen chat interface |

### Security

| Measure | Description |
|---|---|
| **SSRF Protection** | URL validation blocks loopback, private IPs, and DNS rebinding |
| **IPC Hardening** | Context isolation, preload bridge, path-traversal prevention |
| **Webhook Auth** | 256-bit shared secret (`X-SADIE-Auth`) for all n8n communication |
| **Tool Recursion Cap** | `MAX_TOOL_ROUNDS = 10` prevents infinite tool-call loops |
| **PID Injection Guard** | Positive integer validation before `Stop-Process` |
| **Toast XML Sanitisation** | Entity-encoding prevents injection in Windows notifications |
| **Git Message Sanitisation** | Character whitelist prevents shell metacharacter injection |
| **Environment Gating** | Test code, debug logs, and dev features are compile-time gated |

All tools execute locally as TypeScript handlers. SADIE calls whichever tool the LLM selects, receives structured JSON, and keeps everything on your machine.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│              Electron 28 Shell                    │
│   React 18 UI  <-->  IPC Bridge  <-->  Main Proc  │
│   (Themes, Glass UI, Animations)                  │
├──────────────────────────────────────────────────┤
│   Message Router     |   60+ Tool Handlers        │
│   (intent detection, |   (TypeScript, local exec)  │
│    agentic loop,     |                            │
│    tool recursion    |   Web - File - System      │
│    cap, context      |   Vision - RAG - Plan      │
│    budget)           |   Memory - Browser         │
│                      |   API - Sports - Docs      │
│   Morning Briefing   |   Archive - Image Gen      │
│   (weather+cal+rem)  |   Voice - Scheduler        │
├──────────────────────┼────────────────────────────┤
│   Code Cloud API     |   Embedded Web Services    │
│   (OpenAI/Anthropic  |   (ChatGPT / Claude /      │
│    /OpenRouter/Groq  |    Gemini in sandboxed      │
│    /DeepSeek/Google)  |    BrowserWindows)          │
└───────────┬──────────┴────────────────────────────┘
            | HTTP (localhost)
┌───────────v────────────────────────────────────────┐
│                 Ollama (local)                      │
│   phi4-mini  -  qwen2.5-coder:3b  -  moondream    │
│   dolphin-phi:2.7b  -  nomic-embed-text            │
│   localhost:11434                                   │
└────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Dependency | Version | Purpose | Install |
|---|---|---|---|
| **Node.js** | 18 LTS or higher | Electron app runtime | [nodejs.org](https://nodejs.org) |
| **Ollama** | Latest | Local LLM inference | [ollama.com](https://ollama.com/download) |
| **Docker Desktop** | Latest | Runs n8n (optional) | [docker.com](https://docker.com) |
| **Git** | Latest | Version control | [git-scm.com](https://git-scm.com) |

### Minimum Hardware

- **OS:** Windows 10 or Windows 11
- **RAM:** 16 GB recommended (8 GB minimum)
- **GPU:** 4 GB+ VRAM recommended (NVIDIA RTX 2050 or better; CPU-only mode works but is slower)
- **Storage:** 15 GB free space (for AI models and dependencies)

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie
```

### 2. Start n8n via Docker (optional)

```bash
docker compose up -d
```

n8n will be available at `http://localhost:5678`. Import workflows from `n8n-workflows/core/` via the n8n UI (**Settings > Import Workflow**).

### 3. Pull AI Models

```bash
ollama pull phi4-mini             # Primary chat model (best reasoning in 3-4B range)
ollama pull moondream             # Vision model (lightweight, 1.7 GB)
ollama pull nomic-embed-text      # Semantic embeddings for RAG + memory
ollama pull dolphin-phi:2.7b      # Uncensored mode (optional, 1.6 GB)
ollama pull qwen2.5-coder:3b     # Code generation model (optional)
```

### 4. Install and Run

```bash
cd widget
npm install
npm run dev
```

SADIE will launch with hot-reload enabled. Press `Ctrl+Shift+Space` to toggle the window from any application.

---

## Project Structure

```
Sadie/
├── widget/                       # Electron + React desktop application
│   ├── src/
│   │   ├── main/                 # Main process (message-router, tools, IPC)
│   │   │   ├── tools/            # 60+ TypeScript tool handler modules
│   │   │   └── __tests__/        # 80+ main-process unit test suites
│   │   ├── renderer/             # React UI (components, styles)
│   │   │   ├── components/       # ChatInterface, Settings, Sidebar, etc.
│   │   │   ├── e2e/              # Playwright E2E test specs
│   │   │   └── __tests__/        # 25+ renderer unit test suites
│   │   ├── preload/              # Context bridge (sandbox-safe IPC)
│   │   └── shared/               # Types, constants, and utilities
│   ├── electron.vite.config.ts   # electron-vite build configuration
│   ├── electron-builder.yml      # Installer packaging configuration
│   ├── jest.config.ts            # Jest test configuration
│   ├── playwright.config.ts      # Playwright E2E configuration
│   └── package.json
├── n8n-workflows/                # n8n workflow definitions
│   ├── core/                     # Chat orchestrator, safety validator
│   └── tools/                    # Image generation workflow
├── config/                       # JSON configuration files
│   ├── safety-rules.json         # Path and operation whitelists
│   ├── api-allowlist.json        # Approved API hostnames
│   └── default-config.json       # Default application settings
├── scripts/                      # Setup, build, and utility scripts
├── prompts/                      # System prompts and intent detection
├── schemas/                      # JSON schemas for tool validation
├── docs/                         # Developer and API documentation
├── memory/                       # Local memory and RAG index storage
├── docker-compose.yml            # n8n container configuration
└── README.md
```

---

## Testing

SADIE has a comprehensive test suite with **115 test suites** and **1,716 unit tests**, plus Playwright E2E coverage.

```bash
cd widget

# Run all unit tests
npx jest --config jest.config.ts --no-coverage

# Run with coverage report
npx jest --config jest.config.ts --coverage

# Run a specific test file
npx jest --config jest.config.ts vision-tools --no-coverage

# Watch mode (re-runs on file changes)
npx jest --config jest.config.ts --watch

# End-to-end tests (requires Ollama running)
npm run e2e
```

Test coverage reports are generated in `widget/coverage/`.

---

## Documentation

Detailed documentation is available in the `docs/` folder:

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System overview, component details, tool execution flow, safety model |
| [Setup Guide](docs/setup-guide.md) | Step-by-step installation and first-run instructions |
| [API Reference](docs/api-reference.md) | Complete IPC channel reference, tool schemas, permission system |
| [Custom LLM API](docs/custom-llm-api.md) | Configure OpenAI, Anthropic, OpenRouter, or custom endpoints |
| [Permissions](docs/permissions.md) | Tool permission model and batch execution behaviour |
| [PowerShell Scripts](docs/powershell-scripts.md) | FileOps, SystemInfo, SafetyValidation, ArchiveOps reference |
| [n8n Integration](docs/n8n-integration.md) | Workflow integration and PowerShell script wiring |
| [Sports Report](docs/sports-report.md) | NBA tool usage, permissions, and ESPN integration |

---

## Academic Context

SADIE is developed as a capstone project at **Toi Ohomai Institute of Technology** (2026).

| | |
|---|---|
| **Student** | Aden Kingi |
| **Supervisor** | Francisco Roldao |
| **Institution** | Toi Ohomai Institute of Technology |
| **Stack** | Electron 28, React 18, TypeScript 5.9.3, Ollama, n8n, PowerShell |

---

## Roadmap

### Completed

- [x] Electron 28 + React 18 desktop shell with electron-vite build system
- [x] 60+ modular TypeScript tool handlers with structured JSON tool-calling
- [x] Ollama local LLM integration (phi4-mini, qwen2.5-coder:3b, moondream, dolphin-phi:2.7b)
- [x] Vision tools: describe and query images via moondream (1.7 GB, 4 GB VRAM friendly)
- [x] Hybrid RAG: TF-IDF keyword search + nomic-embed-text semantic embeddings with Reciprocal Rank Fusion
- [x] Agentic tool loops: LLM autonomously chains tools for multi-step requests with streaming progress
- [x] Proactive morning briefing: weather + calendar + reminders summary on first daily interaction
- [x] Embedded web services (ChatGPT, Claude, Gemini) in sandboxed panels
- [x] Code cloud API routing (OpenAI / Anthropic / OpenRouter / Groq / DeepSeek / Google AI Studio / Custom)
- [x] Hardware profile auto-detection: GPU VRAM-aware model defaults (4 GB / 8 GB / 16 GB+)
- [x] 5 GB VRAM model stack: phi4-mini + moondream + dolphin-phi fits on budget GPUs
- [x] Light / dark / system theme with futuristic UI accents
- [x] Global hotkey (`Ctrl+Shift+Space`)
- [x] Auto-update via electron-updater
- [x] Image generation with Pollinations.ai and Stable Horde fallback
- [x] NBA live scores, standings, full-season results via ESPN, fuzzy team name matching
- [x] Google Calendar integration via ICS feed (no OAuth needed) + n8n webhook
- [x] Persistent reminders and scheduled jobs
- [x] Ollama health banner on startup
- [x] Security hardening (SSRF, IPC, webhook auth, tool recursion cap)
- [x] Model-aware context budgets for small models (3B and under)
- [x] Cloud model metadata with cost hints (Claude Opus 4, Sonnet 4, GPT-4o Mini, Gemini 2.0 Flash, and more)
- [x] Mixture of Agents (MoA) with hardware-aware presets
- [x] MCP server integration (stdio + SSE) with auto-discovery
- [x] Skills system: trigger-based context injection for domain-specific expertise
- [x] Analytics dashboard, conversation management, focus mode
- [x] 115 test suites / 1,716 unit tests + Playwright E2E
- [x] Windows NSIS installer via electron-builder

### Planned

- [ ] Always-on voice mode with wake word detection
- [ ] Screen awareness (screenshot capture + OCR for active window analysis)
- [ ] Widget dashboard with glanceable tiles (weather, calendar, reminders, quick actions)
- [ ] Conversation branching and forking with visual tree view
- [ ] Internationalisation (i18n): multi-language support
- [ ] Performance benchmarking and resource usage optimisation
- [ ] User acceptance testing with target audience feedback
