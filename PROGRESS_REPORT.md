# SADIE — Progress Report

**Student Name:** Aden King
**Student Number:** [Insert Student Number]
**Project:** SADIE — Structured AI Desktop Intelligence Engine
**Date:** 27 April 2026

---

## 1. Introduction

### 1.1 What is the project about and who is it for?

SADIE (Structured AI Desktop Intelligence Engine) is a cross-platform desktop AI assistant built with Electron, TypeScript, and React. It runs local Large Language Models (LLMs) via Ollama, giving users a private, offline-capable AI assistant that can converse naturally, execute system-level tasks through a tool registry, and integrate with live data sources — all without sending data to cloud services.

The target audience is technically literate desktop users who want an AI assistant that:

- Runs entirely on their hardware for privacy
- Can interact with their filesystem, clipboard, terminal, browser, and calendar
- Provides live data enrichment (NBA scores, weather, web search, news)
- Supports multiple local LLM models with in-app switching
- Offers voice interaction via neural text-to-speech

The project distinguishes itself from cloud-based assistants (ChatGPT, Copilot) by prioritising local execution, user control, and tool integration — the AI is not just a chatbot but an agent that can take actions on the user's computer with permission-gated safety controls.

### 1.2 Where you are on the timeline

The project began on **17 November 2025** and is currently **5 months into development** with **362 commits** across the main branch. The project is in the **stabilisation and polish phase** — all core features are implemented and functional, and current work focuses on reliability, response quality, performance optimisation, and UI refinement.

Development velocity has accelerated significantly in recent months:

| Period | Commits | Focus |
|--------|---------|-------|
| Nov 2025 | 60 | Initial scaffolding, Electron setup, n8n integration |
| Dec 2025 | 56 | Core chat, streaming, conversation persistence |
| Jan 2026 | 7 | Reduced activity (planning/research) |
| Feb 2026 | 29 | Tool system, model selector, settings |
| Mar 2026 | 125 | Major feature push — tools, UI overhaul, testing |
| Apr 2026 (partial) | 85 | Stability, performance, bug fixes, polish, avatars, docs |

### 1.3 What is completed and not completed

**Completed Features:**

| Feature | Status | Details |
|---------|--------|---------|
| Electron desktop application | ✅ Complete | Frameless widget + expanded mode, custom titlebar |
| Chat interface with streaming | ✅ Complete | Real-time token streaming, markdown rendering |
| Local LLM integration (Ollama) | ✅ Complete | Multi-model support with in-app switching |
| Cloud LLM fallback | ✅ Complete | Cerebras, OpenAI, Anthropic, OpenRouter support |
| Tool registry (70+ tools) | ✅ Complete | Filesystem, terminal, git, browser, calendar, email, vision, RAG, etc. |
| Permission system | ✅ Complete | Per-tool granular permissions with user confirmation |
| Conversation persistence | ✅ Complete | JSONL storage with search, pin, archive, tags, export |
| Voice output (TTS) | ✅ Complete | Edge neural voices with Web Speech fallback |
| NBA data enrichment | ✅ Complete | Live scores, standings, schedules via ESPN API |
| Weather integration | ✅ Complete | wttr.in (no API key required) |
| Web search | ✅ Complete | Tavily/Serper/DuckDuckGo with parallel source fetching |
| UI theming | ✅ Complete | Dark/light/system themes with glassmorphism design |
| Model selector | ✅ Complete | Dropdown with pull-to-install, VRAM warnings, prev/next navigation |
| Settings panel | ✅ Complete | Full configuration UI with hardware profiling, GPU VRAM detection |
| Telemetry dashboard | ✅ Complete | Tool call analytics with p50/p95 latency |
| Error boundaries | ✅ Complete | Zone-level crash isolation (Chat, Sidebar, Settings) |
| Test suite | ✅ Complete | 1,884 tests, 62% line coverage |
| First-run onboarding | ✅ Complete | Permission setup, team selection, telemetry consent |
| Context menu system | ✅ Complete | Right-click actions on conversations |
| Suggested prompts | ✅ Complete | History-based prompt suggestions |

**Recently completed (since last report):**

| Feature | Status | Details |
|---------|--------|---------|
| Settings caching | ✅ Complete | 5-second in-memory cache with write-through invalidation; eliminates ~95% of disk reads |
| Intent routing precision | ✅ Complete | Fixed weather location parsing, playoffs regex, standings negation guard, weather follow-up guard |
| VRAM warnings & model fallback | ✅ Complete | GPU detection via PowerShell, model selector badges, startup fallback to best installed model |
| Ollama heartbeat | ✅ Complete | 30-second health check with auto-restart and renderer status notifications |
| LLM synthesis for tool results | ✅ Complete | Weather, NBA, and web search results routed through LLM for natural conversational responses |
| Custom chat avatars | ✅ Complete | Illustrated SADIE character and golden user icon replace emoji placeholders |
| API key encryption | ✅ Complete | Secret fields encrypted at rest via Electron `safeStorage` |
| Default model upgrade | ✅ Complete | Switched from `llama3.2:3b` → `qwen2.5:7b` for significantly better response quality |

**Not yet completed:**

| Feature | Status | Rationale |
|---------|--------|-----------|
| MCP server integration | 🔄 In Progress | Retry logic (3 attempts with timeout) and shutdown-on-quit added; fetch server still unreliable due to upstream MCP SDK issue |
| Installer/auto-update | ⏳ Planned | electron-builder config exists; auto-updater wired with IPC events; needs repository field and first GitHub Release |

**Previously listed as incomplete but already done:**

| Feature | Status | Details |
|---------|--------|---------|
| Speech-to-text input | ✅ Complete | Mic button in InputBox with Windows SAPI (offline) + Web Speech API fallback, Ctrl+Shift+V shortcut, auto-send toggle |
| E2E test suite | ✅ Complete | 10 Playwright specs in CI via `playwright-e2e.yml` (runs on main push/PR), multi-OS matrix in `widget-e2e.yml` |

### 1.4 Problems encountered and solutions

| Problem | Impact | Solution |
|---------|--------|----------|
| **Weather location parsing bug** — the regex `(?:in\|for\|at)` matched "wh**at**" in "What is the weather today?", extracting `"is the weather"` as the location | Tool returned weather for a nonsense location | Added `\b` word boundary before the alternation group across all 4 instances of the pattern |
| **Conversation data corruption** — `conversation-history.json` became empty/truncated, causing `JSON.parse` to throw and all messages to fail persistence | All new messages silently lost | Implemented self-healing: `addMessageToConversation` now auto-creates the conversation record if it doesn't exist, rather than returning false |
| **Model selector hidden in widget mode** — CSS rule `display: none` on `.model-selector-row` prevented users from switching models | Users stuck on default model with no UI to change it | Removed the hiding rule and embedded a compact `ModelSelector` directly in the widget titlebar |
| **Command injection in speech recognition** — `exec()` with string interpolation allowed shell injection | Security vulnerability (OWASP A03) | Replaced with `execFile()` which does not invoke a shell |
| **Fork bomb risk in terminal tool** — no guard against recursive process spawning | Potential system crash | Added process count limits and blocked known dangerous patterns |
| **Ollama IPv6 resolution failure** — `localhost` resolved to `::1` on some Windows configs, but Ollama only listens on `127.0.0.1` | Connection failures on first run | Changed default `ollamaUrl` from `localhost` to `127.0.0.1` |
| **Small model response quality** — 3B models produce verbose, repetitive, low-quality responses | Poor user experience | Added a "length ladder" to the system prompt enforcing response sizing, switched default model from `llama3.2:3b` to `mistral:latest` |

---

## 2. Methodology

### 2.1 How you have utilised the methodology

The project follows an **Agile iterative development methodology** with short sprint cycles (typically 1–2 weeks), continuous integration via automated testing, and iterative refinement based on real user testing.

Key practices employed:

- **Test-Driven Development (TDD)** for critical subsystems — the tool registry, message router, and config manager all have comprehensive test suites written alongside (or before) the implementation. The project currently has **1,884 automated tests** with enforced coverage thresholds.

- **Continuous Integration** — a GitHub Actions workflow runs the full test suite on every push, with coverage gates (branches: 41%, functions: 53%, lines: 57%, statements: 54%) that prevent merging regressions.

- **Iterative user testing** — the developer uses the application daily as their primary AI assistant. Bugs like the weather location parsing issue and the hidden model selector were discovered through this dogfooding process, not through formal QA.

- **Incremental commits** — with 362 commits over 5 months, changes are small and focused. Each commit addresses a single concern (feature, fix, refactor, or test), making it easy to bisect regressions and understand the history.

### 2.2 Where you are currently in the process

The project is in **Sprint 12** (approximately), focused on:

1. **Stability** — fixing bugs found through daily use (weather parsing, conversation persistence, intent routing)
2. **Performance** — reducing unnecessary disk I/O (settings caching), eliminating redundant log output
3. **Quality** — improving LLM response quality through prompt engineering and model selection
4. **Code health** — TypeScript strictness pass removing unnecessary `as any` type casts (22 removed in the latest pass)

### 2.3 How effective has the methodology been?

The Agile iterative approach has been **highly effective** for this project for several reasons:

**Strengths:**

- **Rapid feedback loops** — daily dogfooding catches real bugs that automated tests miss (e.g., the `"what"` → `"at"` regex bug would not have been caught by unit tests because no test used that exact phrasing)
- **Flexible scope** — features like the Automation Center, Image Generator, and RAG panel were added incrementally as the architecture stabilised, without requiring upfront design
- **Regression prevention** — the 1,860-test suite catches breaks immediately. When the default model was changed from `phi4-mini` to `qwen2.5:7b`, tests immediately flagged stale references, all fixed within minutes
- **Small commits** — when the weather parsing bug was traced, `git blame` immediately identified when and why the regex was introduced, making the fix straightforward

**Weaknesses:**

- **Documentation gaps** — the rapid iteration pace has left formal documentation sparse. Component-level API docs and an architecture guide are needed
- **January slowdown** — only 7 commits in January 2026 suggests the methodology didn't account for planning/research phases well; a more formal sprint planning process would help

### 2.4 What processes you are currently engaged in

1. **Bug triage from runtime logs** — analysing real application logs to identify and fix routing, persistence, and performance issues
2. **Prompt engineering** — iterating on the system prompt to achieve precision (correct answers) over speed (fast but wrong answers), with emphasis on making tools fire only when genuinely needed
3. **TypeScript strictness pass** — systematically removing unsafe `as any` type casts to improve compile-time error detection
4. **Performance profiling** — identifying hot paths (like `getSettings()` being called 20+ times per message) and adding caching

---

## 3. Results or Findings

### 3.1 Research undertaken

**Technical research areas:**

| Area | Method | Findings |
|------|--------|----------|
| Local LLM quality | Comparative testing of 8 models (phi4-mini, llama3.2:3b, mistral, qwen2.5, deepseek-r1, gemma2, etc.) | Mistral 7B offers the best quality-to-size ratio for general chat; phi4-mini excels at reasoning but is verbose; llama3.2:3b is too small for quality responses |
| Prompt engineering for small models | A/B testing length ladders, tool-use instructions, persona definitions | Small models (< 4B params) need a compact prompt (~400 tokens) or they waste context on the system prompt itself; a "length ladder" significantly reduces over-verbose replies |
| TTS engine comparison | Tested Web Speech API, edge-tts (Microsoft neural), espeak | Edge TTS with Microsoft Ava voice provides the most natural output; Web Speech is adequate as a fallback but lacks voice variety |
| Intent routing approaches | Compared regex-based routing vs. LLM-based classification | Regex routing is 100x faster (< 1ms vs. ~500ms) and deterministic, but has edge cases; hybrid approach planned where regex handles common patterns and LLM handles ambiguous cases |
| Electron security | Reviewed OWASP Electron security checklist | Identified and fixed: command injection via `exec()`, missing CSP headers, preload script exposure; remaining: CSP policy needs tightening |

### 3.2 Important results and findings

1. **Model size vs. quality threshold** — Models under 3B parameters consistently produce poor results for conversational AI. The quality jump from 3B to 7B is dramatic and worth the additional 2GB of VRAM.

2. **Tool over-firing degrades UX** — Early versions called tools aggressively (e.g., web search for every factual question). User testing revealed this is slower and often less accurate than letting the model answer from its training data. The "precision over speed" principle now guides tool routing.

3. **Regex intent routing is viable but fragile** — The current system handles ~95% of inputs correctly with sub-millisecond latency. However, edge cases (typos like "ply offs", word boundary issues like "wh**at**") require ongoing maintenance. Each bug fix must be applied to 4–6 regex instances across compound intents.

4. **Conversation persistence requires atomic writes** — Early implementations had race conditions where two writes (save conversation + set active) would interleave through the async queue, causing data loss. The fix was to batch related writes into a single atomic operation.

5. **Settings I/O was a major bottleneck** — Runtime profiling revealed `getSettings()` was called 20+ times per single user message. A 5-second in-memory cache with write-through invalidation on save was implemented, eliminating ~95% of disk reads.

### 3.3 Problems that have arisen

| Problem | Category | Resolution |
|---------|----------|------------|
| Small models ignoring system prompt instructions | LLM Behaviour | Created a compact 400-token prompt variant; models under 4B get the compact version automatically |
| NBA data including promotional video titles in output | Data Quality | Added filtering to strip image alt-text and streaming badges from ESPN API responses |
| TTS occasionally using male voices | Voice | Hardened voice selection to prefer female neural voices and fall back gracefully |
| CSS dead code accumulation (184 lines) | Tech Debt | Wrote a Node script to identify and remove 46 unused CSS rule blocks |
| Test coverage dropping below thresholds | CI/CD | Raised thresholds incrementally (30% → 41% branches, 40% → 53% functions) and added targeted tests for uncovered components |
| Duplicate type definitions across files | Architecture | Two `Settings` interfaces existed (shared/types.ts and config-manager.ts); consolidation is planned |

### 3.4 Things tried that didn't work

1. **LLM-based intent classification** — Attempted to use the local model to classify user intent before routing. This added 500ms+ latency per message and the small model frequently misclassified intents. Reverted to regex-based routing with LLM fallback only for ambiguous cases.

2. **Focus mode (distraction-free UI)** — Implemented a dedicated focus mode that hid all UI chrome. User testing revealed it was confusing (no way to access settings or switch models) and the toggle button was placed dangerously close to the window close button. Feature was fully removed rather than relocated.

3. **n8n webhook as primary message router** — The original architecture routed all messages through an n8n workflow server. This added a network hop, required n8n to be running, and made the system fragile. Migrated to direct Ollama communication with n8n as an optional enhancement.

4. **MCP (Model Context Protocol) server for web fetching** — Attempted to use the MCP standard for tool integration. The "fetch" server consistently fails to connect (`McpError: Connection closed`). The native tool registry works reliably, so MCP integration is deprioritised.

### 3.5 Process or expected outcome changes

- **Default model changed** from `phi4-mini` / `llama3.2:3b` → `mistral:latest` → `qwen2.5:7b` based on iterative quality testing
- **Tool execution philosophy changed** from "call tools aggressively for any factual question" to "precision over speed — only call tools when the user genuinely needs live data"
- **Architecture shifted** from n8n-dependent to direct Ollama with n8n as optional, improving reliability and reducing setup complexity
- **UI approach changed** from feature-dense header to minimal widget mode with expandable full mode, after user feedback that the header was too cluttered

---

## 4. Conclusions

### 4.1 Conclusions made so far

1. **Local LLMs are viable for desktop AI assistants** — with the right model selection (7B+ parameters), prompt engineering, and tool augmentation, a fully local AI assistant can provide a competitive experience to cloud-based alternatives for many use cases.

2. **Tool augmentation is the differentiator** — the raw conversational ability of local models is inferior to cloud models. The value proposition of SADIE is not better chat, but the ability to *act* on the user's computer (file operations, terminal commands, git workflows) with safety controls.

3. **Deterministic routing outperforms LLM classification for common patterns** — regex routing is fast, predictable, and testable. LLM classification should be reserved for genuinely ambiguous inputs where the regex system returns null.

4. **Privacy-first architecture requires more engineering effort** — running models locally means managing VRAM budgets, model downloads, context window limits, and hardware-specific defaults. Cloud APIs abstract all of this away. The tradeoff is justified for the privacy guarantee.

5. **Automated testing is essential for a codebase of this complexity** — with 234 TypeScript source files, 70+ tools, and a complex intent routing system, the 1,884-test suite has prevented dozens of regressions during rapid iteration.

### 4.2 Is more research required?

Yes, in three areas:

1. **Hybrid intent routing** — the current regex system handles ~95% of inputs but edge cases accumulate. Research into a lightweight classifier (possibly a fine-tuned small model or a decision tree) that can handle the remaining 5% without adding latency.

2. **Context window management** — as conversations grow long, the model's context window fills up. Current trimming is basic (drop oldest messages). Research into semantic summarisation of conversation history would improve long conversation quality.

3. **Cross-platform testing** — the application is developed and tested on Windows. macOS and Linux compatibility needs validation, particularly for tools that use platform-specific APIs (PowerShell, speech recognition).

### 4.3 Do you need to change the scope?

Minor scope adjustments:

- **Removed:** Focus mode (delivered no value, caused UX confusion)
- **Deprioritised:** MCP server integration (native tool registry works well)
- **Added:** Telemetry dashboard (emerged from need to debug tool performance)
- **Added:** Hardware profiling (needed to recommend appropriate models for different GPU configurations)

The core scope remains unchanged. The project delivers what was proposed: a privacy-first desktop AI assistant with tool capabilities.

### 4.4 Is the project on target and going as expected?

**Yes, the project is on target.** Key metrics:

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Core features | All proposed features implemented | 20/20 major features complete | ✅ On track |
| Test coverage | > 50% line coverage | 62.28% lines, 59.22% statements | ✅ Exceeding |
| Test count | Comprehensive suite | 1,884 tests, 119 suites | ✅ Exceeding |
| Code quality | TypeScript strict mode | 234 source files, reducing `as any` casts | 🔄 Improving |
| Stability | No crash-level bugs | Error boundaries isolate failures; 0 unhandled crashes | ✅ On track |
| Performance | Responsive UI | Settings caching implemented; UI is responsive | ✅ On track |
| User experience | Usable daily driver | Developer uses it as primary AI assistant | ✅ On track |

The main risk is **scope creep** — the tool count has grown from an initial plan of ~10 to 70+, and each tool adds maintenance burden and test surface. Going forward, the focus should be on polishing existing tools rather than adding new ones.

---

## Appendix: Project Statistics

| Metric | Value |
|--------|-------|
| Total commits | 362 |
| Development period | Nov 2025 — Apr 2026 (5 months) |
| Source files (TypeScript/TSX) | 234 |
| Lines of TypeScript | ~14,000 |
| Lines of CSS | ~4,800 |
| Test files | 129 |
| Test count | 1,884 |
| Test suites | 119 |
| Coverage (lines) | 62.17% |
| Coverage (branches) | 46.16% |
| Coverage (functions) | 57.63% |
| UI components (React) | 28 |
| Tool implementations | 70+ |
| LLM models supported | 9 (local) + 5 (cloud providers) |

---

## Appendix: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        SADIE Desktop App                        │
├────────────────────────────┬────────────────────────────────────┤
│      Renderer Process      │          Main Process              │
│      (React + TypeScript)  │       (Node.js + Electron)         │
│                            │                                    │
│  ┌──────────────────────┐  │  ┌──────────────────────────────┐  │
│  │   Chat Interface     │  │  │    Message Router            │  │
│  │   ┌──────────────┐   │  │  │    ┌────────────────────┐    │  │
│  │   │ Message List  │   │  │  │    │ Intent Classifier  │    │  │
│  │   │ Input Box     │   │  │  │    │ (Regex-based)      │    │  │
│  │   │ Model Select  │   │  │  │    └────────┬───────────┘    │  │
│  │   └──────────────┘   │  │  │             │                │  │
│  ├──────────────────────┤  │  │    ┌────────▼───────────┐    │  │
│  │   Settings Panel     │  │  │    │   Tool Registry     │    │  │
│  │   Telemetry Dash     │  │  │    │   (70+ tools)       │    │  │
│  │   Conversation       │  │  │    └────────┬───────────┘    │  │
│  │     Sidebar          │  │  │             │                │  │
│  │   Token Counter      │  │  │    ┌────────▼───────────┐    │  │
│  │   Error Boundaries   │  │  │    │  Permission Gate   │    │  │
│  └──────────────────────┘  │  │    └────────┬───────────┘    │  │
│            │               │  │             │                │  │
│        IPC Bridge          │  │    ┌────────▼───────────┐    │  │
│     (Preload Script)       │  │    │  Tool Executor     │    │  │
│                            │  │    └────────────────────┘    │  │
├────────────────────────────┤  ├──────────────────────────────┤  │
│                            │  │                              │  │
│                            │  │  ┌────────────────────────┐  │  │
│                            │  │  │    Config Manager      │  │  │
│                            │  │  │    Memory Manager      │  │  │
│                            │  │  │    Telemetry Logger     │  │  │
│                            │  │  └────────────────────────┘  │  │
└────────────────────────────┴──┴──────────────────────────────┘  │
                                                                  │
              External Services                                   │
┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│   Ollama     │ │   wttr.in    │ │  ESPN API    │               │
│  (Local LLM) │ │  (Weather)   │ │  (NBA Data)  │               │
└──────────────┘ └──────────────┘ └──────────────┘               │
┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  Tavily/     │ │  Edge TTS    │ │   n8n        │               │
│  Serper/DDG  │ │ (Neural Voice)│ │ (Optional)   │               │
│ (Web Search) │ │              │ │              │               │
└──────────────┘ └──────────────┘ └──────────────┘               │
```

## Appendix: Tool Registry

```
┌────────────────────────────────────────────────────┐
│                  70+ Registered Tools              │
├──────────────┬──────────────┬──────────────────────┤
│  Filesystem  │  Developer   │  Communication       │
│  ──────────  │  ──────────  │  ──────────────      │
│  read_file   │  terminal    │  email (send/read)   │
│  write_file  │  grep_code   │  contacts            │
│  edit_file   │  project_tree│  notification        │
│  list_dir    │  analyze_file│                      │
│  create_dir  │  code_runner │                      │
│  delete_file │  diff        │                      │
│  move_file   │  git_*  (6)  │                      │
├──────────────┼──────────────┼──────────────────────┤
│  Web/Data    │  System      │  AI/Memory           │
│  ──────────  │  ──────────  │  ──────────          │
│  web_search  │  clipboard   │  recall              │
│  fetch_url   │  screenshot  │  remember            │
│  get_weather │  launch_app  │  rag_index           │
│  nba_query   │  process_mgr │  rag_search          │
│  news        │  system_info │  planning            │
│  sports      │  calendar    │                      │
│  voice/tts   │  reminder    │                      │
│  parse_doc   │  browser     │                      │
└──────────────┴──────────────┴──────────────────────┘
```

## Appendix: Test Coverage Breakdown

```
Coverage Summary (27 April 2026)
════════════════════════════════════════════
Statements : ██████████████░░░░░░░  59.07%
Branches   : █████████░░░░░░░░░░░  46.16%
Functions  : ███████████░░░░░░░░░  57.63%
Lines      : ████████████░░░░░░░░  62.17%
════════════════════════════════════════════
Test Suites: 119 passed   |  Tests: 1,884 passed
```

## Appendix: Development Velocity

```
Commits per Month
═══════════════════════════════════════════════════════
Nov 2025  ████████████████████████████████         60
Dec 2025  ████████████████████████████             56
Jan 2026  ████                                      7
Feb 2026  ███████████████                           29
Mar 2026  █████████████████████████████████████████ 125
Apr 2026  ██████████████████████████████████████    85*
═══════════════════════════════════════════════════════
                                   * month in progress
Total: 362 commits over 5 months
```
