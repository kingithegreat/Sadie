# SADIE — Project Plan

Academic capstone project plan for the SADIE desktop AI assistant.

---

## Project Information

| Field | Detail |
|---|---|
| **Project Title** | SADIE — Smart AI Desktop Interactive Engine |
| **Student** | Aden Kingi |
| **Supervisor** | Francisco Roldao |
| **Institution** | Toi Ohomai Institute of Technology |
| **Programme** | Bachelor of Computing Systems, Level 7 |
| **Repository** | [github.com/kingithegreat/Sadie](https://github.com/kingithegreat/Sadie) |

---

## Project Objective

Design and develop a privacy-first desktop AI assistant that runs large language models locally, provides a comprehensive tool system for productivity tasks, and demonstrates professional software engineering practices including testing, security, and documentation.

---

## Technology Stack

| Layer | Technology | Justification |
|---|---|---|
| **Desktop Framework** | Electron 28 | Cross-platform, sandboxed, auto-update support |
| **Language** | TypeScript 5.9.3 | Type safety, IDE support, compile-time error detection |
| **UI Framework** | React 18 | Component model, hooks, ecosystem maturity |
| **Build System** | electron-vite | Fast builds, HMR, ESM-native |
| **Local AI** | Ollama | Free, local inference, no cloud dependency |
| **Cloud AI** | OpenAI, Anthropic, Google, xAI, DeepSeek | Optional enhanced models |
| **Automation** | n8n (Docker) | Visual workflow builder, webhook support |
| **Unit Testing** | Jest + ts-jest | TypeScript-native, snapshot support |
| **E2E Testing** | Playwright | Electron app automation, trace recording |
| **Packaging** | electron-builder | NSIS installer, code signing, auto-update |

---

## Project Phases

### Phase 1 — Foundation ✅

- [x] Electron application scaffold with electron-vite
- [x] React renderer with component architecture
- [x] Preload bridge with context isolation
- [x] IPC communication layer with allowlist
- [x] Ollama integration for local LLM inference
- [x] Basic chat UI with streaming responses
- [x] Configuration management (settings persistence)
- [x] Logging system with file output

### Phase 2 — Tool System ✅

- [x] Tool registry with `registerTool()` API
- [x] Intent detection (regex + keyword matching)
- [x] File system operations (read, write, create, search)
- [x] Web search with fallback chain
- [x] Code execution sandbox with timeout
- [x] Computer vision (llava model integration)
- [x] Permission model with escalation flow
- [x] JSON schema validation for tool arguments

### Phase 3 — Intelligence and Memory ✅

- [x] Short-term memory (conversation context window)
- [x] Long-term memory (key-value JSON store)
- [x] RAG indexing (TF-IDF chunking and search)
- [x] Memory-aware system prompts
- [x] Context budget system for small models (3B–8B)
- [x] Reminder system with persistence
- [x] Scheduler with cron-like triggers

### Phase 4 — Safety and Security ✅

- [x] 7-layer safety pipeline (profanity → harm → PII → injection → tool-abuse → output → audit)
- [x] Content Security Policy on renderer
- [x] IPC channel allowlist enforcement
- [x] SSRF protection (blocked internal IPs)
- [x] Path traversal protection (normalised paths)
- [x] Toast XML sanitisation
- [x] Git message injection prevention
- [x] PID validation for process management
- [x] Tool recursion cap
- [x] Webhook HMAC authentication

### Phase 5 — User Experience ✅

- [x] Dark, light, and system themes
- [x] Conversation sidebar with search and filter
- [x] Conversation pinning, archiving, and tagging
- [x] Message bookmarks and reactions
- [x] Message editing and timestamps
- [x] Reading time estimates
- [x] Keyboard shortcuts system
- [x] Toast notification system
- [x] Focus mode (distraction-free chat)
- [x] Drag-drop file support
- [x] Message density toggle (compact/comfortable)
- [x] Input character counter
- [x] Date separators in message list
- [x] JSON export for conversations

### Phase 6 — Cloud and Integration ✅

- [x] Cloud LLM integration (6 providers)
- [x] MODEL_METADATA with native token limits
- [x] n8n workflow orchestration
- [x] MCP server client
- [x] Whisper speech recognition
- [x] Text-to-speech
- [x] NBA/sports data via ESPN API
- [x] Full-season sports data fetch
- [x] Browser content extraction
- [x] Image generation (Pollinations + Stable Horde fallback)

### Phase 7 — Polish and Quality ✅

- [x] Analytics dashboard
- [x] Telemetry with opt-in consent
- [x] Auto-update system
- [x] System tray with global hotkey
- [x] User avatar upgrade
- [x] Futuristic UI accents (cyan/magenta gradients)
- [x] i18n foundation (locale loading framework)
- [x] Performance tuning (log buffer caps, dead code removal)
- [x] Comprehensive documentation overhaul

### Phase 8 — Testing ✅

- [x] 112 unit test suites with 1,604 tests
- [x] Playwright E2E test suite (12+ scenarios)
- [x] Security-focused test coverage
- [x] Context budget test coverage
- [x] All tests passing with zero failures

---

## Deliverables

| Deliverable | Status | Location |
|---|---|---|
| Source code | Complete | `widget/src/` |
| Unit tests (112 suites) | Complete | `widget/src/*/__tests__/` |
| E2E tests | Complete | `widget/src/renderer/e2e/` |
| NSIS installer | Complete | `widget/dist/` (via `npm run dist`) |
| Architecture documentation | Complete | `docs/architecture.md`, `FINAL_ARCHITECTURE_DIAGRAM.md` |
| Security documentation | Complete | `SECURITY_AND_COMPLIANCE.md` |
| Testing documentation | Complete | `TESTING_MATRIX.md` |
| User documentation | Complete | `README.md`, `docs/setup-guide.md` |
| Developer documentation | Complete | `DEVELOPER_BUILD_GUIDE.md` |
| Demo script | Complete | `DEMO_SCRIPT.md` |
| Release process | Complete | `RELEASE_PROCESS.md` |

---

## Risk Management

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ollama API changes | Low | Medium | Pin Ollama version, abstract API calls |
| Cloud provider API changes | Medium | Low | Adapter pattern per provider, fallback to local |
| Electron security vulnerability | Low | High | Regular updates, CSP, sandbox enforcement |
| Model quality regression | Medium | Medium | Test with multiple models, synthesis guard |
| Large dependency chain | Medium | Low | `npm audit`, integrity scanning |
| Scope creep | High | Medium | Phase-based planning, feature freeze before release |

---

## Lessons Learned

1. **electron-vite** provides significantly faster builds than Webpack for Electron projects.
2. **Context budget** is essential when targeting small (3B–8B) models — without it, prompts exceed token limits.
3. **Defence-in-depth** (7-layer safety) catches issues that individual filters miss.
4. **Schema validation** at the tool boundary prevents entire classes of bugs.
5. **IPC allowlisting** is a low-cost, high-impact security measure for Electron apps.
6. **Timezone handling** for sports data requires explicit previous-day fallback logic.
