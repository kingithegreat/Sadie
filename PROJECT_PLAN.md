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

## Product Roadmap

SADIE already has a broad local-first feature base. The next roadmap is not about adding every possible capability. It is about becoming the most reliable, easiest-to-run local AI desktop option for Windows users who want privacy, strong defaults, and useful local workflows.

### Strategic Goal

Make local AI feel easier, safer, and more useful than defaulting to a cloud chat product.

### Product Pillars

1. Zero-friction setup
2. Hardware-aware performance
3. Local-first reliability
4. Clear privacy guarantees
5. Opinionated model defaults
6. Measured quality and proof

### Release 1 — Setup and Trust (Next 30 Days)

- Deliver a first-run setup flow that verifies Ollama, available RAM/VRAM, disk space, ports, and required permissions.
- Add hardware-tier presets for low-end, balanced, and high-performance machines.
- Recommend the right default model stack for chat, coding, vision, and embeddings.
- Improve failure handling for missing models, stopped Ollama service, and invalid local configuration.
- Surface a plain-language privacy contract explaining what stays local and what can leave the device.
- Instrument baseline product metrics: startup time, first-token latency, model load time, and tool success rate.

### Release 2 — Reliability and Local Utility (30 to 60 Days)

- Build a model manager with download guidance, health checks, fallback routing, and task-specific defaults.
- Harden offline workflows so core chat, file tasks, RAG, memory, and export continue to work without internet access.
- Improve index and cache recovery paths so corrupted local state is repairable from the UI.
- Reduce time-to-first-use by simplifying setup docs, startup messaging, and model selection.
- Publish a compatibility matrix for supported Windows configurations and recommended model bundles.
- Add focused regression coverage for onboarding, model fallback, and offline-mode behavior.

### Release 3 — Differentiation and Proof (60 to 90 Days)

- Expand the workflows that are uniquely strong on-device: local document intelligence, desktop automation, coding assistance, and scheduled personal workflows.
- Ship benchmark-backed comparisons for common hardware tiers, including latency, memory footprint, and recommended models.
- Tighten installer, update, and recovery flows so non-technical users can maintain the app with minimal support.
- Use user feedback to remove friction from the highest-frequency local workflows before adding broad new features.
- Refine product positioning around privacy-first local productivity rather than general AI feature parity.

### Current Priorities

1. First-run diagnostics and onboarding
2. Model recommendation and fallback system
3. Performance measurement and optimization
4. Reliability and recovery UX
5. Privacy clarity in product and docs
6. Installer, updates, and support readiness

### Success Metrics

| Metric | Target Direction |
|---|---|
| Time from install to first successful response | Down |
| First-run failure rate | Down |
| Model download completion rate | Up |
| Cold start time | Down |
| First-token latency | Down |
| Successful tool execution rate | Up |
| Document indexing success rate | Up |
| Offline task completion rate | Up |
| 7-day and 30-day retention | Up |

### Features to Defer Until Core Experience Improves

- Always-on voice mode
- Wake word detection
- Expanded visual conversation branching
- Broader language support beyond the existing i18n foundation
- Additional cloud integrations that do not improve the local-first experience

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
