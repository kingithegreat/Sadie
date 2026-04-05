# SADIE — Project Proposal

## Smart AI Desktop Interactive Engine

**Academic Capstone Project Proposal**

---

## Student Information

| Field | Detail |
|---|---|
| **Student** | Aden Kingi |
| **Supervisor** | Francisco Roldao |
| **Institution** | Toi Ohomai Institute of Technology |
| **Programme** | Bachelor of Computing Systems, Level 7 |
| **Project Duration** | Full academic year |

---

## 1. Problem Statement

Existing AI assistants require constant internet connectivity and send user data to cloud servers, creating privacy concerns for users who handle sensitive information. Desktop users lack a capable, offline-first AI assistant that can perform productivity tasks (file management, code execution, web search) while keeping data on the local machine.

---

## 2. Proposed Solution

SADIE (Smart AI Desktop Interactive Engine) is a desktop AI assistant that:

- Runs large language models **locally** via Ollama, requiring no internet for core functionality.
- Provides a **comprehensive tool system** (20+ handlers) for file operations, code execution, web search, computer vision, sports data, and more.
- Implements a **multi-layered security model** to prevent misuse while maintaining usability.
- Offers **optional cloud LLM integration** for users who want advanced models (GPT-4o, Claude Opus 4, Gemini).
- Delivers a **modern, themeable UI** built with React and Electron.

---

## 3. Project Objectives

### Primary Objectives

1. **Offline AI Chat**: Run local LLMs via Ollama with streaming responses.
2. **Tool System**: Implement 15+ tool handlers for common productivity tasks.
3. **Security**: Build a multi-layer safety pipeline to filter harmful content and prevent abuse.
4. **Desktop Integration**: Leverage Electron for system tray, hotkeys, notifications, and file access.
5. **Testing**: Achieve comprehensive test coverage with unit and E2E tests.

### Secondary Objectives

6. **Cloud AI**: Integrate optional cloud LLM providers for enhanced model access.
7. **Memory**: Implement short-term and long-term memory for contextual conversations.
8. **Workflow Automation**: Integrate n8n for visual workflow orchestration.
9. **Accessibility**: Support speech recognition (Whisper) and text-to-speech.
10. **Documentation**: Produce professional technical and user documentation.

### Stretch Goals

11. **Analytics Dashboard**: Usage analytics with local-only data collection.
12. **i18n**: Internationalisation foundation for multi-language support.
13. **Sports Intelligence**: Live and historical sports data retrieval.
14. **Image Generation**: AI image creation via external APIs.

---

## 4. Outcomes Achieved

All primary, secondary, and stretch objectives have been completed:

| Objective | Status | Evidence |
|---|---|---|
| Offline AI Chat | ✅ Complete | Ollama integration, streaming, multi-model |
| Tool System | ✅ Complete | 20+ tool handlers (exceeds target of 15+) |
| Security | ✅ Complete | 7-layer safety pipeline, CSP, sandbox, SSRF protection |
| Desktop Integration | ✅ Complete | System tray, global hotkey, toast notifications, auto-update |
| Testing | ✅ Complete | 112 suites / 1,604 tests, Playwright E2E |
| Cloud AI | ✅ Complete | 6 providers: OpenAI, Anthropic, Google, xAI, DeepSeek |
| Memory | ✅ Complete | Short-term context, long-term JSON store, RAG |
| Workflow Automation | ✅ Complete | n8n integration with webhook HMAC auth |
| Accessibility | ✅ Complete | Whisper STT, TTS, keyboard navigation |
| Documentation | ✅ Complete | Full documentation suite (15+ documents) |
| Analytics Dashboard | ✅ Complete | Local analytics with opt-in consent |
| i18n | ✅ Complete | Foundation with locale loading framework |
| Sports Intelligence | ✅ Complete | NBA scores, full-season data, timezone handling |
| Image Generation | ✅ Complete | Pollinations + Stable Horde with fallback chain |

---

## 5. Technical Architecture

### Technology Choices

| Component | Technology | Rationale |
|---|---|---|
| **Desktop Shell** | Electron 28 | Offline-first, filesystem access, auto-update |
| **Language** | TypeScript 5.9.3 | Type safety, IDE tooling, compile-time errors |
| **UI** | React 18 | Component model, ecosystem, developer productivity |
| **Build** | electron-vite | Fast builds, HMR, ESM support |
| **Local AI** | Ollama | Free, private, no cloud dependency |
| **Testing** | Jest + Playwright | Unit and E2E coverage |
| **Packaging** | electron-builder | NSIS installer, code signing |

### Architecture Overview

```
┌──────────────────────────────────────────────┐
│                Electron Shell                 │
│                                              │
│  Renderer (React)  ◄─► Preload ◄─► Main     │
│  - Chat UI              (IPC       - Tools   │
│  - Settings             Bridge)    - LLM     │
│  - Analytics                       - Safety  │
│  - Themes                          - Memory  │
│                                              │
│        ┌──────────┬──────────┬────────┐      │
│        │  Ollama  │  Cloud   │  n8n   │      │
│        │  (Local) │  (API)   │(Docker)│      │
│        └──────────┴──────────┴────────┘      │
└──────────────────────────────────────────────┘
```

### Security Architecture

- **Process isolation**: Chromium sandbox, context isolation, no Node.js in renderer.
- **IPC allowlist**: Only approved channels pass through preload.
- **7-layer safety**: Profanity → harm → PII → injection → tool-abuse → output → audit.
- **SSRF protection**: Blocked internal network addresses.
- **Permission model**: User must approve each tool category before execution.

---

## 6. Methodology

### Development Approach

- **Iterative**: Feature development in phases with testing at each phase boundary.
- **Test-Driven**: Tests written alongside features; no phase closes with failing tests.
- **Security-First**: Security controls implemented before feature exposure.
- **Documentation-First**: Documentation updated with each feature addition.

### Tools and Workflow

| Tool | Purpose |
|---|---|
| **Git** | Version control (GitHub, `main` branch) |
| **VS Code** | Primary IDE with TypeScript IntelliSense |
| **GitHub Copilot** | AI-assisted development |
| **Jest** | Unit testing framework |
| **Playwright** | E2E testing framework |
| **Docker** | n8n workflow server |
| **electron-builder** | Application packaging |

---

## 7. Testing Strategy

| Layer | Framework | Scope |
|---|---|---|
| **Unit** | Jest | 112 suites, 1,604 tests |
| **E2E** | Playwright | 12+ scenarios |
| **Security** | Jest (embedded) | SSRF, XSS, injection, traversal |
| **Integration** | Jest (embedded) | IPC, persistence, n8n |

All tests pass with zero failures. Test-driven development ensured no regressions across the 8 development phases.

---

## 8. Evaluation Criteria

| Criterion | Metric | Result |
|---|---|---|
| **Functionality** | All objectives met | ✅ 14/14 objectives complete |
| **Quality** | Zero test failures | ✅ 112 suites, 1,604 tests, 0 failures |
| **Security** | OWASP Top 10 addressed | ✅ 7-layer pipeline, CSP, sandbox |
| **Performance** | Responsive with 3B model | ✅ Context budget, streaming tokens |
| **Documentation** | Complete technical docs | ✅ 15+ professional documents |
| **Usability** | Modern, accessible UI | ✅ Themes, keyboard shortcuts, focus mode |
| **Innovation** | Beyond basic chatbot | ✅ 20+ tools, vision, sports, RAG |

---

## 9. References

- Electron Documentation: https://www.electronjs.org/docs
- Ollama: https://ollama.com
- React: https://react.dev
- TypeScript: https://www.typescriptlang.org
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Playwright: https://playwright.dev
- n8n: https://n8n.io
- ESPN API: https://site.api.espn.com
