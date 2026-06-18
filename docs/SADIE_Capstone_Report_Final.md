# SADIE — Structured AI Desktop Intelligence Engine

## A Privacy-First Offline AI Desktop Assistant

| | |
|---|---|
| **Student** | Aden Kingi |
| **Student Number** | 9821836 |
| **Supervisor** | Francisco Roldao |
| **Institution** | Toi Ohomai Institute of Technology |
| **Programme** | Bachelor of Computing Systems, Level 7 |
| **Submission** | Capstone Project Report — 2026 |
| **Repository** | github.com/kingithegreat/Sadie |

*This report documents the design, implementation, testing, and evaluation of SADIE as a local-first desktop AI agent with permission-gated tool execution.*

---

## Table of Contents

1. Abstract
2. Introduction
3. Problem Statement and Research Questions
4. Literature Review
5. Project Objectives and Scope
6. Methodology
   - 6.1 Development Approach
   - 6.2 Development Phases
   - 6.3 Methodology Effectiveness
   - 6.4 Tools and Technologies
   - 6.5 AI-Assisted Development Workflow
   - 6.6 Structured AI Handoff Methodology
   - 6.7 Why the Handoff Method Worked
7. System Architecture
8. Implementation
9. Safety and Security Model
10. Testing and Quality Assurance
11. Results and Evaluation
12. Discussion
   - 12.1 Strengths
   - 12.2 Limitations
   - 12.3 Problems Encountered and Solutions
   - 12.4 Approaches That Did Not Work
   - 12.5 Reflection on AI-Assisted Development
   - 12.6 AI-Portability as a Development Practice
13. Conclusion and Future Work
14. References
15. Appendices

---

## 1. Abstract

This report presents the design, implementation, and evaluation of SADIE (Structured AI Desktop Intelligence Engine), a privacy-first desktop AI assistant built with Electron 28, React 18, TypeScript, Ollama, and n8n. The project addresses the limitations of cloud-dependent AI assistants by providing local language-model inference, desktop tool execution, memory, automation, and multimodal interaction while keeping all user data on the local machine.

SADIE combines a local Ollama model runtime with a TypeScript tool system containing 85+ handlers across filesystem, web/data, memory, developer, vision/media, and desktop-system categories. A permission-gated execution model prevents tools from acting without explicit user approval. The application also includes optional cloud provider routing (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google AI Studio), workflow automation through n8n with one-click deployment, long-term local memory, hybrid RAG-based document retrieval using Reciprocal Rank Fusion, agentic multi-step tool loops, image generation across five backends, quiz mode, morning briefings, voice features, analytics, and a modern desktop user interface with light, dark, and system-auto themes.

The final codebase comprises 63,081 lines of TypeScript across 244 source files, with 520 commits over seven months of development. Evaluation indicates that the system met all core capstone objectives: offline AI chat, secure tool execution, desktop integration, local memory, vision support, automation, and test coverage. The current test suite contains 1,932 unit tests across 122 suites with 59.76% line coverage, supported by Playwright end-to-end testing. A one-click Windows installer (HomeBot Setup 1.1.0.exe, 152 MB) packages the complete application for end-user deployment.

The project demonstrates that privacy-first desktop AI is technically viable on consumer hardware when paired with a layered security architecture and disciplined iterative development.

---

## 2. Introduction

### 2.1 Background

Large language models (LLMs) have transformed how users interact with software. Cloud services such as ChatGPT (OpenAI, 2022), Claude (Anthropic, 2023), Gemini (Google, 2024), and Copilot (Microsoft, 2023) provide high-quality conversational assistance, but they depend on constant internet access and remote processing. This creates a fundamental tension between capability and control: the more useful a cloud assistant becomes, the more personal information, code, documents, and workflow context is transmitted outside the user's device.

At the same time, open-source model runtimes such as Ollama (Ollama, 2024) have made local inference increasingly practical. Models such as qwen2.5:7b (Qwen Team, 2024) can run on consumer hardware with 8 GB of RAM and a mid-range GPU, supporting useful reasoning, coding, summarisation, and task-planning workflows. This creates an opportunity to design a desktop assistant that preserves privacy by architecture rather than relying only on policy promises from cloud providers.

The convergence of capable local models, the Electron desktop framework (Electron, 2024), and workflow automation engines like n8n (n8n, 2024) makes it possible to build a desktop AI assistant that matches or approaches the functionality of cloud alternatives while keeping all data under the user's direct control.

### 2.2 Project Context

SADIE was developed as a Level 7 capstone project for the Bachelor of Computing Systems at Toi Ohomai Institute of Technology. The project investigates whether a local-first AI desktop assistant can provide practical capability while retaining user control over data and tool execution. The project is not merely a chat interface. It is an agentic desktop application that can perform real actions through registered tools — reading files, searching the web, managing processes, generating images, automating workflows — all subject to safety validation and user permissions.

The application was rebranded from SADIE to HomeBot in May 2026 to improve market positioning. The original acronym — Structured AI Desktop Intelligence Engine — was technically descriptive but lacked consumer appeal. "HomeBot" was chosen because it immediately communicates the product's purpose as a home desktop assistant, is memorable and approachable, and avoids the clinical connotation of an acronym-based name. This mirrors a common industry pattern: products often launch under internal or technical names and rebrand for release (e.g., "Electron" was originally "Atom Shell," and "VS Code" was internally "Monaco"). The SADIE acronym is retained for academic documentation to maintain traceability with the project proposal and midpoint review.

### 2.3 Report Structure

This report follows a standard academic structure. Sections 3–5 establish the problem, review related work, and define objectives. Section 6 covers methodology. Sections 7–9 detail system architecture, implementation, and security. Sections 10–11 present testing, results, and evaluation. Sections 12–13 provide discussion and conclusions. References and appendices follow.

---

## 3. Problem Statement and Research Questions

### 3.1 Problem Statement

Existing AI assistants commonly rely on constant internet connectivity and transmit user data to remote servers. Desktop users who work with private documents, codebases, local files, or restricted environments lack a capable offline-first AI agent that can act on their computer while keeping data local. Cloud assistants are also often conversational rather than fully desktop-agentic: they can advise the user, but they cannot safely perform controlled system tasks on the local machine.

Furthermore, users with limited or no internet access — whether by choice, geography, or workplace policy — are excluded from the benefits of modern AI assistance entirely. A local-first architecture would address this gap while also serving privacy-conscious users who have reliable internet but choose not to share their data with cloud providers.

### 3.2 Research Questions

- **RQ1:** Can local LLMs provide task-appropriate responses without cloud connectivity?
- **RQ2:** What security architecture safely exposes system tools to an LLM agent?
- **RQ3:** How can agentic tool loops be made reliable and predictable?
- **RQ4:** Is offline-first AI viable as a privacy-preserving desktop solution on consumer hardware?

---

## 4. Literature Review

### 4.1 Local LLM Inference

The viability of local LLM inference has improved dramatically since 2023. Ollama (2024) provides a simple HTTP API for running quantised open-source models on consumer hardware. The Qwen 2.5 family (Qwen Team, 2024) offers instruction-following models from 0.5B to 72B parameters, with the 7B variant achieving strong performance on coding, reasoning, and tool-calling benchmarks. Mistral-based fine-tunes such as dolphin-mistral:7b (Cognitive Computations, 2024) provide uncensored alternatives for users who need unrestricted model outputs.

Prior work by Touvron et al. (2023) with LLaMA demonstrated that smaller models can approach the quality of much larger proprietary models when properly fine-tuned, making desktop deployment feasible on hardware with 4–16 GB of VRAM.

### 4.2 Agentic AI Systems

The ReAct framework (Yao et al., 2023) established the paradigm of interleaving reasoning and acting in language models, enabling LLMs to plan multi-step tasks and execute tools iteratively. This approach has been adopted widely in production systems. SADIE implements a similar pattern through its agentic loop engine, which detects multi-step requests and allows the LLM to autonomously chain tool calls with a safety cap.

Schick et al. (2023) demonstrated with Toolformer that language models can learn to use external tools effectively when given appropriate tool descriptions and examples. SADIE applies this principle by providing structured JSON tool definitions to the LLM at inference time.

### 4.3 Retrieval-Augmented Generation

Lewis et al. (2020) introduced RAG as a method for grounding LLM responses in external knowledge. SADIE implements a hybrid RAG system combining TF-IDF keyword matching with semantic embedding search (via Ollama's nomic-embed-text model), fused using Reciprocal Rank Fusion (RRF) as described by Cormack et al. (2009). This dual approach provides robust retrieval even when Ollama or the embedding model is unavailable, falling back gracefully to keyword-only search.

### 4.4 Electron Security

Electron's multi-process architecture (Electron, 2024) separates the renderer (web page) from the main process (Node.js). The security documentation recommends context isolation, a strict preload bridge, and disabling Node.js integration in the renderer to prevent cross-site scripting and privilege escalation attacks. SADIE follows all of these recommendations and adds additional layers including IPC channel allowlisting, tool permission gating, and SSRF protection.

### 4.5 Existing Desktop and Local AI Tools

The local AI tool landscape grew rapidly during SADIE's development period (November 2025 – June 2026). Several existing tools occupy adjacent spaces, each addressing a subset of the capabilities SADIE targets:

| Tool | First Release | Type | Key Capability | SADIE Differentiator |
|---|---|---|---|---|
| Open WebUI | Feb 2024 | Self-hosted web app | Full-featured web UI for Ollama with RAG, multi-model chat, and user management | Web-based, not a desktop app — no system tray, global hotkey, native installer, or desktop tool execution. Requires browser access and Docker setup. |
| LM Studio | Late 2023 | Desktop app | GUI for downloading and running local models with chat interface | Focused on model management and chat — no tool execution, no agentic loops, no automation, no permission gating. |
| Jan.ai | Late 2023 | Desktop app | Local-first chat interface with extension system | Extension system is nascent — lacks SADIE's 85+ tool handlers, n8n automation, vision, image generation, and security model. |
| Open Interpreter | Mid 2024 | CLI tool | LLMs execute code locally with full system access | Terminal-only — no desktop GUI, no permission gating (runs code with full access), no IPC isolation. Higher security risk by design. |
| GPT4All | 2023 | Desktop app | Offline chat with local models, document Q&A | Chat-focused with basic RAG — no tool execution, no agentic loops, no automation, no cloud provider routing. |
| AnythingLLM | 2024 | Desktop/web app | Local LLM chat with document embedding and RAG | Strong RAG but limited tool execution — no filesystem, terminal, process management, or agentic multi-step tool chains. |

SADIE's development began on 17 November 2025, after the initial releases of LM Studio, Jan.ai, and GPT4All but contemporaneous with the maturation of Open WebUI and Open Interpreter. The key gap that SADIE addresses is the combination of **agentic desktop tool execution** with **permission gating** — most existing tools either provide chat without agency (LM Studio, GPT4All, Jan) or provide agency without safety controls (Open Interpreter). Open WebUI is the closest in feature breadth but operates as a web application rather than a native desktop assistant, meaning it cannot provide system tray integration, global hotkeys, native toast notifications, or direct desktop tool execution.

None of the existing tools provide SADIE's combination of: (1) agentic tool execution with an 85+ handler registry, (2) an 11-layer permission-gated security model, (3) n8n workflow automation with one-click deployment, (4) hybrid RAG with Reciprocal Rank Fusion, (5) five-backend image generation, and (6) a native desktop application with a one-click installer.

### 4.6 Workflow Automation

n8n (2024) is an open-source workflow automation platform that supports webhook triggers, API integrations, and conditional logic. It runs in Docker and provides a visual workflow editor. SADIE integrates n8n as an optional automation backend, enabling users to create, deploy, and execute n8n workflows directly from the application without interacting with the n8n UI.

---

## 5. Project Objectives and Scope

### 5.1 Objectives

1. Deliver offline AI chat through Ollama using local language models as the default inference backend.
2. Implement a broad tool system with at least 15 handlers; final delivery exceeded this target with 85+ handlers across 27 tool modules.
3. Build a permission-gated security architecture for filesystem, terminal, web, memory, and automation tools.
4. Provide a modern desktop interface with conversation history, streaming responses, settings, themes, and desktop integration (system tray, global hotkey, toast notifications).
5. Support local memory, document retrieval (RAG), optional cloud model routing, n8n automation, voice input, vision, image generation, quiz mode, and analytics.
6. Validate implementation quality through Jest unit testing and Playwright end-to-end testing.
7. Package the application as a one-click Windows installer.

### 5.2 Scope

The primary target platform is Windows 10/11 desktop. The core application is local-first and can operate without internet for chat, memory, vision, and local tool workflows. Internet access is optional and required only for web search, live sports data, external APIs, n8n integrations, image generation via cloud backends, and cloud model providers.

### 5.3 Out of Scope

The following items were identified as out of scope for the capstone submission:

- macOS and Linux packaging (platform-specific tool equivalents would need development and testing)
- Mobile companion application
- Full OAuth 2.0 integration (Google Calendar uses ICS feeds instead)
- Formal user study with external participants (addressed as future work)

---

## 6. Methodology

### 6.1 Development Approach

The project used an **Agile iterative, test-driven, security-first** development methodology organised into sprint-based phases, with each phase closing only after build and test gates had passed. Documentation was updated alongside implementation to preserve traceability between requirements, architecture decisions, and delivered functionality.

This approach was chosen over a traditional waterfall model for several reasons:

1. **Evolving requirements**: The local LLM landscape changed rapidly during development (new models, new capabilities), requiring the ability to adapt.
2. **Single developer**: Without a large team, the overhead of formal waterfall documentation would have consumed time better spent on implementation and testing.
3. **Risk reduction**: Delivering working increments every 1–2 weeks meant that integration failures were caught immediately rather than accumulating until a late integration phase.

| Principle | Application in SADIE |
|---|---|
| Iterative development | Features were delivered in phases, allowing architecture, UI, and tools to mature incrementally. Each of the 520 commits represents a testable increment. |
| Test-driven practice | Tests were written alongside features and used as regression protection during refactoring. The suite grew from 0 to 1,932 tests over the project lifetime. |
| Security-first design | Tool access, IPC boundaries, and permission gates were designed before exposing system-level capabilities. The security model was not retrofitted. |
| Docs-first discipline | Architecture notes, API reference, setup guide, and changelog were maintained continuously to support evaluation and handover. |

### 6.2 Development Phases

| Phase | Period | Focus | Key Deliverables |
|---|---|---|---|
| Foundation | Nov – Dec 2025 | Application scaffold and local model integration | Electron shell, React renderer, Ollama connection, streaming chat |
| Architecture review | Jan 2026 | Research pause and design consolidation | Config Manager pattern, JSONL persistence design, intent classifier architecture |
| Tool system | Jan – Feb 2026 | Desktop agency and tool routing | Filesystem, web/data, developer, memory, vision, and system handlers |
| Security | Jan – Feb 2026 | Permission and safety controls | IPC allowlist, context isolation, prompt-injection guard, audit logging, recursion cap |
| Feature push | Mar 2026 | Rapid feature delivery (125 commits) | Cloud providers (initially Cerebras, OpenAI, Anthropic, OpenRouter), live data, voice |
| Cloud expansion | Apr – May 2026 | Additional providers and multimodal capability | Groq, DeepSeek, Google AI Studio added (replacing Cerebras); n8n, RAG, agentic loops, image generation, quiz mode |
| Polish and evaluation | May – Jun 2026 | Quality, testing, deployment | Themes, 32-issue codebase sweep, test expansion, installer build, documentation refresh |

### 6.3 Methodology Effectiveness

**Strengths:**

- **Rapid adaptation**: When hardware constraints surfaced (users with 4 GB VRAM), the methodology allowed a quick pivot to implement hardware profile auto-detection and smaller model defaults without disrupting other work.
- **Continuous testability**: Every iteration produced a runnable application, making it straightforward to demonstrate progress and catch issues early.
- **Scope flexibility**: Stretch goals (quiz mode, image generation, n8n one-click deployment, agentic tool loops) were added organically as the core stabilised ahead of schedule.

**Challenges:**

- **Documentation lag**: The iterative pace sometimes outran documentation updates, requiring periodic "doc sweeps" to bring files up to date. This was addressed by including documentation as a deliverable in the final phase.
- **Test maintenance overhead**: As the tool handler count grew to 85+, maintaining test coverage required deliberate effort. This was resolved by establishing a discipline: every new feature ships with tests.

### 6.4 Tools and Technologies

| Technology | Version | Purpose |
|---|---|---|
| Electron | 28.3.3 | Desktop application framework |
| React | 18.3.1 | User interface library |
| TypeScript | 5.9.3 | Type-safe development language |
| Ollama | Latest | Local LLM inference runtime |
| n8n | Latest | Workflow automation (via Docker) |
| Jest | 29.7.0 | Unit and integration testing |
| Playwright | 1.57.0 | End-to-end browser testing |
| electron-vite | 5.0.0 | Build toolchain |
| electron-builder | 24.13.3 | Installer packaging |
| Vite | 7.3.1 | Frontend build tool |

### 6.5 AI-Assisted Development Workflow

Visual Studio Code was used as the primary development environment throughout the project. Early implementation was supported by GitHub Copilot inside VS Code, particularly for boilerplate generation, TypeScript refactoring, React component scaffolding, and unit-test creation. As the project expanded from a basic Electron assistant into a large multi-process application with 63,081 lines of TypeScript across 244 source files, the AI development workflow evolved.

The project used four AI coding assistants across different phases: GitHub Copilot, OpenAI Codex, Google Code Assist, and Claude Code. GitHub Copilot was effective in the early and middle stages because it provided fast inline suggestions for localised coding tasks. However, once the codebase reached significant scale — 117 IPC channels, 85+ tool handlers, 122 test suites — context retention across files became a critical requirement.

Later development shifted toward Claude Code (Opus 4.5 and Sonnet 4), which handled larger repository context more reliably, maintained awareness across multiple files, and was more effective for system-wide refactoring, test repair, architecture review, and consistency checks. Codex and Google Code Assist were trialled for specific tasks, but Claude Code became the primary late-stage assistant because it was better suited to the scale and interconnected architecture of HomeBot.

AI tools were used as development accelerators rather than replacements for engineering judgement. All generated or suggested code was reviewed, integrated manually, and validated through TypeScript compilation, Jest tests, Playwright end-to-end tests, manual UI testing, and Git history. Final responsibility for architecture, security decisions, debugging, feature selection, and quality assurance remained with the developer.

### 6.6 Structured AI Handoff Methodology

A significant methodological outcome of the project was the creation of an AI-portable development workflow. AI coding assistants are stateless by default: a new assistant session does not understand the repository history, current priorities, unresolved bugs, or architectural constraints. To address this, the project used structured handoff artifacts that treated each AI assistant like a new developer joining mid-sprint.

The handoff pattern was based on real-world engineering practices such as runbooks, sprint boards, on-call handoff notes, and incident postmortems. Instead of relying on conversational memory, the project externalised state into repository files that any coding assistant could parse mechanically.

| Date | Event | AI Tool | Artifact |
|---|---|---|---|
| 2025-11-17 | Project created; initial phases 1–6 | GitHub Copilot | Git commits |
| 2025-11 to 2026-03 | Core feature development, tests, CI | GitHub Copilot | Code, tests, CI workflows |
| 2026-03-06 | v0.9.1 audit documented | GitHub Copilot | `AUDIT_SUMMARY.md`, `COPILOT_CONTEXT.md` |
| 2026-05-01 | Copilot → Codex/Claude handoff | Claude Code | `COPILOT_HANDOFF.md` (289 lines) |
| 2026-05-01 to 2026-06-05 | TS error elimination, UI redesign, features | Claude Code | 20+ commits |
| 2026-06-05 | Codex environment fix and handoff update | Codex → Claude Code | `CLAUDE_CODE_NEXT_STEPS.md`; ledger update |
| 2026-06-05 to 2026-06-12 | Gemini provider, model stack, streaming | Claude Code | 8 commits |
| 2026-06-12 | Handoff docs retired — all issues resolved | Claude Code | 20 stale docs deleted |
| 2026-06-12 to 2026-06-19 | Features, rebrand, testing, capstone | Claude Code | 30+ commits |

The five handoff artifacts served different lifecycle purposes:

| Artifact | Purpose | Lifecycle |
|---|---|---|
| `COPILOT_CONTEXT.md` | Stable facts: repository structure, design constraints, conventions | Durable: retained while facts remained true |
| `COPILOT_HANDOFF.md` | Current work state: issues, priorities, file references, active risks | Ephemeral: updated during transition, removed when resolved |
| `CLAUDE_CODE_NEXT_STEPS.md` | One-time transition notes for Claude Code after Codex work | Self-retiring: deleted when no longer required |
| Agent board / ledger | Ownership protocol preventing multiple assistants from editing the same files | Updated during active multi-agent phases |
| Automated tests + TypeScript build | Backstop for validating AI-assisted changes | Permanent quality gate |

### 6.7 Why the Handoff Method Worked

- **Structured over conversational**: Handoff documents used tables, prioritised lists, file paths, line references, and fix instructions rather than prose chat logs. This made them easier for any AI tool to parse mechanically.
- **Durable and ephemeral state were separated**: `COPILOT_CONTEXT.md` held stable project facts, `COPILOT_HANDOFF.md` recorded current work state, and `CLAUDE_CODE_NEXT_STEPS.md` captured one-time transition notes.
- **Items were actionable**: Each issue was documented with a file path, line number, root cause, and fix instruction so the next assistant could begin work without reconstructing the entire project history.
- **Ownership was explicit**: The agent board prevented multiple AI assistants from editing the same files simultaneously, reducing merge conflicts and duplicated work.
- **The process was self-retiring**: After all issues were resolved and the project stabilised, stale handoff documents were deleted rather than allowed to accumulate as misleading documentation.
- **Code was the final backstop**: Even if handoff information became outdated, `tsc --noEmit`, Jest, and Playwright surfaced real regressions immediately.

This method became one of the project's practical contributions: a repeatable pattern for making a large software project portable across stateless AI coding assistants. The pattern mirrors professional engineering handover practices while adapting them to AI agents that require explicit external context.

---

## 7. System Architecture

### 7.1 Process Model

SADIE follows Electron's multi-process architecture. The renderer process is responsible for the user interface, while the main process owns system access, tool execution, memory, routing, and model communication. A preload script forms the only bridge between these processes, exposing a constrained and validated IPC API.

```
┌──────────────────────────────────────────────────────┐
│                  Electron 28 Shell                    │
│                                                      │
│   React 18 UI  <-->  IPC Bridge  <-->  Main Process  │
│   (Themes, Glass UI, Animations)                     │
├──────────────────────────────────────────────────────┤
│   Message Router       |   85+ Tool Handlers         │
│   (intent detection,   |   (TypeScript, local exec)  │
│    agentic loop,       |                             │
│    tool recursion      |   Web - File - System       │
│    cap, context        |   Vision - RAG - Plan       │
│    budget)             |   Memory - Browser          │
│                        |   API - Sports - Docs       │
│   Morning Briefing     |   Archive - Image Gen       │
│   (weather+cal+rem)    |   Voice - Scheduler         │
├────────────────────────┼─────────────────────────────┤
│   Code Cloud API       |   Embedded Web Services     │
│   (OpenAI/Anthropic    |   (ChatGPT / Claude /       │
│    /OpenRouter/Groq    |    Gemini in sandboxed       │
│    /DeepSeek/Google)   |    BrowserWindows)           │
└────────────┬───────────┴─────────────────────────────┘
             | HTTP (localhost)
┌────────────v─────────────────────────────────────────┐
│                  Ollama (local)                       │
│   qwen2.5:7b - dolphin-mistral:7b - moondream       │
│   gemma4:e4b - nomic-embed-text                      │
│   127.0.0.1:11434                                    │
└──────────────────────────────────────────────────────┘
```

### 7.2 Layer Responsibilities

| Layer | Role | Key Controls |
|---|---|---|
| Renderer Process (React 18) | Chat UI, settings, analytics, conversation sidebar, quiz panel, image generator, automation center, error boundaries | No direct Node.js access; renderer remains isolated from filesystem and terminal APIs |
| Preload Script (IPC Bridge) | Typed bridge between renderer and main process; 117 whitelisted IPC channels | Channel allowlist, schema validation, context isolation |
| Main Process (Node.js) | Message routing, tool execution, safety pipeline, memory, model calls, n8n integration | Permission checks, safety validation, audit logging, dual recursion caps: MAX_TOOL_ROUNDS = 10 (single-tool), MAX_AGENTIC_ROUNDS = 6 (multi-step) |
| Local/External Services | Ollama, optional cloud LLMs, n8n, ESPN API, web search engines, image generation backends | Local-first defaults; optional network tools are controlled and validated |

### 7.3 Message Routing Pipeline

The message router (`message-router.ts`, 800+ lines) is the central orchestrator of SADIE. It receives user messages from the renderer via the preload bridge and routes them through a multi-stage pipeline:

1. **Document preprocessing**: If the message includes attached documents, their content is extracted and injected into the prompt context.
2. **Morning briefing check**: On the first message each calendar day, a proactive weather/calendar/reminder summary is generated.
3. **Intent classification**: Regex-based heuristics classify the message as a tool request, conversational query, coding question, opinion, or multi-step task.
4. **RAG injection**: If relevant documents have been indexed, the top-ranked chunks are injected into the system prompt as context.
5. **Route selection**:
   - **Deterministic tools**: Messages matching specific patterns (e.g., "what time is it", "list files in...") are routed directly to tool handlers.
   - **Agentic loop**: Multi-step requests detected by `looksMultiStep()` enter the agentic loop engine for autonomous tool chaining.
   - **Cloud routing**: If a cloud provider is configured and enabled, qualifying messages are routed to the cloud API.
   - **Local LLM**: All other messages are streamed to Ollama for local inference.
6. **Tool execution**: Tool requests are validated against schemas and permission rules before execution. Results return to the LLM for synthesis.
7. **Streaming delivery**: Responses are sent token-by-token back to the renderer for immediate feedback.

### 7.4 Data Flow Diagram

```
User Input (Renderer)
       │
       ▼
  IPC Bridge (Preload)
       │
       ▼
  Message Router (Main Process)
       │
       ├──► Intent Classification
       │         │
       │         ├──► Tool Route ──► Permission Check ──► Tool Handler ──► Result
       │         │                                                           │
       │         │                                          ┌────────────────┘
       │         │                                          ▼
       │         │                                    LLM Synthesis
       │         │                                          │
       │         ├──► Agentic Loop ──► Multi-step tool chain (max 6 rounds)
       │         │                                          │
       │         ├──► Cloud API ──► OpenAI/Anthropic/etc. ──┤
       │         │                                          │
       │         └──► Local LLM ──► Ollama HTTP API ────────┤
       │                                                    │
       ▼                                                    ▼
  Streaming Response ◄──────────────────────────── Token Stream
       │
       ▼
  Chat UI (Renderer)
```

---

## 8. Implementation

### 8.1 Tool System

The tool system is the core differentiator of SADIE. Each tool handler is registered with metadata describing its purpose, category, parameters, and permission requirements. This enables the router and LLM to call tools through a consistent contract while giving the safety pipeline a stable structure to validate.

The tool registry (`tools/index.ts`) imports handlers from 27 specialised modules:

| Module | Category | Capabilities | Handler Count |
|---|---|---|---|
| `filesystem.ts` | Filesystem | read, write, edit, list, move, delete, search, create Word/Excel/PDF documents | 12 |
| `web.ts` | Web & Data | Multi-engine web search (Tavily, Serper, DuckDuckGo, Google, Brave), URL fetching, weather, image search, image generation (5 backends) | 8 |
| `system.ts` | System | Disk usage, memory info, running processes, network adapters, open URL, app launch | 6 |
| `memory.ts` | AI & Memory | Remember facts, recall facts, list memories, clear memory | 4 |
| `rag.ts` | AI & Memory | Index documents, search indexed documents, clear index, list indexed files | 4 |
| `planning.ts` | AI & Memory | Create plan, update plan, list plans, execute plan step | 4 |
| `vision.ts` | Vision & Media | Describe image, query image (via Ollama moondream) | 2 |
| `voice.ts` | Vision & Media | Speech-to-text (Windows SAPI), text-to-speech | 2 |
| `terminal.ts` | Developer | Execute terminal commands with timeout and output capture | 1 |
| `code-runner.ts` | Developer | Execute code snippets in sandboxed environment | 3 |
| `git.ts` | Developer | Git status, log, diff, commit, branch operations | 5 |
| `diff.ts` | Developer | File comparison and diff generation | 2 |
| `codebase.ts` | Developer | Project tree analysis, grep/search across codebases | 3 |
| `nba.ts` | Web & Data | Live scores, standings, player stats, schedule via ESPN | 1 |
| `news.ts` | Web & Data | News search and article fetching | 1 |
| `calendar.ts` | System | Google Calendar (ICS), Outlook COM, local JSON events | 2 |
| `reminder.ts` | System | Create, list, delete persistent reminders | 3 |
| `contacts.ts` | System | Search Windows contacts (with PowerShell injection guard) | 1 |
| `clipboard.ts` | System | Read/write system clipboard | 2 |
| `browser.ts` | System | Open URLs, web search, fetch page content with SSRF protection and HTML-to-text extraction | 3 |
| `email.ts` | System | Email drafting and sending | 1 |
| `notification.ts` | System | Windows toast notifications (with XML sanitisation) | 2 |
| `process-manager.ts` | System | List processes, kill process (with PID injection guard) | 2 |
| `search.ts` | Filesystem | File search across directories | 2 |
| `documents.ts` | Filesystem | Document parsing (PDF, Word, CSV, Markdown, code) | 2 |
| `api-tool.ts` | Web & Data | External HTTPS requests restricted to allowlisted hosts | 1 |
| `enrichment.ts` | AI & Memory | Context enrichment for NBA, weather, and generic queries | 3 |

**Tool calling contract**: Each tool is registered as a `RegisteredTool` with:

```typescript
interface RegisteredTool {
  definition: ToolDefinition;  // name, description, parameters (JSON Schema)
  handler: ToolHandler;        // async (args, context) => ToolResult
  category: string;            // filesystem | web | system | memory | developer | vision
  requiresPermission: boolean; // whether user confirmation is needed
}
```

The LLM receives tool definitions in Ollama's function-calling format. When the LLM emits a `tool_call`, the message router extracts the tool name and arguments, validates them against the registered schema, checks permissions, and dispatches to the handler. The handler returns a structured `ToolResult`:

```typescript
interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
  data?: any;
}
```

### 8.2 Agentic Loop Engine

The agentic loop (`agentic-loop.ts`) enables SADIE to handle multi-step requests autonomously. Rather than requiring the user to issue separate commands, the LLM plans and executes a sequence of tool calls:

**Detection heuristic** (`looksMultiStep()`):
- Explicit sequencing words: "then", "after that", "and also", "next", "finally"
- "First ... then ..." pattern
- Comma-separated action lists: "search X, save it, and email me"
- Two or more distinct tool-like verbs in the same message
- Minimum message length of 30 characters to avoid false positives

**Execution flow**:
1. An agentic system prompt is injected instructing the LLM to plan and execute tools step-by-step.
2. The LLM generates a plan and emits tool calls.
3. Each tool call is executed with full permission checking.
4. Results are fed back to the LLM as context for the next step.
5. The UI shows streaming progress indicators ("Step 1/3: Searching the web...").
6. The loop terminates when the LLM produces a final response without tool calls, or after `MAX_AGENTIC_ROUNDS = 6` iterations (safety cap).

### 8.3 Local AI and Model Selection

SADIE uses Ollama for local model execution with automatic hardware profile detection:

| VRAM Tier | Chat Model | Uncensored Model | Vision Model |
|---|---|---|---|
| 4 GB (low) | phi4-mini (2.5 GB) | dolphin-phi:2.7b (1.6 GB) | moondream (1.7 GB) |
| 8 GB (medium) | qwen2.5:7b (4.7 GB) | dolphin-mistral:7b (4.1 GB) | moondream (1.7 GB) |
| 16 GB+ (high) | qwen2.5:7b (4.7 GB) | dolphin-mistral:7b (4.1 GB) | moondream (1.7 GB) |

On first launch, SADIE detects the user's GPU VRAM via `nvidia-smi` and applies the appropriate profile automatically. The default uncensored model is `dolphin-mistral:7b` — a Mistral 7B fine-tune by Cognitive Computations with alignment removal, selected because it provides genuinely uncensored responses for users who need unrestricted model output.

### 8.4 Cloud LLM Integration

SADIE supports six cloud providers as optional alternatives to local inference. The initial cloud integration (March 2026) included Cerebras, OpenAI, Anthropic, and OpenRouter. Cerebras was later replaced by Groq, DeepSeek, and Google AI Studio during the cloud expansion phase (April–May 2026) to provide broader model access and free-tier options:

| Provider | Models | Cost Tier |
|---|---|---|
| OpenAI | GPT-4o, GPT-4-turbo, GPT-3.5-turbo | Paid |
| Anthropic | Claude 3.5 Sonnet, Claude 3 Opus/Haiku | Paid |
| OpenRouter | Access to 100+ models from multiple providers | Variable |
| Groq | LLaMA, Mixtral (fast inference) | Free tier |
| DeepSeek | DeepSeek Chat, DeepSeek Coder | Low cost |
| Google AI Studio | Gemini 2.5 Flash, Gemini Pro | Free tier |

The `custom-llm-client.ts` module provides a unified streaming interface across all providers, with automatic provider detection from model names, tool-calling support (where available), and retry logic.

### 8.5 Memory and RAG

The memory subsystem operates at three levels:

1. **Conversation context**: Recent messages are maintained in memory for multi-turn dialogue. A rolling digest caps context at 4,000 characters to prevent context window overflow.
2. **Long-term memory**: User-approved facts are stored in `memory/json-store/` as persistent JSON files that survive app restarts.
3. **RAG (Retrieval-Augmented Generation)**: Documents are indexed into overlapping text chunks with both TF-IDF term frequency scores and 768-dimensional semantic embeddings from Ollama's `nomic-embed-text` model.

**Hybrid retrieval** uses Reciprocal Rank Fusion (RRF) with k=60 to combine TF-IDF keyword rankings and semantic embedding cosine similarity. This dual approach outperforms either method alone, particularly for technical documents where exact terminology matters alongside semantic meaning.

Supported document types: `.txt`, `.md`, `.json`, `.csv`, `.log`, `.xml`, `.pdf` (via pdf-parse), `.docx` (via mammoth), and all common code file extensions.

**Document Viewer integration**: The Document Viewer (`DocumentViewer.tsx`) provides two direct actions for any opened document:

- **Add to RAG**: Indexes the document into the hybrid RAG store via the `ragIndex` IPC bridge. The UI tracks indexing state (`idle` → `indexing` → `done`/`error`) and reports the number of chunks indexed.
- **Send to Chat**: Converts the document content into a `DocumentAttachment` (base64-encoded) and injects it into the chat mode with a review prompt, reusing the same attachment contract as the `InputBox` file upload. This enables users to seamlessly transition from browsing documents to discussing their content with the AI.

### 8.6 Web Browser Mode

The Web Services panel (`WebServicesPanel.tsx`) provides two capabilities:

**URL Browser**: Users can paste any URL, fetch its content via the `fetch_page_content` tool handler, and then either summarise it in chat or add it to the RAG index for semantic search. The fetch pipeline includes:

- **URL normalisation**: Bare domains (e.g., `example.com`) are auto-prepended with `https://`.
- **SSRF protection**: Requests to `localhost`, `127.0.0.1`, private IP ranges (`10.x`, `172.16–31.x`, `192.168.x`), and `file://` protocol are blocked before any HTTP request is made.
- **HTML-to-text extraction**: The `htmlToText()` utility strips `<script>` and `<style>` blocks, decodes HTML entities, collapses whitespace, and adds newlines for block elements.
- **Redirect depth limit**: HTTP redirects are followed up to 3 hops to prevent redirect loops.
- **Content preview**: The first 1,500 characters of extracted text are shown with a character count.
- **Summarize in Chat**: Converts the fetched content into a `DocumentAttachment` (base64-encoded), switches to chat mode, and sends it to the AI with a summarisation prompt — reusing the same attachment contract as the Document Viewer.
- **Add to RAG**: Indexes the web content into the hybrid RAG store for later semantic retrieval.

**Service Launchers**: ChatGPT, Claude, and Gemini open in dedicated Electron `BrowserWindow` instances with persisted sessions (cookies survive restarts), allowing users to access their existing subscriptions without API keys.

The web browser feature adds a new IPC channel (`homebot:fetch-page-content`) to the preload bridge, bringing the total to 117 whitelisted channels.

### 8.7 Automation and n8n

n8n is integrated as an optional local workflow automation engine. The Automation Center provides:

- **Create automations**: Name, description, instructions, trigger type (manual/schedule), and optional n8n deployment.
- **One-click n8n deployment**: Generates a webhook-triggered n8n workflow, imports it via `docker exec` into the n8n container, activates it in n8n's SQLite database, and restarts the container — all without requiring the user to touch the n8n UI.
- **Run automations**: Manual execution via the Automation Center or scheduled triggers.
- **Status tracking**: `lastRun`, `lastResult`, and `lastStatus` fields with visual indicators (Completed/Failed).
- **Credential management**: Direct links to the n8n credential manager for API key configuration.
- **Webhook authentication**: All HomeBot-to-n8n communication is authenticated with a 256-bit shared secret (`X-HOMEBOT-Auth` header) generated per installation via `crypto.randomBytes()`.

### 8.8 Image Generation

SADIE supports text-to-image generation across five backends with automatic detection:

| Backend | Type | Detection Method |
|---|---|---|
| Stable Diffusion WebUI | Local | HTTP probe to `localhost:7860` |
| ComfyUI | Local | HTTP probe to `localhost:8188` |
| DALL-E 3 | Cloud (OpenAI) | OpenAI API key present in settings |
| Pollinations.ai | Cloud (Free) | Always available as fallback |
| Stable Horde | Cloud (Free) | Stable Horde API key present |

The image generation panel auto-detects which backends are available and uses the first responding backend. Users can override the selection in settings.

### 8.9 Quiz Mode

The quiz mode provides interactive coding quizzes with:

- 12 topics: Python, JavaScript, TypeScript, React, Node.js, HTML/CSS, SQL, Git, Data Structures, Algorithms, System Design, General CS
- 3 difficulty levels: Beginner, Intermediate, Advanced
- AI-generated questions via Ollama
- Persistent progress tracking and letter grades
- Score calculation with double-counting bug fix (discovered and resolved during testing)

### 8.10 Morning Briefing

On the first user interaction each calendar day, SADIE proactively generates a personalised summary:

1. **Weather**: Current conditions and forecast via the weather tool
2. **Calendar**: Upcoming events from Google Calendar (ICS), Outlook, or local store
3. **Reminders**: Pending reminders from the scheduler

Tool calls run in parallel via `Promise.allSettled` — if any tool fails, that section is silently omitted rather than blocking the entire briefing. The briefing state is persisted to `memory/json-store/briefing-state.json` to survive app restarts.

### 8.11 Mixture of Agents (MoA)

For users with 16 GB+ VRAM, SADIE supports a Mixture of Agents mode where multiple local models generate independent responses in parallel:

- **Proposer models** (e.g., qwen2.5:7b, qwen2.5-coder:7b) generate responses with specialised roles (analyst, devil's advocate, implementer)
- **Aggregator model** (e.g., gemma4:e4b) synthesises the proposals into a single high-quality response
- Simple queries (greetings, single-word answers) bypass MoA for speed

### 8.12 User Interface

The UI is built with React 18 and comprises 31 components:

| Component | Purpose |
|---|---|
| `App.tsx` | Root application shell, mode switching, keyboard shortcuts |
| `ChatInterface.tsx` | Main chat view with streaming messages |
| `MessageBubble.tsx` | Individual message rendering with markdown, code highlighting, reactions, TTS |
| `InputBox.tsx` | Message input with voice support, file attachment, auto-send |
| `ConversationSidebar.tsx` | Conversation history with search, pinning, archiving, tags |
| `SettingsPanel.tsx` | Application settings (1,992 lines — the largest component) |
| `AutomationCenter.tsx` | Automation management, n8n deployment, status tracking |
| `QuizPanel.tsx` | Interactive quiz interface |
| `ImageGenerator.tsx` | Image generation with backend selection |
| `DocumentViewer.tsx` | Document viewer with Add to RAG indexing and Send to Chat attachment |
| `WebServicesPanel.tsx` | Web Browser (URL fetch, summarize, RAG) and AI service launchers (ChatGPT, Claude, Gemini) |
| `FirstRunModal.tsx` | Setup wizard (GPU detection, Ollama install, model pull) |
| `ModelSelector.tsx` | Model picker with portal-based dropdown |
| `StatusIndicator.tsx` | Ollama/n8n connection status dot |

**Themes**: Light, dark, and system-auto themes with CSS custom properties, glass-morphism accents, neon glows, and 15+ CSS keyframe animations. The light theme includes a gold-to-blue accent palette.

**Global hotkey**: `Ctrl+Shift+Space` toggles the HomeBot window from any application.

**One-click installer**: The `HomeBot Setup 1.1.0.exe` installer (152 MB) uses NSIS with `oneClick: true`, installs to the user's profile without admin rights, creates desktop and start menu shortcuts, and auto-launches HomeBot after installation. The first-run wizard then handles Ollama detection, GPU profiling, and model downloads.

---

## 9. Safety and Security Model

SADIE requires a defence-in-depth model because it exposes real system capabilities to an LLM agent. The security architecture combines 11 distinct layers:

### 9.1 Security Layers

| Layer | Purpose | Implementation |
|---|---|---|
| 1. IPC Channel Allowlist | Restricts renderer-to-main communication | `ALLOWED_CHANNELS` whitelist in `preload/index.ts`; 117 explicitly named channels |
| 2. Context Isolation | Prevents renderer code from accessing Node.js APIs | Electron `contextIsolation: true`, `nodeIntegration: false` |
| 3. SSRF Protection | Blocks requests to loopback, private IPs, and DNS rebinding | DNS resolution check before HTTP requests in `web.ts` |
| 4. Webhook Authentication | Protects n8n webhook communication | 256-bit shared secret via `crypto.randomBytes()`; `X-HOMEBOT-Auth` header |
| 5. Tool Recursion Cap | Prevents infinite tool-call loops | `MAX_TOOL_ROUNDS = 10` for single-tool recursion in message router; `MAX_AGENTIC_ROUNDS = 6` for multi-step agentic chains |
| 6. Permission Gating | Requires explicit user consent for sensitive operations | Allow Once / Always Allow / Cancel modal for destructive tools |
| 7. PowerShell Injection Guard | Prevents shell metacharacter injection in contact queries | Strips `$();\|` `` ` `` `&{}` characters; 128-char truncation |
| 8. PID Injection Guard | Prevents process kill with arbitrary PIDs | Positive integer validation before `Stop-Process` |
| 9. Toast XML Sanitisation | Prevents injection in Windows notifications | Entity-encoding of all user-supplied text in toast XML |
| 10. File Size Guards | Prevents memory exhaustion from large files | 50 MB cap on document parsing, 20 MB on vision input |
| 11. Redirect Depth Limit | Prevents HTTP redirect loops | Redirect chain capped at 3 hops (browser tool) and 5 hops (web search tool) |

### 9.2 Additional Controls

- **Git message sanitisation**: Character whitelist prevents shell metacharacter injection in git commit messages.
- **API hostname allowlist**: `config/api-allowlist.json` restricts which external hosts the `api_request` tool can contact.
- **Path traversal prevention**: All file operations validate paths against the user's home directory.
- **Conversation digest cap**: Rolling conversation digest capped at 4,000 characters to prevent context overflow.
- **Credential encryption**: API keys are encrypted at rest using Electron's `safeStorage` (DPAPI on Windows).
- **Environment gating**: Test code, debug logs, and dev features are compile-time gated via `isE2E` and `isPackagedBuild` flags.

### 9.3 Addressing Research Question RQ2

The security architecture demonstrates that system tools can be safely exposed to an LLM agent through:

1. **Defence in depth**: No single layer is relied upon. Each addresses a different attack vector.
2. **Explicit permission**: Destructive operations require user confirmation before execution.
3. **Input sanitisation**: All user-supplied data is sanitised before interpolation into system commands.
4. **Bounded execution**: Recursion caps and timeout limits prevent runaway tool chains.
5. **Minimal privilege**: The renderer process has no direct access to Node.js APIs; all system interaction goes through the validated preload bridge.

---

## 10. Testing and Quality Assurance

### 10.1 Test Suite Overview

Testing was used as both a quality gate and an architectural safety net. Jest validates units and integration boundaries, while Playwright verifies real user journeys through the Electron interface.

| Metric | Result |
|---|---|
| Unit tests | 1,932 |
| Test suites | 122 |
| Statement coverage | 56.67% |
| Branch coverage | 44.65% |
| Function coverage | 54.79% |
| Line coverage | 59.76% |
| End-to-end coverage | Playwright tests for core UI journeys |
| Build discipline | No phase closes with known test failures |

### 10.2 Test Categories

**Streaming tests**: Verify that generated tokens are delivered in order and can be cancelled or retried. Cover both local Ollama streaming and cloud provider streaming paths.

**Tool tests**: Validate routing, permissions, schema handling, and error behaviour for each tool handler. Example: the `sweep-fixes.test.ts` suite (16 tests) covers PowerShell injection guard stripping, vision file size limits, openUrl rejection detection, and conversation digest capping.

**Security tests**: Check blocked actions, unsafe paths, and permission-gated workflows. Verify that SSRF protection blocks private IPs, that the recursion cap prevents infinite loops, and that injection guards strip dangerous characters.

**UI tests**: Cover first launch, conversation persistence, mode switching, interaction states, automation center status indicators, edit functionality, and n8n credential buttons. The `automation-center.test.tsx` suite (28 tests) validates the complete automation lifecycle.

**Configuration tests**: Validate hardware profile detection, model defaults, settings persistence, and credential encryption/decryption.

**Integration tests**: Test the interaction between components — message routing through tool execution, RAG indexing through retrieval, and n8n workflow deployment.

### 10.3 Test Growth Over Time

| Phase | Suites | Tests |
|---|---|---|
| Foundation (Dec 2025) | ~20 | ~200 |
| Tool system (Feb 2026) | ~60 | ~800 |
| Advanced features (Apr 2026) | 112 | 1,604 |
| Agentic + cloud (Apr 2026) | 115 | 1,716 |
| Midpoint review (May 2026) | 119 | 1,860 |
| Codebase sweep (Jun 2026) | 120 | 1,883 |
| Sweep tests + automation (Jun 2026) | 121 | 1,907 |
| Final — web browser + coverage (Jun 2026) | 122 | 1,932 |

### 10.4 Notable Bugs Found by Tests

| Bug | How Discovered | Impact |
|---|---|---|
| Quiz score double-counting | Unit test assertion mismatch | Scores inflated by up to 2x |
| Promise.allSettled masking failures in openUrl | Integration test for URL handler | Users told URL opened when it failed |
| Stale closure in Ctrl+N handler | React ref pattern test | New conversation created in wrong state |
| IPv6 resolution failure for Ollama | Streaming test against 127.0.0.1 vs localhost | False "Ollama offline" errors |
| Document content triggering false tool intents | Routing test with document-attached message | LLM invoking weather tool from document text |

---

## 11. Results and Evaluation

### 11.1 Objective Achievement

| Objective | Status | Evidence |
|---|---|---|
| Offline local AI chat | Delivered | Ollama-based chat works without internet; qwen2.5:7b handles conversational, coding, and reasoning tasks |
| 85+ tool handlers | Delivered | 85+ handlers across 27 modules; exceeds original 15+ target by 5.7x |
| Permission-gated execution | Delivered | Sensitive operations require Allow Once, Always Allow, or Cancel; 11-layer security model |
| Desktop integration | Delivered | System tray, global hotkey, toast notifications, auto-update support, one-click installer |
| Memory and RAG | Delivered | Short-term context, long-term local memory, hybrid TF-IDF + semantic RAG with RRF, Document Viewer and Web Browser with Add to RAG and Send to Chat |
| Automation | Delivered | n8n workflow support with one-click deployment, webhook auth, status tracking, credential management |
| Vision and voice | Delivered | Local vision via moondream, STT via Windows SAPI, TTS via msedge-tts |
| Image generation | Delivered | 5 backends (SD WebUI, ComfyUI, DALL-E 3, Pollinations, Stable Horde) with auto-detection |
| Quiz mode | Delivered | 12 topics, 3 difficulty levels, persistent scoring, letter grades |
| Morning briefing | Delivered | Proactive daily summary of weather, calendar, and reminders |
| Agentic tool loops | Delivered | Multi-step request detection and autonomous tool chaining (max 6 rounds) |
| Cloud LLM routing | Delivered | 6 providers (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Google AI Studio) |
| Testing | Delivered | 1,932 tests, 122 suites, Playwright E2E, 59.76% line coverage |
| One-click installer | Delivered | HomeBot Setup 1.1.0.exe (152 MB), NSIS one-click, no admin required |

### 11.2 Research Question Evaluation

**RQ1: Can local LLMs provide task-appropriate responses without cloud connectivity?**

Yes. The qwen2.5:7b model provides capable responses for conversational chat, coding assistance, document summarisation, and tool-calling tasks. When paired with SADIE's deterministic tool routing — which handles structured requests like file operations, web search, and system queries without LLM involvement — the system provides practical daily-use capability entirely offline. The quality gap with frontier cloud models (GPT-4o, Claude 3.5 Sonnet) is noticeable on complex reasoning tasks but acceptable for the majority of desktop assistant use cases.

**RQ2: What security architecture safely exposes system tools to an LLM agent?**

An 11-layer defence-in-depth model combining IPC hardening, context isolation, input sanitisation, permission gating, recursion limits, and file size guards. The key insight is that no single security measure is sufficient — each layer addresses a different attack vector. The permission modal for destructive operations provides the most visible safety guarantee to end users.

**RQ3: How can agentic tool loops be made reliable and predictable?**

Through bounded execution (MAX_AGENTIC_ROUNDS = 6), schema validation of tool arguments, permission checks at each step, and streaming progress indicators that make the agent's actions transparent. The lightweight detection heuristic (`looksMultiStep()`) avoids unnecessary agentic routing for simple requests, reducing the blast radius of potential errors.

**RQ4: Is offline-first AI viable as a privacy-preserving desktop solution on consumer hardware?**

Yes, with caveats. Hardware with 8 GB+ RAM and a GPU with 4 GB+ VRAM provides a responsive experience. CPU-only inference works but is noticeably slower. The automatic hardware profile detection system addresses the variability in consumer hardware by selecting appropriately sized models. The key finding is that privacy and capability are not mutually exclusive — SADIE demonstrates that a fully functional desktop AI assistant can operate with zero cloud dependency.

### 11.3 Project Metrics Summary

| Metric | Value |
|---|---|
| Development period | 17 Nov 2025 – 19 Jun 2026 (7 months) |
| Total commits | 520 |
| Lines of TypeScript | 63,081 |
| Source files (.ts/.tsx) | 244 |
| Tool handler modules | 27 |
| Tool handlers | 85+ |
| React components | 31 |
| Test suites | 122 |
| Automated tests | 1,932 |
| Cloud LLM providers | 6 |
| Image generation backends | 5 |
| Security layers | 11 |
| IPC channels | 117 |
| Current version | v1.1.0 |
| Installer size | 152 MB |
| Target platform | Windows 10/11 |

---

## 12. Discussion

### 12.1 Strengths

- **Privacy by architecture**: Core chat, memory, and local tools do not require cloud transmission. User data stays on the machine unless the user explicitly enables a cloud provider. This is a meaningful differentiator because local control and data sovereignty are central user concerns.
- **Desktop agency**: SADIE can perform real tasks — reading files, running terminal commands, managing processes, generating images, deploying workflows — rather than only describing what the user should do. The 85+ tool handlers provide functionality comparable to cloud-hosted assistants.
- **Security discipline**: The 11-layer security model demonstrates that exposing powerful system tools to an LLM agent is achievable when security is designed in from the start rather than bolted on. The permission gating system provides a clear user-facing safety guarantee.
- **Extensibility**: Optional cloud providers and n8n workflows allow the system to grow without weakening local-first defaults. New tool handlers can be added by implementing the `RegisteredTool` interface.
- **Evidence of implementation**: 1,932 tests, 520 commits, comprehensive documentation, and a working installer support the project's claims with concrete evidence.
- **Scope achievement**: The project significantly exceeded its original scope (15+ tool handlers → 85+; basic chat → agentic loops, image generation, quiz mode, morning briefings) while maintaining quality and test discipline.

### 12.2 Limitations

- **Local model quality**: Local 7B models do not match frontier cloud models (GPT-4o, Claude 3.5 Sonnet) on complex reasoning, nuanced writing, or long-context tasks. This is a hardware constraint rather than an architectural one — larger models can be used on higher-spec hardware.
- **CPU-only inference**: While functional, CPU-only inference is significantly slower than GPU-supported inference, making the experience less responsive for users without discrete GPUs.
- **Windows-only**: The primary target is Windows 10/11. macOS and Linux packaging would require platform-specific tool equivalents (PowerShell → bash for contacts, SAPI → alternative for speech) and separate testing.
- **Formal user testing**: The project was evaluated by the developer and supervisor but not through a structured usability study with external participants. This limits the evidence for UX claims.
- **Code coverage**: At 59.76% line coverage, there are untested paths — particularly in the Settings panel and Voice conversation modules. Coverage decreased from 62.28% at the midpoint review because the final development phases added substantial new code (Web Browser mode, cloud provider expansion, n8n one-click deployment, image generation backends, agentic loop engine) faster than corresponding tests could be written. The absolute test count grew from 1,860 to 1,932, but the denominator (total lines of code) grew proportionally faster. Higher coverage in these areas would increase confidence.

### 12.3 Problems Encountered and Solutions

| Problem | Impact | Solution |
|---|---|---|
| Ollama IPv6 resolution failure | False "offline" errors on Node.js 18+ | Changed all URLs from `localhost` to `127.0.0.1` |
| Weather location regex false match | Regex matched "wh at" inside "What is the weather?" and sent nonsense to API | Added `\b` word boundary before alternation group across all four pattern instances |
| Conversation data corruption | `history.json` became empty/truncated, causing JSON.parse to throw and messages to be silently dropped | Made `addMessageToConversation` self-healing: auto-creates record if missing |
| Command injection via speech `exec()` | OWASP A03 shell injection vulnerability through string interpolation | Replaced `exec()` with `execFile()`, which never invokes a shell and passes arguments as an array |
| Fork bomb risk in terminal tool | No guard on recursive process spawning | Added process count limit and blocked known dangerous shell patterns |
| Model selector hidden in widget mode | CSS `display:none` rule prevented model switching in widget mode | Removed the rule; embedded compact ModelSelector in widget titlebar |
| Document content triggering false tool intents | LLM invoking wrong tools based on document text | Strip document markers before intent regex evaluation |
| PowerShell injection via contact search | Potential command execution | Metacharacter stripping + 128-char truncation |
| Unbounded conversation digest | Context window overflow on long conversations | 4,000-char cap with smart truncation |
| Users couldn't run 7B models on 4 GB VRAM | App unusable on lower-spec hardware | Automatic GPU VRAM detection with hardware profiles |
| n8n workflow import required manual steps | Poor user experience | One-click deployment via Docker CLI + SQLite activation |
| CSS variable conflicts between themes | Visual glitches, unreadable text | Comprehensive CSS audit; 32-issue sweep across 20 files |
| Quiz score double-counting | Inflated scores by up to 2x | Fixed `handleNext` accumulator logic |
| `ELECTRON_RUN_AS_NODE` in VS Code terminals | App launched as plain Node.js process | Dev script clears the environment variable before launching |
| Toast notifications stacking infinitely | UI clutter, performance degradation | Toast deduplication — track and dismiss previous toast |

### 12.4 Approaches That Did Not Work

1. **OAuth for Google Calendar**: Full OAuth 2.0 required a Google Cloud project and complex redirect handling in Electron. Replaced with private ICS feed URLs — same data, zero cloud configuration.
2. **Single model for all VRAM tiers**: A single 7B default failed for users with limited VRAM. Solved by the hardware profile system.
3. **Manual n8n workflow import**: Required users to understand the n8n UI. Replaced with one-click deployment via Docker CLI.
4. **Using `localhost` for Ollama**: Node.js 18+ IPv6 preference caused intermittent failures. Hardcoded `127.0.0.1`.
5. **`exec()` for terminal commands**: String interpolation created a shell injection surface (OWASP A03). Replaced with `execFile()` after OWASP security review — a process change driven by research, not originally planned.
6. **Small (3B) models as default**: Produced verbose, repetitive responses regardless of prompt engineering. Resolved by switching the default to 7B models and adding a length ladder to the system prompt.
7. **LLM-based intent classification as primary path**: Prototyped as an alternative to regex routing — handled edge cases better but added 200–800ms latency per message. Retained only as a fallback for the ~5% of inputs that defeat regex patterns.
8. **Cerebras as cloud provider**: Initially integrated but replaced by Groq, DeepSeek, and Google AI Studio to provide broader model access and free-tier availability.

### 12.5 Reflection on AI-Assisted Development

One of the most important lessons from the project was that AI coding tools are most effective when matched to the scale of the task. Inline assistants such as GitHub Copilot were useful for localised implementation, repetitive TypeScript patterns, and early component development. However, once the project became a large Electron codebase with shared types, IPC contracts, tool registration, security layers, and tests spread across many files, larger-context tools became more valuable.

Claude Code was ultimately the most effective late-stage tool because it could reason across more of the repository and support multi-file refactoring. This was particularly useful during the final codebase sweep, security hardening, test repair, UI polish, HomeBot rebrand, and capstone documentation phase.

The experience showed that AI-assisted development does not remove the need for software engineering discipline. It increases the need for clear architecture, version control, structured handoff documents, automated tests, and careful review because generated suggestions can introduce subtle inconsistencies if applied without validation.

### 12.6 AI-Portability as a Development Practice

The AI handoff method is worth distinguishing from ordinary prompt engineering. Rather than writing one-off prompts, the project created durable repository artifacts that allowed different assistants to inherit the project state. This made the repository more "AI-portable": any assistant could read the stable context, current issue ledger, and next-step list, then continue work in a controlled way.

For a capstone project of this scale, the benefit was continuity. The codebase could move between Copilot, Codex, Google Code Assist, and Claude Code without losing the thread of architectural decisions. For professional practice, the same pattern could support teams that use multiple AI coding tools or need to hand over work between developers and assistants across long-running projects.

---

## 13. Conclusion and Future Work

### 13.1 Conclusion

SADIE demonstrates that a privacy-first offline AI desktop assistant is technically viable on consumer hardware. By combining local LLM inference, a broad tool ecosystem (85+ handlers), hybrid RAG document retrieval, agentic multi-step tool loops, n8n workflow automation, image generation, and a multi-layer security pipeline, the project delivers a practical alternative to cloud-only AI assistants. The system preserves user control while supporting real desktop agency through permission-gated tools.

The project met its core research purpose: to investigate whether offline-first AI can provide useful capability while protecting user data and safely exposing system tools. The implementation demonstrates that this is achievable when the architecture is designed around local execution, explicit permission, and defensive boundaries from the beginning.

All four research questions received affirmative answers supported by implementation evidence:

- **RQ1**: Local LLMs (qwen2.5:7b) provide task-appropriate responses for the majority of desktop assistant use cases.
- **RQ2**: An 11-layer security architecture with permission gating safely exposes system tools.
- **RQ3**: Agentic loops are reliable when bounded by schemas, intent classification, and recursion limits.
- **RQ4**: Offline-first AI is viable on consumer hardware with 8 GB+ RAM and a mid-range GPU.

The project exceeded its original scope significantly — from 15 planned tool handlers to 85+ delivered, with additional features (agentic loops, image generation, quiz mode, morning briefings, Document Viewer with RAG/Chat integration, Web Browser with content extraction and summarisation, one-click installer) that were not in the initial proposal. The 1,932-test suite and 520-commit history provide concrete evidence of disciplined, iterative development.

A secondary contribution was the structured AI handoff methodology, which demonstrated a repeatable pattern for making a large software project portable across stateless AI coding assistants. The handoff artifacts — durable context files, ephemeral work ledgers, ownership protocols, and automated test backstops — enabled the project to transition between GitHub Copilot, Codex, and Claude Code without losing project continuity.

### 13.2 Future Work

- **Cross-platform packaging**: Build and test macOS and Linux installers with platform-appropriate tool equivalents.
- **Formal user study**: Conduct structured usability testing with external participants to evaluate UX, trust, and perceived privacy compared with cloud assistants.
- **MCP integration**: Resolve reliability issues in the Model Context Protocol integration layer to enable a broader tool/plugin ecosystem.
- **Hardware compatibility matrix**: Produce formal benchmarks of response latency, VRAM usage, and tool execution time across different hardware profiles.
- **Advanced RAG**: Implement stronger embedding-based retrieval with better document source attribution and chunk boundary handling.
- **Newer model evaluation**: Evaluate models released after the project's model selection phase for potential quality improvements.

---

## 14. References

AnythingLLM. (2024). AnythingLLM: The all-in-one AI application. https://anythingllm.com

Anthropic. (2023). Claude: An AI assistant by Anthropic. https://www.anthropic.com/claude

Cognitive Computations. (2024). Dolphin: Uncensored models. https://huggingface.co/cognitivecomputations

Cormack, G. V., Clarke, C. L. A., & Buettcher, S. (2009). Reciprocal rank fusion outperforms condorcet and individual rank learning methods. *Proceedings of the 32nd International ACM SIGIR Conference on Research and Development in Information Retrieval*, 758–759.

Electron. (2024). Security, native capabilities, and your responsibility. Electron Documentation. https://www.electronjs.org/docs/latest/tutorial/security

Google. (2024). Gemini: A family of highly capable multimodal models. https://deepmind.google/technologies/gemini

GPT4All. (2023). GPT4All: Run large language models locally. https://gpt4all.io

Jan. (2024). Jan: Open-source ChatGPT alternative that runs offline. https://jan.ai

Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Kuttler, H., Lewis, M., Yih, W., Rocktaschel, T., Riedel, S., & Kiela, D. (2020). Retrieval-augmented generation for knowledge-intensive NLP tasks. *Advances in Neural Information Processing Systems*, 33, 9459–9474.

LM Studio. (2024). LM Studio: Discover, download, and run local LLMs. https://lmstudio.ai

Microsoft. (2023). GitHub Copilot: Your AI pair programmer. https://github.com/features/copilot

n8n. (2024). Workflow automation for technical people. https://n8n.io

Ollama. (2024). Ollama: Get up and running with large language models locally. https://ollama.com

Open Interpreter. (2024). Open Interpreter: Let language models run code. https://openinterpreter.com

Open WebUI. (2024). Open WebUI: User-friendly AI interface. https://openwebui.com

OpenAI. (2022). Introducing ChatGPT. https://openai.com/blog/chatgpt

Qwen Team. (2024). Qwen2.5: A party of foundation models. https://qwenlm.github.io

Schick, T., Dwivedi-Yu, J., Dessi, R., Raileanu, R., Lomeli, M., Zettlemoyer, L., Cancedda, N., & Scialom, T. (2023). Toolformer: Language models can teach themselves to use tools. *Advances in Neural Information Processing Systems*, 36.

Touvron, H., Martin, L., Stone, K., Albert, P., Almahairi, A., Babaei, Y., Bashlykov, N., Batra, S., Bhargava, P., Bhosale, S., et al. (2023). LLaMA 2: Open foundation and fine-tuned chat models. *arXiv preprint arXiv:2307.09288*.

vikhyatk. (2024). Moondream: A tiny vision language model. https://github.com/vikhyatk/moondream

Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K., & Cao, Y. (2023). ReAct: Synergizing reasoning and acting in language models. *International Conference on Learning Representations*.

---

## 15. Appendices

### Appendix A: Project Structure

```
SADIE/
├── widget/                          # Electron + React desktop application
│   ├── src/
│   │   ├── main/                    # Main process (800+ line message router, 85+ tools)
│   │   │   ├── tools/               # 27 tool handler modules
│   │   │   │   ├── filesystem.ts    # File read/write/edit/list/move/delete/search + docx/xlsx/pdf
│   │   │   │   ├── web.ts           # Multi-engine search, URL fetch, weather, image gen
│   │   │   │   ├── system.ts        # Disk, memory, processes, network, open URL
│   │   │   │   ├── memory.ts        # Remember, recall, list, clear
│   │   │   │   ├── rag.ts           # Hybrid TF-IDF + semantic RAG with RRF
│   │   │   │   ├── vision.ts        # Image describe/query via Ollama moondream
│   │   │   │   ├── terminal.ts      # Shell command execution
│   │   │   │   ├── nba.ts           # ESPN sports data integration
│   │   │   │   ├── calendar.ts      # Google ICS, Outlook COM, local events
│   │   │   │   └── ...              # 18 more tool modules
│   │   │   ├── message-router.ts    # Central routing pipeline
│   │   │   ├── agentic-loop.ts      # Multi-step autonomous tool chaining
│   │   │   ├── morning-briefing.ts  # Proactive daily summary
│   │   │   ├── moa.ts              # Mixture of Agents multi-model engine
│   │   │   ├── custom-llm-client.ts # 6 cloud provider unified API
│   │   │   ├── config-manager.ts    # Settings, hardware profiles, credential encryption
│   │   │   ├── webhook-auth.ts      # n8n 256-bit shared secret auth
│   │   │   ├── memory-manager.ts    # Conversation and long-term memory
│   │   │   ├── ipc-handlers.ts      # IPC channel implementations
│   │   │   └── __tests__/           # 70+ main-process test suites
│   │   ├── renderer/                # React 18 UI
│   │   │   ├── components/          # 31 React components
│   │   │   ├── e2e/                 # Playwright E2E test specs
│   │   │   └── __tests__/           # Renderer unit test suites
│   │   ├── preload/                 # Context bridge (117 whitelisted IPC channels)
│   │   └── shared/                  # Types, constants, system prompt, utilities
│   ├── build/                       # Installer resources (icon.ico)
│   ├── dist-electron/               # Built installer output
│   │   └── HomeBot Setup 1.1.0.exe  # One-click installer (152 MB)
│   ├── electron.vite.config.ts      # Build configuration
│   ├── jest.config.ts               # Test configuration
│   └── package.json                 # Dependencies and scripts
├── n8n-workflows/                   # n8n workflow definitions
│   ├── core/                        # Chat orchestrator, safety validator
│   ├── starters/                    # Starter workflow templates
│   └── tools/                       # Image generation workflow
├── config/                          # Runtime configuration (7 JSON files)
├── scripts/                         # Setup, build, utility scripts
├── prompts/                         # System prompts and intent detection
├── schemas/                         # JSON schemas for tool validation
├── docs/                            # Developer documentation
├── memory/                          # Local memory and RAG index storage
├── docker-compose.yml               # n8n container configuration
└── electron-builder.yml             # Installer packaging configuration
```

### Appendix B: Configuration Files

| File | Purpose |
|---|---|
| `config/default-config.json` | Core settings: models, URLs, hotkey, permissions, theme |
| `config/api-allowlist.json` | Approved API hostnames for the `api_request` tool |
| `config/safety-rules.json` | Path and operation whitelists for file and system tools |
| `config/tool-allowlist.json` | Enabled/disabled state for each tool |
| `config/ollama-models.json` | Known Ollama models with metadata |
| `config/n8n-endpoints.json` | n8n webhook and API endpoint configuration |
| `config/mcp-servers.json` | MCP server definitions |

### Appendix C: Key Code Excerpts

**Tool Registration Pattern** (`tools/index.ts`):
```typescript
const toolRegistry = new Map<string, RegisteredTool>();

// Aliases for tool names from different models
const TOOL_ALIASES: Record<string, string> = {
  nba_scores: 'nba_query',
  terminal: 'run_terminal_command',
  shell: 'run_terminal_command',
  grep: 'grep_code',
};
```

**Agentic Loop Detection** (`agentic-loop.ts`):
```typescript
export function looksMultiStep(message: string): boolean {
  const m = message.toLowerCase().trim();
  if (m.length < MIN_AGENTIC_LENGTH) return false;

  const hasSequenceWords = /\b(then|after that|afterwards|and then|
    next|finally|once you|when done|and also)\b/i.test(m);
  const hasFirstThen = /\bfirst\b.{5,}\bthen\b/i.test(m);
  // ... additional heuristics
}
```

**Webhook Authentication** (`webhook-auth.ts`):
```typescript
import { randomBytes } from 'crypto';

// 256-bit shared secret generated per installation
const secret = randomBytes(32).toString('hex');
// Stored alongside user settings; survives app restarts
// n8n validates via X-HOMEBOT-Auth header
```

**PowerShell Injection Guard** (`tools/contacts.ts`):
```typescript
// Strip dangerous metacharacters before interpolating into PowerShell
const sanitised = query
  .replace(/[$();|`&{}]/g, '')  // Remove shell metacharacters
  .slice(0, 128);               // Truncate to prevent overflow
```

**Hybrid RAG with RRF** (`tools/rag.ts`):
```typescript
interface RagChunk {
  text: string;
  tf: Record<string, number>;    // TF-IDF keyword scores
  embedding?: number[];           // 768-dim semantic vector (nomic-embed-text)
}
// Reciprocal Rank Fusion (k=60) combines keyword + semantic rankings
```

**Credential Encryption** (`config-manager.ts`):
```typescript
function encryptSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64');
  }
  return value; // Fallback for environments without DPAPI
}
```

### Appendix D: Test Suite Summary

| Test File | Tests | Coverage Area |
|---|---|---|
| `message-router.test.ts` | 45 | Intent classification, routing, streaming |
| `config-manager.test.ts` | 38 | Settings, hardware profiles, encryption |
| `automation-center.test.tsx` | 28 | Automation CRUD, status, edit, n8n |
| `web-tools.test.ts` | 35 | Search, URL fetch, SSRF protection |
| `filesystem-tools.test.ts` | 42 | File operations, path validation |
| `rag-tools.test.ts` | 18 | Indexing, search, RRF fusion |
| `vision-tools.test.ts` | 12 | Image analysis, file size guards |
| `sweep-fixes.test.ts` | 16 | Injection guards, size limits, redirects |
| `agentic-loop.test.ts` | 13 | Multi-step detection, prompt building |
| `morning-briefing.test.ts` | 4 | Briefing state, generation |
| `nba.test.ts` | 15 | Sports data, timeout handling |
| `quiz-panel.test.tsx` | 22 | Quiz flow, scoring, persistence |
| `browser-tool.test.ts` | 25 | URL open, search, fetch content, SSRF, htmlToText |
| `web-services-panel.test.tsx` | 13 | URL browser UI, fetch, summarize, RAG, service launchers |
| *(108 more suites)* | ... | Various tool, UI, and integration tests |
| **Total** | **1,932** | **122 suites** |
