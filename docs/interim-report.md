# HomeBot (SADIE) — Interim Project Report

**Topic:** HomeBot — A Privacy-First Desktop AI Assistant

**Student Name:** Aden Kingi

**Student Number:** 9821836

---

## 1. Executive Summary

HomeBot (originally SADIE — Structured AI Desktop Intelligence Engine) is a privacy-first desktop AI assistant built as a capstone project for the Bachelor of Computing Systems (Level 7) at Toi Ohomai Institute of Technology. The application runs entirely on the user's machine using Electron 28, React 18, and TypeScript, with Ollama providing local large language model (LLM) inference so that no data leaves the user's device unless they explicitly opt into a cloud provider.

The project is now in its final deployment-readiness phase. Over seven months of development (November 2025 – June 2026), the codebase has grown to 62,500+ lines of TypeScript across 265 source files, with 85+ tool handlers, 31 React components, 121 test suites comprising 1,907 automated tests, and 409 commits. The application is feature-complete against its original scope, with several additional capabilities (n8n workflow automation, agentic multi-step tool loops, image generation, quiz mode) delivered beyond the initial proposal. A full codebase sweep has been completed, addressing 32 bugs across 20 files, hardening security, updating documentation, and preparing the project for final submission and deployment.

---

## 2. Introduction

### 2.1 What Is the Project About?

HomeBot is a desktop AI assistant designed to give everyday users the power of a personal AI that respects their privacy. Unlike cloud-hosted assistants (Siri, Alexa, Google Assistant, ChatGPT), HomeBot runs its AI models locally via Ollama, meaning conversations, documents, and personal data never leave the machine. The assistant can search the web, manage files, inspect system resources, understand and generate images, automate tasks, index documents for semantic search, track sports scores, generate quizzes, and chain multi-step tool workflows autonomously — all through a modern, themeable desktop interface.

### 2.2 Who Is the Project For?

The primary audience is privacy-conscious users who want AI assistance without surrendering their data to cloud services. Secondary audiences include:

- **Power users** who want a customisable, extensible AI desktop tool.
- **Students and educators** who benefit from the quiz mode and document review features.
- **Home automation enthusiasts** who can leverage the n8n workflow integration for scheduled tasks.
- **Developers** interested in how local LLM inference can be integrated into a desktop application.

### 2.3 Timeline Position

The project began on **17 November 2025** with the first commit and has progressed through seven months of continuous development. As of **18 June 2026**, the project is in its **final phase**: deployment preparation, documentation refresh, and test hardening. All planned features are implemented and functional.

| Phase | Period | Status |
|---|---|---|
| Research and proposal | Oct – Nov 2025 | Complete |
| Core architecture (Electron + Ollama + IPC) | Nov – Dec 2025 | Complete |
| Tool handler development (85+ handlers) | Dec 2025 – Mar 2026 | Complete |
| Cloud provider integration (6 providers) | Feb – Mar 2026 | Complete |
| Agentic tool loops and morning briefing | Mar – Apr 2026 | Complete |
| n8n workflow automation and deployment | Apr – May 2026 | Complete |
| UI polish, quiz mode, image generation | May – Jun 2026 | Complete |
| Codebase sweep, security hardening, docs | Jun 2026 | Complete |
| Final testing and deployment | Jun 2026 | In progress |

### 2.4 Completion Status

**Completed:**

- Full Electron 28 + React 18 desktop application with installer (`HomeBot-Setup.exe`)
- 85+ TypeScript tool handlers covering web search, file management, system inspection, vision/OCR, RAG document indexing, browser automation, code execution, scheduling, sports data, image generation, and more
- Local LLM inference via Ollama with automatic model management and hardware profile detection
- Cloud LLM support for 6 providers (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google AI Studio)
- n8n workflow automation with one-click deployment from the Automation Center
- Agentic multi-step tool loop engine with streaming progress indicators
- Proactive morning briefing (weather, calendar, reminders)
- Hybrid RAG engine (TF-IDF + semantic embeddings via nomic-embed-text)
- Quiz mode with 12 topics, 3 difficulty levels, and persistent scoring
- Image generation with 5 backend support (SD WebUI, ComfyUI, DALL-E 3, Pollinations, Stable Horde)
- Light, dark, and system-auto themes with glass-morphism UI
- Voice input via Windows SAPI
- 121 test suites / 1,907 automated tests (Jest + Playwright)
- Comprehensive documentation (README, setup guide, architecture, API reference, changelog)
- 11-layer security model (SSRF protection, IPC hardening, webhook auth, injection guards, file size limits, etc.)
- One-click installer with first-run setup wizard (GPU detection, Ollama auto-install, model pull)

**Not completed / deferred:**

- **macOS and Linux builds**: The project targets Windows 10/11 as stated in the proposal. Cross-platform support was considered but deferred as it falls outside the capstone scope and would require significant platform-specific testing.
- **Mobile companion app**: An early stretch goal that was descoped to keep the project focused and deliverable.
- **OAuth-based calendar integration**: Google Calendar is supported via ICS feed URL (no OAuth required). Full OAuth flow was deprioritised in favour of the simpler, privacy-respecting ICS approach.

### 2.5 Problems Encountered and Solutions

| Problem | Solution |
|---|---|
| **Ollama IPv6 resolution failure**: Node.js 18+ prefers IPv6, causing `localhost` to resolve to `::1` while Ollama listens on `127.0.0.1`. | Changed all Ollama URLs from `localhost` to `127.0.0.1` across the codebase. |
| **Document content causing false tool triggers**: Uploaded document text was included in intent detection, causing the LLM to trigger weather/file tools based on document content. | Added content stripping before intent regex evaluation. |
| **PowerShell injection via contact search**: User-supplied contact search queries were interpolated directly into PowerShell commands. | Implemented metacharacter stripping (removes `$`, `(`, `)`, `;`, `|`, `` ` ``, `&`, `{`, `}`) and 128-character truncation. |
| **Unbounded conversation digest**: Long conversations caused context windows to overflow. | Capped rolling digest at 4,000 characters with smart truncation. |
| **n8n workflow deployment complexity**: Users needed to manually import workflows into n8n. | Built one-click deployment via Docker CLI — generates webhook-triggered workflows, imports via `docker exec`, activates in SQLite, and restarts the container. |
| **Electron launching as plain Node.js in VS Code terminals**: `ELECTRON_RUN_AS_NODE` environment variable from VS Code caused Electron to boot in CLI mode. | Dev script now clears `ELECTRON_RUN_AS_NODE` before launching. |
| **Model too large for user's GPU**: Users with 4 GB VRAM could not run the default 7B models. | Implemented automatic GPU VRAM detection with hardware profiles (4 GB / 8 GB / 16 GB+) that set appropriately sized model defaults. |

---

## 3. Methodology

### 3.1 Methodology Utilised

The project follows an **Agile iterative development methodology** with elements of **prototyping**. Development is organised into short, focused iterations (typically 1–2 weeks), each delivering a working increment of the software. This aligns with the methodology outlined in the project proposal, where Agile was selected for its flexibility, rapid feedback loops, and suitability for a single-developer project with evolving requirements.

Key Agile practices employed:

- **Iterative delivery**: Each commit or group of commits represents a deliverable increment — a new feature, bug fix, or improvement that is immediately testable.
- **Continuous integration**: All 1,907 tests run on every change to catch regressions immediately.
- **Refactoring as needed**: The codebase has been refactored multiple times (e.g., the SADIE → HomeBot rebrand, the model stack overhaul for smaller GPUs) without feature regression.
- **User story-driven features**: Features were prioritised by end-user value — core AI chat first, then tool handlers, then polish features like themes and quiz mode.
- **Prototyping for unknowns**: Early versions of the n8n integration, agentic loop, and image generation pipeline were prototyped and iterated on before being finalised.

### 3.2 Current Position in the Process

The project is in the **final iteration**: deployment hardening, documentation refresh, and test coverage expansion. The feature backlog is empty — all planned and stretch-goal features have been implemented. Current work focuses on:

1. Final codebase sweep (32 issues fixed across 20 files — completed)
2. Documentation alignment with current codebase state (completed)
3. Test coverage expansion (121 suites, 1,907 tests — completed)
4. Installer build and deployment preparation (in progress)
5. Final report and submission preparation (in progress)

### 3.3 Methodology Effectiveness

The Agile iterative approach has been highly effective for this project:

**Strengths:**

- **Rapid adaptation**: When hardware constraints surfaced (users with 4 GB VRAM), the methodology allowed a quick pivot to implement hardware profile auto-detection and smaller model defaults without disrupting other work.
- **Continuous testability**: Every iteration produced a runnable application, making it easy to demonstrate progress to the supervisor and catch issues early.
- **Scope flexibility**: Stretch goals (quiz mode, image generation, n8n deployment) were added organically as the core stabilised, without requiring upfront planning.
- **Reduced risk**: By delivering working software every 1–2 weeks, the risk of a late-project integration failure was eliminated.

**Challenges:**

- **Documentation lag**: The iterative pace sometimes outran documentation updates, requiring periodic "doc sweeps" to bring README, architecture, and API reference files up to date. This was addressed by including documentation as a deliverable in each iteration.
- **Test maintenance**: As the tool handler count grew to 85+, maintaining test coverage required deliberate effort. This was resolved by establishing a testing discipline: every new feature ships with tests.

### 3.4 Current Process

The current process is **deployment preparation**:

1. Verifying all 1,907 tests pass with no regressions.
2. Ensuring documentation (README, setup guide, architecture, API reference, changelog) accurately reflects the deployed state.
3. Building the production installer via `electron-builder`.
4. Preparing the final capstone report and presentation materials.

---

## 4. Results and Findings

### 4.1 Research Undertaken

The project required research across several domains:

| Research Area | Purpose | Key Findings |
|---|---|---|
| **Local LLM inference** | Evaluate frameworks for running AI models on consumer hardware. | Ollama was selected for its simplicity, broad model support, and HTTP API. Alternatives (llama.cpp, LM Studio) were evaluated but Ollama offered the best balance of ease-of-use and performance. |
| **Electron security model** | Understand IPC, context isolation, and preload bridge patterns. | Context isolation with a structured preload bridge is essential for preventing renderer-process access to Node.js APIs. The project implements 11 security layers. |
| **Tool-calling architectures** | Design a system where the LLM can invoke external tools. | Structured JSON tool-calling with a message router and tool dispatch loop proved most effective. The agentic loop extension allows multi-step autonomous execution. |
| **RAG (Retrieval-Augmented Generation)** | Enable the AI to search uploaded documents. | Hybrid TF-IDF + semantic embedding search (Reciprocal Rank Fusion) significantly outperforms either method alone. |
| **n8n workflow automation** | Integrate a workflow engine for scheduled and event-driven tasks. | n8n runs in Docker alongside the app. One-click deployment via Docker CLI + SQLite activation was developed as a novel integration pattern. |
| **Image generation pipelines** | Support text-to-image across multiple backends. | Auto-detection of available backends (SD WebUI, ComfyUI, DALL-E 3, Pollinations, Stable Horde) with graceful fallback provides the best user experience. |

### 4.2 Important Results and Findings

1. **Local LLMs are viable for desktop assistants**: The 7B parameter models (qwen2.5:7b, dolphin-mistral:7b) provide surprisingly capable responses for tool-calling, general chat, and coding assistance on consumer hardware. The quality gap with cloud models (GPT-4, Claude) is narrowing rapidly.

2. **Privacy and capability are not mutually exclusive**: By running everything locally, HomeBot demonstrates that users do not need to sacrifice privacy for a capable AI assistant. The 85+ tool handlers provide functionality comparable to cloud-hosted assistants.

3. **Hardware detection is critical for UX**: Early testers struggled when models were too large for their GPUs. Automatic VRAM detection and hardware profiles eliminated this friction entirely.

4. **Security requires deliberate layering**: A single security measure is insufficient. The project implements 11 distinct security layers (SSRF protection, injection guards, file size limits, tool recursion caps, etc.) because each addresses a different attack vector.

5. **Test coverage prevents regression at scale**: With 85+ tool handlers and 31 React components, the 1,907-test suite has caught dozens of regressions that would have shipped as bugs without automated testing.

6. **n8n integration amplifies functionality**: The n8n workflow engine transforms HomeBot from a reactive assistant into a proactive automation platform. Users can schedule recurring tasks, chain external APIs, and build workflows without writing code.

### 4.3 Problems Throughout the Project

| Problem | Impact | Resolution |
|---|---|---|
| CSS variable conflicts between light and dark themes | Visual glitches, unreadable text in certain modes | Comprehensive CSS audit; fixed dangling selectors, undefined variables, and duplicate keyframes |
| `Promise.allSettled` masking failures in `openUrl` | Users told URL opened successfully when it actually failed | Changed to properly detect `rejected` status in the settled results |
| Toast notifications stacking infinitely on Ollama reconnect | UI clutter, performance degradation | Implemented toast deduplication — track previous toast ID and dismiss before showing new one |
| Quiz score double-counting | Inflated quiz scores by up to 2x | Fixed `handleNext` to not re-add the current answer's score on top of already-updated total |
| Stale closure in keyboard shortcut handler | `Ctrl+N` created conversation in wrong state | Fixed with React ref pattern to avoid stale closure capture |
| Cloud provider switching left stale model state | Switching providers could send requests to wrong API | Added state clearing, provider validation, and forced reconnect on switch |

### 4.4 Approaches That Did Not Work

1. **Initial attempt at OAuth for Google Calendar**: Implementing a full OAuth 2.0 flow within Electron required a Google Cloud project, client secrets, and complex redirect handling. This was abandoned in favour of private ICS feed URLs, which provide the same data without any cloud configuration.

2. **Using `localhost` for Ollama connections**: Node.js 18+ defaults to IPv6 DNS resolution, so `localhost` resolved to `::1` while Ollama listened on `127.0.0.1`. This caused intermittent "Ollama offline" false alarms. The fix was straightforward — hardcode `127.0.0.1` — but diagnosing the issue was time-consuming.

3. **Single large model for all tasks**: Early versions used a single 7B model for everything. This failed for users with limited VRAM. The solution was the hardware profile system with appropriately sized models for each VRAM tier.

4. **Manual n8n workflow import**: Initially, users had to export workflow JSON from HomeBot and manually import it into the n8n UI. This was a poor user experience. The one-click deployment system (Docker CLI + SQLite activation) was developed to replace it.

### 4.5 Process or Outcome Changes

- **Scope expansion (additive)**: The project scope grew beyond the original proposal to include quiz mode, image generation, n8n one-click deployment, and agentic tool loops. These were added because the core was stable ahead of schedule and these features significantly enhanced the application's value.
- **Rebranding**: The project was rebranded from SADIE (Structured AI Desktop Intelligence Engine) to HomeBot mid-development. This required a codebase-wide rename across all source files, tests, documentation, and configuration.
- **Model defaults changed**: The default model stack was revised three times as new models became available and hardware constraints were better understood. The current defaults (qwen2.5:7b for chat, dolphin-mistral:7b for uncensored, moondream for vision) represent the best balance of quality and VRAM usage.

---

## 5. Recommendations and Conclusions

### 5.1 Conclusions to Date

1. **The project has achieved its core objective**: HomeBot demonstrates that a fully functional, privacy-first desktop AI assistant is achievable using open-source models and local inference. Users get genuine AI capability without sending data to third parties.

2. **Local LLM technology is ready for consumer desktop use**: Ollama + 7B models provide responsive, useful AI on machines with 8 GB+ RAM and a mid-range GPU. The technology has matured significantly during the project's development period.

3. **Security must be designed in, not bolted on**: The 11-layer security model was developed iteratively as new attack vectors were identified. Starting with security considerations early prevented costly retrofits.

4. **Comprehensive testing is non-negotiable at this scale**: With 62,500+ lines of code and 85+ tool handlers, the 1,907-test suite is not optional — it is essential infrastructure that enables confident refactoring, feature addition, and deployment.

5. **The Agile methodology was the correct choice**: Iterative development with continuous testing allowed the project to adapt to hardware constraints, scope changes, and technology updates without schedule disruption.

### 5.2 Further Research Required

- **Performance benchmarking**: Formal benchmarking of response latency, VRAM usage, and tool execution time across different hardware profiles would provide valuable data for model selection recommendations.
- **User testing**: Structured usability testing with target users would validate UX decisions and identify friction points not visible to the developer.
- **Newer model evaluation**: The local LLM landscape evolves rapidly. Models released after the project's model selection phase should be evaluated for potential quality improvements.

### 5.3 Scope Assessment

The project scope does **not** need to change. All features from the original proposal have been implemented, and several stretch goals have been delivered. The current scope is appropriate for the capstone deliverable.

### 5.4 Project Status

The project is **on target** and proceeding as expected. All features are implemented and tested. The remaining work is:

1. Final installer build and smoke testing
2. Capstone report completion
3. Presentation preparation
4. Submission

The project will be ready for final submission within the remaining timeline.

---

## Appendix — Project Metrics

| Metric | Value |
|---|---|
| Development period | 17 Nov 2025 – 18 Jun 2026 (7 months) |
| Total commits | 409 |
| Lines of TypeScript | 62,500+ |
| Source files | 265 |
| Tool handlers | 85+ |
| React components | 31 |
| Test suites | 121 |
| Automated tests | 1,907 |
| Cloud LLM providers | 6 |
| Security layers | 11 |
| Current version | v1.1.0 |
| Target platform | Windows 10/11 |
| Supervisor | Francisco Roldao |
| Institution | Toi Ohomai Institute of Technology |
| Programme | Bachelor of Computing Systems, Level 7 |
