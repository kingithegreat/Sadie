# SADIE — Submission Overview

**Smart AI Desktop Interactive Engine**
Version 1.0.4 | Academic Capstone Project

---

## Project Summary

SADIE is a privacy-first, offline-capable desktop AI assistant built with Electron 28, TypeScript, and React. It runs large language models locally via Ollama while offering optional cloud LLM integration (OpenAI GPT-4o, Claude Opus 4, Gemini, Grok, DeepSeek). The application provides a comprehensive tool system with 20+ handlers for file operations, web search, code generation, computer vision, sports data, reminders, and more — all governed by a multi-layered security and permission framework.

---

## Technical Architecture

| Layer | Technology | Purpose |
|---|---|---|
| **Desktop Shell** | Electron 28 | Secure sandboxed window, auto-update, system tray |
| **Renderer** | React 18 + Vite | Chat UI, settings, analytics dashboard |
| **Build System** | electron-vite | Unified build for main, preload, and renderer |
| **Language** | TypeScript 5.9.3 | Type safety across all processes |
| **Local AI** | Ollama (llama3.2, qwen2.5-coder, llava) | Offline inference |
| **Cloud AI** | OpenAI, Anthropic, Google, xAI, DeepSeek | Optional remote models |
| **Automation** | n8n (Docker) | Workflow orchestration |
| **Testing** | Jest + Playwright | Unit and E2E coverage |
| **Packaging** | electron-builder | NSIS installer, auto-update |

---

## Key Achievements

### Test Coverage

| Metric | Value |
|---|---|
| **Unit Test Suites** | 110 |
| **Individual Tests** | 1,533 |
| **E2E Scenarios** | Playwright-based, multi-flow |
| **Zero Failures** | All tests pass on every commit |

### Feature Scope

| Category | Capabilities |
|---|---|
| **Core AI** | Multi-model chat, streaming responses, context budget management, intent detection, tool routing |
| **Tool System** | 20+ handlers — file I/O, web/image search, code execution, vision, reminders, sports data, browser content extraction, image generation |
| **User Experience** | Dark/light/system themes, focus mode, analytics dashboard, conversation pinning, bookmarks, archiving, JSON export, reactions, tags, message editing, reading time estimates, keyboard shortcuts, toast notifications |
| **Security** | 7-layer safety model, CSP headers, sandbox isolation, input sanitisation, webhook HMAC auth, tool recursion cap, SSRF protection, PID validation |
| **Accessibility** | Whisper-based speech recognition, text-to-speech, keyboard navigation, screen-reader support |
| **Sports Intelligence** | Live NBA scores, full-season results, table formatting, timezone-aware display (NZST), ESPN API integration |

### Security and Compliance

- Content Security Policy on all renderer pages.
- Electron sandbox enabled with `contextIsolation: true`.
- IPC allowlist restricts channel access to approved operations.
- Input sanitisation protects against XSS, path traversal, and command injection.
- Webhook HMAC authentication prevents unauthorized workflow triggers.
- Tool recursion capped to prevent infinite loops.
- SSRF protection blocks requests to internal network addresses.
- 7-layer safety filter chain: profanity → harm → PII → prompt-injection → tool-abuse → output → audit.

---

## Project Context

| Field | Detail |
|---|---|
| **Student** | Aden Kingi |
| **Supervisor** | Francisco Roldao |
| **Institution** | Toi Ohomai Institute of Technology |
| **Programme** | Bachelor of Computing Systems, Level 7 |
| **Repository** | [github.com/kingithegreat/Sadie](https://github.com/kingithegreat/Sadie) |
| **License** | MIT |

---

## Build and Run

```bash
# Clone and install
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie/widget
npm install

# Development (hot-reload)
npm run dev

# Production build
npm run build

# Run all tests
npx jest --config jest.config.ts --no-coverage

# Create installer
npm run dist
```

### Prerequisites

- Node.js 18+ (tested with v24.13.0)
- Ollama with at least `llama3.2:3b` pulled
- Docker Desktop for n8n workflows (optional)
- Windows 10 or later

---

## Documentation

| Document | Description |
|---|---|
| [README.md](README.md) | Project overview, quick start, and feature summary |
| [DEVELOPER_BUILD_GUIDE.md](DEVELOPER_BUILD_GUIDE.md) | Developer setup, build commands, and testing |
| [SECURITY_AND_COMPLIANCE.md](SECURITY_AND_COMPLIANCE.md) | Security architecture and compliance details |
| [TESTING_MATRIX.md](TESTING_MATRIX.md) | Complete test suite inventory |
| [FINAL_ARCHITECTURE_DIAGRAM.md](FINAL_ARCHITECTURE_DIAGRAM.md) | System architecture diagrams |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Feature demonstration walkthrough |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [docs/](docs/) | Detailed technical documentation |
