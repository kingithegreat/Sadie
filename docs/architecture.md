# HomeBot Architecture

This document describes the high-level architecture of HomeBot: how the major components interact, how messages and tool calls flow through the system, and how safety, persistence, and theming are handled.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Details](#component-details)
3. [Tool System](#tool-system)
4. [Safety Model](#safety-model)
5. [Memory and Persistence](#memory-and-persistence)
6. [Cloud LLM Integration](#cloud-llm-integration)
7. [Theming and UI Architecture](#theming-and-ui-architecture)
8. [Build and Packaging](#build-and-packaging)
9. [Testing Architecture](#testing-architecture)
10. [Media Studio & Movie Production Engine](#media-studio--movie-production-engine)
11. [Telemetry and Consent](#telemetry-and-consent)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  User Desktop                                                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  HomeBot Electron Widget  (widget/)                            │   │
│  │                                                              │   │
│  │  ┌────────────────────────────────┐  ┌───────────────────┐  │   │
│  │  │  Renderer (React + TypeScript) │  │  Main Process     │  │   │
│  │  │  widget/src/renderer/          │  │  widget/src/main/ │  │   │
│  │  │                                │  │                   │  │   │
│  │  │  - Chat UI (MessageList)       │<>│  - IPC handlers   │  │   │
│  │  │  - Settings Panel              │  │  - Message router │  │   │
│  │  │  - Tools Panel                 │  │  - Tool executor  │  │   │
│  │  │  - Conversation Sidebar        │  │  - Config manager │  │   │
│  │  │  - Action Confirmation Modal   │  │  - Scheduler      │  │   │
│  │  │  - Analytics Dashboard         │  │  - Auto-updater   │  │   │
│  │  └────────────────────────────────┘  └────────┬──────────┘  │   │
│  │                   ^                           |             │   │
│  │            Preload bridge                     |             │   │
│  │         (window.electron.*)                   |             │   │
│  └──────────────────────────────────────────────┼─────────────┘   │
│                                                  |                  │
│      ┌───────────────────┐   ┌──────────────────┐|                  │
│      │  Ollama (local)   │   │  n8n (optional)  │|                  │
│      │  127.0.0.1:11434 │   │  localhost:5678   │|                  │
│      │                   │   │                   │|                  │
│      │  qwen2.5:7b        │<──│  Workflow triggers│|                  │
│      │  dolphin-mistral:7b│   │  HTTP webhooks   │|                  │
│      │  moondream         │   │                   │|                  │
│      │  nomic-embed-text  │   └───────────────────┘|                  │
│      └───────────────────┘                        |                  │
│                                                   |                  │
│      Local disk: config/ , memory/ , logs/  <─────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

HomeBot is a multi-process Electron application. The **renderer process** (React) handles all UI interactions. The **main process** (Node.js) handles tool execution, LLM communication, file I/O, and system access. The two processes communicate exclusively through a typed **preload bridge** using Electron's `contextBridge` API.

---

## Component Details

### Renderer Process (`widget/src/renderer/`)

The React UI running inside Chromium. Key responsibilities:

- **Chat surface** — renders message history, handles user input, displays streaming token-by-token responses with cancel/retry controls, and blocks marker-only retries for document-attached turns by asking the user to reattach the file.
- **Conversation sidebar** — lists conversations with timestamps, message count badges, pinning, archiving, tags, reactions, and full-text search.
- **Automation Center** — create, edit, and run reusable automations. Each automation stores plain-English instructions that HomeBot executes through its full tool chain. Supports manual and scheduled triggers (15 min – 24 h intervals) with background timers. Includes example templates, expandable result viewer, status indicators (success/error), and n8n credential management buttons (opens `localhost:5678/credentials` for API keys and OAuth tokens).
- **Quiz Mode** — interactive coding quiz with 12 topics, 3 difficulty levels, and configurable question counts. Generates multiple-choice questions via batched Ollama calls. Tracks persistent progress (accuracy, streak, per-topic scores) and awards letter grades.
- **Action confirmation** — modal dialog for approving destructive or sensitive tool calls before execution.
- **Permission modal** — prompts the user to allow-once, always-allow, or cancel when a tool requires a permission that has not yet been granted.
- **Settings panel** — edits and persists user preferences (models, hotkey, permissions, API keys, theme, notification preferences).
- **Tools panel** — lists all registered tools grouped by category with a live search filter.
- **Analytics dashboard** — visualises conversation activity and tool usage metrics.
- **Telemetry UI** — opt-in consent flow and event dashboard (no data leaves the machine).
- **Model selector** — dynamic Ollama model picker with install/pull, VRAM warnings, and prev/next navigation.
- **ErrorBoundary zones** — wraps Chat, Sidebar, and Settings with compact crash recovery ("X crashed" + Retry).

The renderer communicates with the main process exclusively through the preload bridge (`window.electron.*`). It never accesses Node.js APIs directly.

### Application Modes

The renderer supports eleven modes (`APP_MODES`), switchable via the sidebar, keyboard shortcuts, or programmatic assistant navigation (`navigate_to_mode`):

| Mode | Shortcut | Component | Purpose |
|---|---|---|---|
| `chat` | Ctrl+1 | `App.tsx` (inline) | Main conversational interface |
| `automation` | Ctrl+2 | `AutomationCenter.tsx` | Create, schedule, and run reusable automations |
| `image` | Ctrl+3 | `ImagePanel` | AI image generation via SD WebUI / ComfyUI / DALL-E 3 / Pollinations / Stable Horde |
| `documents` | Ctrl+4 | `DocumentViewer.tsx` | Document viewer/editor with Add to RAG and Send to Chat |
| `quiz` | Ctrl+5 | `QuizPanel.tsx` | Interactive coding quiz |
| `media` | — | `MediaStudioPanel.tsx` | Content Command Center: automated video rendering, podcast recaps, Ancient Pathways animation, and autonomous movie production |
| `code` | — | `WorkspaceShell.tsx` | VS Code-style workspace: file explorer, editor, terminal, and changes viewer |
| `browser` | — | `BrowserPanel.tsx` | Sandboxed web browser with assistant control tools |
| `dashboard` | — | `DashboardPanel.tsx` | System overview, usage analytics, and quick status |
| `feeds` | — | `FeedsPanel.tsx` | News and RSS feed aggregator and reader |
| `connections` | — | `ConnectionsPanel.tsx` | External service integration hub (Notion, GitHub, Slack, etc.) |

### Preload Bridge (`widget/src/preload/index.ts`)

The `contextBridge` layer that safely exposes a typed API surface (`ElectronAPI`) to the renderer. Each renderer-callable function maps 1:1 to a named IPC channel. This eliminates `nodeIntegration` and keeps the renderer fully sandboxed.

Key bindings: `sendMessage`, `sendStreamMessage`, `cancelStream`, `saveSettings`, `loadSettings`, `listTools`, `loadConversations`, `createConversation`, `startSpeechRecognition`, `ttsSpeak`, `ragIndex`, `openExternal`, `generateQuiz`, `saveQuizProgress`, `loadQuizProgress`, `loadAutomations`, `createAutomation`, `updateAutomation`, `deleteAutomation`, `runAutomation`, and 40+ additional channels.

### Main Process (`widget/src/main/`)

The Node.js Electron main process. Key responsibilities:

| Module | Purpose |
|---|---|
| `message-router.ts` | Parses user messages, expands `documents[]` into extracted prompt context before routing or forwarding upstream, detects tool intent, streams Ollama completions, executes tool batches, and returns synthesised results. Contains context budget logic for small models, agentic loop orchestration, recovery-hint classification, and morning briefing trigger. |
| `agentic-loop.ts` | Multi-step request detection and agentic tool-chaining engine. Detects compound requests via heuristics, injects agentic system prompt, and streams step-progress indicators during autonomous tool execution (up to 6 rounds). |
| `morning-briefing.ts` | Proactive daily briefing generator. On first interaction each day, runs weather + calendar + reminders tools in parallel and streams a formatted summary. State persisted in `briefing-state.json`. |
| `ipc-handlers.ts` | Receives calls from the preload bridge and routes them to the correct subsystem. Includes Automation Center CRUD, scheduled-automation timer engine, and Quiz Mode generation/progress persistence. |
| `config-manager.ts` | Reads and writes `config/user-settings.json` with schema validation. Includes 5-second in-memory cache to avoid ~20 disk reads per message. Secret fields (API keys) are encrypted at rest via `safeStorage`. |
| `window-manager.ts` | Manages always-on-top behaviour, global hotkey registration (`Ctrl+Shift+Space`), tray icon, and window lifecycle. |
| `auto-updater.ts` | Checks for updates 5 seconds after startup via electron-updater. Sends IPC progress events to the renderer. Skipped in E2E/test mode. |
| `scheduler.ts` | Manages persistent reminders and scheduled jobs. Saves to and loads from `userData/memory/json-store/reminders.json`. |
| `webhook-auth.ts` | Generates and persists a 256-bit shared secret per install. Attaches `X-HOMEBOT-Auth` header to all n8n POST calls. |

### Tool Handlers (`widget/src/main/tools/`)

All 85+ tools are implemented as TypeScript modules that export tool definitions and handler functions. See the [Tool System](#tool-system) section below for details.

---

## Tool System

### Registration

Every tool is a TypeScript module exporting two objects:

```typescript
export const myToolDefs: ToolDefinition[] = [
  {
    name:        'my_tool',
    description: 'Does something useful',
    category:    'utility',
    parameters:  { /* JSON Schema */ },
    requiredPermissions: ['my_permission'],
  }
];

export const myToolHandlers: Record<string, ToolHandler> = {
  my_tool: async (args, context) => {
    return { success: true, result: '...' };
  }
};
```

All tool modules are imported and merged in `widget/src/main/tools/index.ts`.

### Tool Categories

HomeBot categorises its 137 tool handlers across domain-specific functional categories:

| Category | Tools |
|---|---|
| `media` | `media_create_job`, `media_list_jobs`, `media_advance_job`, `media_approve_job`, `media_reject_job`, `media_write_script`, `media_narrate`, `media_setup_research`, `media_render`, `media_list_music`, `media_delete_job`, `media_narrate_clip`, `media_generate_sprites`, `media_measure_mouth_anchors`, `media_produce_movie` |
| `crm` | `crm_create_company`, `crm_update_company`, `crm_search_companies`, `crm_create_contact`, `crm_update_contact`, `crm_search_contacts`, `crm_create_deal`, `crm_update_deal`, `crm_advance_deal`, `crm_search_deals`, `crm_log_activity`, `crm_add_note`, `crm_create_task`, `crm_complete_task`, `crm_find_stale_deals`, `crm_daily_brief`, `crm_match_email`, `crm_get_stages`, `crm_rename_stage`, `crm_audit_log`, `crm_export` |
| `filesystem` | `read_file`, `write_file`, `edit_file`, `list_directory`, `delete_file`, `move_file`, `copy_file`, `search_files`, `create_directory`, `create_docx`, `create_spreadsheet`, `create_pdf` |
| `system` | `get_system_info`, `list_processes`, `get_process_info`, `kill_process`, `get_clipboard`, `set_clipboard`, `open_url`, `launch_app`, `screenshot`, `get_current_time`, `navigate_to_mode` |
| `web` | `web_search`, `fetch_url`, `get_weather`, `get_news`, `list_news_feeds`, `browser_action`, `image_generate` |
| `browser` | `navigate_browser`, `read_browser_page`, `list_browser_targets`, `click_browser_target`, `type_in_browser` |
| `vision` | `vision_describe`, `vision_query`, `look_at_browser` |
| `rag` | `rag_index`, `rag_query`, `rag_list`, `rag_clear` |
| `memory` | `remember`, `recall`, `forget`, `list_memories` |
| `planning` | `plan_task`, `get_plans` |
| `communication` | `email_send`, `email_draft`, `email_list`, `calendar_events` |
| `clipboard` | `clipboard_read`, `clipboard_write` |
| `voice` | `tts_speak`, `tts_stop`, `transcribe_audio` |
| `automation` | `create_automation`, `list_automations`, `update_automation`, `delete_automation`, `run_automation`, `import_n8n_workflow` |
| `skills` | `list_skills`, `use_skill` |
| `document` | `parse_document`, `get_document_content`, `list_documents`, `search_document` |
| `utility` | `run_terminal_command`, `get_terminal_history`, `grep_code`, `project_tree`, `analyze_file`, `run_code`, `git_status`, `git_log`, `git_diff`, `git_branches`, `git_commit`, `api_request`, `generate_sports_report`, `nba_query` |

### Execution Flow

```
User types message
      |
      v
Morning briefing check (once per day)
      |
      v
message-router.ts → preProcessIntent() [deterministic regex routing]
      |
      |-- [intent matched] --> execute tool(s) directly, format result
      |
      |-- [no match, multi-step detected] --> AGENTIC MODE
      |       |
      |       v
      |   Inject agentic system prompt + full tool set
      |   LLM plans and chains tools autonomously
      |   Stream step-progress ("🔄 Step 1: Searching…" / "✅ done")
      |   Up to MAX_AGENTIC_ROUNDS=6, inner MAX_TOOL_ROUNDS=10
      |
      |-- [no match, single-step] --> LLM streaming with tools
              |
              v
         Ollama returns text or a tool_call JSON block
              |
              |-- [text response] --> stream tokens back to renderer
              |
              |-- [tool_call]
                    |
                    v
                 Permission precheck (executeToolBatch)
                    |
                    |-- All granted --> safety check --> execute --> return to Ollama
                    |
                    |-- Missing --> Permission modal (allow once / always / cancel)
```

### Document Attachment Preprocessing

When a request includes `documents[]`, HomeBot extracts document content before intent analysis and before forwarding to n8n. This prevents the router from treating the placeholder line `[Document attached: ...]` as the real user payload.

- **Non-stream requests** use the expanded document text for both routing and upstream forwarding.
- **Streaming requests** preserve the original upload on first send, but retries do not attempt to reconstruct missing file bytes from chat history.
- **Retry safety**: if a failed assistant turn was created from a document-attached message, the renderer surfaces a `reattach-document` recovery hint instead of resending a marker-only request.

### Context Budget for Small Models

Models with 3B parameters or fewer (detected by `isSmallModel()`) receive scaled-down context injection:

| Parameter | Small Model | Full-Size Model |
|---|---|---|
| History turns | 12 | 50 |
| Digest cap | 500 characters | Unlimited |
| Memory recall cap | 300 characters | Unlimited |
| System prompt | Compact (~400 tokens) | Full (~1,500 tokens) |

This prevents silent context overflow on models with small context windows.

### LLM Synthesis for Tool Results

When a deterministic tool (weather, NBA, web search) returns structured data, the router does not dump raw JSON to the user. Instead, it:

1. Formats the data into a human-readable summary (e.g., temperature, condition, wind).
2. Sends the raw summary as an immediate stream chunk so the user sees data instantly.
3. Builds a `buildToolSynthesisPrompt()` with the data + original question.
4. Streams a natural-language follow-up via `synthesisStream()`, which routes to the cloud LLM (if configured) or local Ollama.

This produces conversational responses ("It's a warm 24°C in Auckland today…") instead of bullet-point data dumps.

### VRAM Detection and Model Warnings

On first launch, `detectGpuVram()` (via `moa.ts`) queries the GPU using PowerShell's `Get-CimInstance Win32_VideoController`. The detected VRAM is stored in settings as `hardwareProfile` and drives:

- **Model selector badges** — "slow" (model exceeds VRAM) or "tight" (model fits but leaves <1 GB headroom).
- **Confirmation dialog** — arrow navigation and dropdown selection both route through `selectModelWithVramCheck()`, which shows a confirm prompt for over-VRAM models.
- **First-run auto-defaults** — if no hardware profile exists, the app applies model defaults matching the GPU tier (e.g., 4 GB users skip 8B+ models).

### Ollama Heartbeat

A 30-second interval (`HEARTBEAT_INTERVAL`) polls `GET /api/tags` on the configured Ollama URL. On state change:

- **Online → Offline**: pushes `homebot:ollama-status { online: false, autoRestarting: true }` to the renderer, then spawns `ollama serve` in a detached process to attempt auto-recovery.
- **Offline → Online**: pushes `homebot:ollama-status { online: true }`. The renderer shows/hides a status toast accordingly.

### Model Fallback

At startup, if the configured `chatModel` is not installed in Ollama, the main process selects the best available alternative (preferring larger models) and pushes `homebot:model-fallback { from, to }` to the renderer. The renderer updates its settings state and shows a warning toast.

### Follow-Up Context Guards

When a conversation has a `lastIntent` (e.g., the user just asked about weather), subsequent messages are checked for domain relevance before re-invoking the same tool:

- **Weather**: requires weather keywords (`rain`, `forecast`, `temperature`, etc.) or referential language (`more`, `tomorrow`, `how about`). Without these, the intent is cleared and the message falls through to normal LLM routing.
- **NBA**: similar keyword guards prevent non-sports queries from re-triggering `nba_query`.
- **Web search**: domain-mismatch guard clears intent when the follow-up is clearly unrelated (>30 chars with no overlap).

### Custom Chat Avatars

The chat UI uses illustrated PNG avatars instead of emoji placeholders. `HomeBotChatAvatar.png` (illustrated character, square-cropped) and `UserChatAvatar.png` (golden hero icon) are Vite-imported as asset URLs and rendered as `<img>` elements inside `.message-avatar` containers with `object-fit: cover` and `border-radius: 50%`.

---

## Safety Model

HomeBot runs entirely locally. No data is sent to external servers except through explicit user-configured cloud LLM integrations. Safety is enforced at multiple layers:

### Layer 1: Tool Allowlist (`config/tool-allowlist.json`)

Defines which tools are enabled. Disabled tools are not registered and cannot be called by the LLM.

### Layer 2: Safety Rules (`config/safety-rules.json`)

- **Path whitelist** — file tools are restricted to configurable directories (defaults to user home, Desktop, Downloads).
- **Command blocklist** — patterns of shell commands that are always refused.
- **Confirmation-required list** — tool names that always require explicit user approval.

### Layer 3: API Allowlist (`config/api-allowlist.json`)

The `api_request` tool can only reach hosts listed in this file. Requests to unlisted hosts are rejected before the HTTP call is made.

### Layer 4: SSRF Protection (`web.ts`)

All outbound HTTP requests from web tools pass through `isUrlSafe()`, which validates:

- Protocol (HTTP/HTTPS only; blocks `file://`, custom schemes)
- Hostname (blocks `localhost`, `127.0.0.1`, `::1`, private IPv4 ranges)
- DNS resolution (validates all A/AAAA records against private ranges)

### Layer 5: IPC Hardening

- `contextIsolation: true` — renderer cannot access Node.js APIs
- `nodeIntegration: false` — no `require()` in renderer
- `homebot:open-file` and `homebot:show-in-folder` restrict paths to user home directory
- `webviewTag: false` — no webview elements
- Preload `invoke()` gated behind `isE2E()` check

### Layer 6: Webhook Authentication (`webhook-auth.ts`)

A 256-bit secret is generated per install and persisted to disk. All HTTP requests to n8n include `X-HOMEBOT-Auth` header. n8n workflows validate this header via an Auth Guard Code node.

### Layer 7: Terminal Safety (`terminal.ts`)

The `run_terminal_command` tool executes shell commands in a specified working directory. Safety is enforced via:

- **Confirmation gate** — every command requires explicit user approval via the confirmation modal.
- **Home-directory restriction** — the working directory must be inside the user's home directory.
- **Catastrophic command blocklist** — patterns like `rm -rf /`, `format C:`, `dd of=/dev/sda`, `shutdown`, fork bombs, and registry deletion are blocked before the confirmation modal even appears.
- **Timeout** — 60-second default, configurable up to 120 seconds.
- **Output cap** — stdout/stderr are truncated to 16 KB in the result; exec buffer is 1 MB.
- **ANSI stripping** — `FORCE_COLOR=0` and `NO_COLOR=1` environment variables suppress color codes for clean LLM consumption.

### Layer 8: Codebase Tool Safety (`codebase.ts`)

The `grep_code`, `project_tree`, and `analyze_file` tools are read-only and cannot modify files. Safety measures:

- **Home-directory restriction** — all paths must be inside the user's home directory.
- **Automatic skip list** — `node_modules`, `.git`, `dist`, `build`, `__pycache__`, and 15+ other artifact directories are excluded from traversal.
- **Binary file exclusion** — 40+ binary extensions (images, archives, executables, fonts) are skipped in grep.
- **File size limits** — grep skips files >1 MB; analyze_file refuses files >2 MB.
- **Regex safety** — invalid regex patterns from the LLM fall back to literal string matching instead of crashing.
- **Result caps** — grep: max 200 matches; tree: max 500 items; traversal depth: max 8 levels.

### Layer 9: Input Size Guards

- **Document parsing**: 50 MB file size limit on `homebot:parse-document` prevents memory exhaustion.
- **Vision input**: 20 MB file size check in `vision.ts` before `readFileSync`.
- **HTTP redirects**: `httpGet` in `web.ts` caps redirect chains at 5 hops to prevent loops.
- **NBA requests**: 15-second timeout on `httpsGet` prevents indefinite hangs.
- **Conversation digest**: Rolling digest in `message-router.ts` capped at 4,000 characters with smart truncation.
- **Contact queries**: `contacts.ts` strips PowerShell metacharacters (`'"$\`();|{}&`) from search input.

### Layer 10: Tool Recursion Cap

`MAX_TOOL_ROUNDS = 10` in `message-router.ts`. If the LLM attempts more than 10 consecutive tool calls in a single turn, the router halts and sends a user-facing warning.

---

## Memory and Persistence

### Memory Store

```
memory/
  json-store/       <-- key-value pairs written by write_memory tool
  rag-index.json    <-- RAG document index (TF-IDF chunks)
  cache/            <-- ephemeral cache (cleared on restart)
```

Memory entries are plain JSON files keyed by a user-defined name. The `read_memory` and `write_memory` tools read and write these files. Everything is human-readable on disk.

### Conversation Persistence

Conversations are stored in the Electron `userData` directory and loaded via `loadConversations()` on startup. Each conversation contains its full message history, metadata (title, timestamps, tags, pinned state), and is addressable by UUID.

### Settings Persistence

User settings are read from and written to `%APPDATA%\HomeBot\config\user-settings.json` via the `loadSettings` / `saveSettings` IPC channels. The `config-manager` caches settings in memory with a 5-second TTL to avoid repeated disk reads (~20 per message). Secret fields (API keys) are encrypted at rest using Electron's `safeStorage` API and decrypted transparently on read.

### Reminder Persistence

Scheduled reminders are saved to `userData/memory/json-store/reminders.json` and reloaded on app restart via `scheduler.ts`.

### Automation Persistence

Automations are stored in `userData/automations.json`. Each automation contains:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | UUID |
| `name` | `string` | Display name |
| `description` | `string` | Optional description |
| `instructions` | `string` | Plain-English prompt executed by HomeBot's tool chain |
| `trigger` | `'manual' \| 'schedule'` | How the automation is invoked |
| `scheduleMinutes` | `number` | Interval for scheduled triggers (15–1440) |
| `enabled` | `boolean` | Whether the automation is active |
| `lastRun` | `string` | ISO timestamp of the last execution |
| `lastResult` | `string` | Output text from the last run |
| `lastStatus` | `'success' \| 'error'` | Outcome of the last execution |
| `createdAt` | `string` | ISO timestamp of creation |

Scheduled automations use `setInterval`-based background timers. On app boot (after 5 s), `startAutomationSchedule()` reads all automations and starts timers for enabled scheduled ones. Timers re-sync every 60 s to pick up CRUD changes. When a timer fires, it calls `executeAutomation()` (which uses `processIncomingRequest` with direct Ollama fallback) and sends a `homebot:reminder-fired` event to the renderer so the result appears in chat.

### Quiz Progress Persistence

Quiz progress is stored in `userData/quiz-progress.json` and tracks per-topic accuracy, best streak, total questions answered, and historical scores.

---

## Cloud LLM Integration

HomeBot supports optional cloud LLM routing for enhanced capabilities:

### Code Cloud API

Coding queries (detected by `CODING_QUERY_PATTERN`) are routed to a configured cloud provider only when the code API path is explicitly enabled, not merely because provider credentials exist. Supported providers:

- **OpenAI** (GPT-4, GPT-4o, GPT-4o Mini)
- **Anthropic** (Claude Opus 4, Claude Sonnet 4, Claude 3.5 Haiku)
- **OpenRouter** (100+ models via single API)
- **Custom** (any OpenAI-compatible endpoint, including LM Studio, LocalAI, vLLM)

### Embedded Web Services

ChatGPT, Claude, and Gemini are accessible directly inside HomeBot via sandboxed `BrowserWindow` panels rather than Electron `<webview>` elements. Login and interaction work through the dedicated window manager and service permission hardening.

### Model Metadata

`MODEL_METADATA` in `shared/constants.ts` contains token limits, pricing tiers, and capabilities for all supported cloud models. The message router uses `maxTokens` from metadata instead of hardcoded values.

---

## Theming and UI Architecture

### Theme System

HomeBot supports three theme modes: **light**, **dark**, and **system** (follows OS preference).

- Themes are implemented via CSS custom properties (`--bg-*`, `--accent-*`, `--text-*`) with `[data-theme]` selectors.
- 15+ CSS keyframe animations: `headerScan`, `titleShimmer`, `connectedGlow`, `msgSlideIn`, `avatarRingSpin`, `voiceNeonPulse`, `welcomeFloat`, `activeCardGlow`, and more.
- Glass morphism effects on settings panel and modals.
- `@media (prefers-reduced-motion: reduce)` disables all animations for accessibility.

### Custom Markdown Renderer

Chat messages are rendered with a custom Markdown renderer supporting fenced code blocks with copy buttons, inline formatting (bold, italic, strikethrough), links, headings, and lists.

### Streaming UI

Responses are displayed token-by-token in real time. Users can cancel mid-stream or retry failed messages. For document-attached turns, retries intentionally require reattaching the source file so HomeBot does not resend a prompt that contains only the attachment marker.

---

## Build and Packaging

HomeBot uses **electron-vite** as its build system (not Webpack).

```
widget/
  src/
    main/        <-- Electron main process (TypeScript)
    renderer/    <-- React UI (built with Vite + HMR)
    preload/     <-- Context bridge (TypeScript)
    shared/      <-- Types shared between main and renderer
  electron.vite.config.ts    <-- Build configuration
  electron-builder.yml       <-- Packager configuration
```

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server (renderer HMR) + Electron main process via the wrapper that clears `ELECTRON_RUN_AS_NODE` |
| `npm run build` | Compile everything (TypeScript + Vite build) |
| `npm run dist` | Create platform-specific installer via electron-builder |

The Windows installer is an NSIS `.exe` with per-user install, directory chooser, and desktop/start-menu shortcuts.

---

## Testing Architecture

Tests live at two levels:

| Level | Location | Runner | Coverage |
|---|---|---|---|
| Unit (tools, router, utils) | `widget/src/main/__tests__/` | Jest + ts-jest | Routing, tools, persistence, IPC, safety |
| Unit (renderer components) | `widget/src/renderer/__tests__/` | Jest + React Testing Library | Streaming UI, retry flows, onboarding, settings, sidebar |
| E2E (full application) | `widget/src/renderer/e2e/` | Playwright | Electron launch, onboarding, persistence, streaming, permissions |

Each Playwright run uses an isolated temp profile via `HOMEBOT_E2E_USER_DATA_DIR` so tests do not share conversation or settings state.

Run all tests:

```bash
cd widget
npx jest --config jest.config.ts --no-coverage
```

Run E2E tests:

```bash
cd widget
npm run e2e
```

---

## Media Studio & Movie Production Engine

HomeBot features a comprehensive, multi-modal content generation and video production pipeline designed for automated storytelling, character-consistent animation, and cinematic movie production.

### 1. Media Studio Job State Machine (`widget/src/main/media-studio.ts`)

The Media Studio operates on a deterministic, pure state machine managing content projects through a 6-stage lifecycle:

```
[draft] ──> [scripting] ──> [narrating] ──> [rendering] ──> [review] ──> [published]
   │             │               │              │               │
   └─────────────┴───────────────┴──────────────┴───────────────┴──> [failed]
                                                                │
                                            (reject with note) ─┘
```

- **States**:
  - `draft`: Initial idea or topic seeded from chat, RSS feeds, or manual user input.
  - `scripting`: LLM synthesises structured narrative segments, visual cues, and presenter narration.
  - `narrating`: TTS engine renders spoken audio segments per scene or bullet point.
  - `rendering`: Video composition, image framing, pan/zoom motion, and audio mixing.
  - `review`: **Human-in-the-loop approval gate**. Renders cannot publish autonomously. Users must approve (`media_approve_job`) or reject with revision notes (`media_reject_job`).
  - `published`: Final video delivered to disk with export metadata.
- **Store & Persistence (`media.ts`)**: Atomic disk persistence in `userData/media-jobs.json` with corrupt-file automatic backups.
- **Chat Reachability**: All jobs can be created, progressed, reviewed, and published directly through chat tools (`media_create_job`, `media_list_jobs`, `media_advance_job`, `media_approve_job`, `media_reject_job`, `media_delete_job`).

### 2. Automated Video Rendering & Audio Ducking (`widget/src/main/media-render.ts`)

For slideshows, summaries, and podcast recaps, the render engine automates:
- **Motion Graphics**: Ken Burns pan/zoom camera motion applied dynamically to static scene imagery.
- **Audio Ducking**: Automatically mixes royalty-free background music tracks with spoken voiceover, ducking the music volume down during active speech intervals and restoring it between phrases.
- **Subtitle Generation**: Burns synchronized captions directly into output MP4 files.

### 3. Bring-Your-Own Video Narration (`widget/src/main/tools/narrate-clip.ts`)

Enables users to provide an existing video clip and generate AI-driven sports, gaming, or instructional commentary:
- **Tool**: `media_narrate_clip`.
- **Vision Analysis**: Inspects keyframes via Gemini 1.5 Flash / Pro (`scripts/analyze_clip.py`) to extract context, actions, and timestamps.
- **Voice Synthesis**: Generates voiceover via Edge TTS or Kokoro TTS.
- **Fast Lossless Muxing**: Combines new narration with original video using ffmpeg stream copy (`-c:v copy`), preserving full video fidelity without re-encoding delays.

### 4. Local 2D Animation & Ancient Pathways Showrunner (`widget/src/main/ancient-pathways.ts`)

HomeBot integrates natively with the local **Ancient Pathways** episodic animation showrunner:
- **Production Stepper**: 4-step UI pipeline: `Story` → `Voices` → `Animation` → `1080p Video` with celebratory video playback.
- **Autonomous Sprite Sheet Pipeline (`media_generate_sprites`)**:
  - Prompts Imagen 3 or Pollinations for 8-panel character model sheets (angles, idle poses, expressions).
  - Isolates backgrounds via Python image processing and transparent alpha masking.
  - Slices panels into structured sprite atlases with `manifest.json`.
- **Mouth Anchor Viseme Calibration (`media_measure_mouth_anchors`)**: Bridges to `learn_from_anchors.py` to calculate precise mouth anchor offsets for character lip-sync.
- **Quality Check Doctor**: IPC channel `homebot:media:ancient-pathways-doctor` audits pipeline health (shot scale gates, background isolation, script syntax).

### 5. Free-First Movie Production Engine (`widget/src/main/movie/`)

For multi-scene cinematic storytelling, HomeBot implements a free-first screenplay production router:

```
Screenplay / Project
       │
       ▼
MovieProjectRunner
       │
       ▼
GenerationRouter (Free-First Provider Cascade)
       │
       ├─► [1] Local Parallax Animation (Ancient Pathways Showrunner)  [$0.00, offline]
       ├─► [2] Colab SDXL IP-Adapter Worker (T4 GPU notebook)         [$0.00, cloud GPU]
       ├─► [3] Local SD 1.5 (Direct GPU on-device)                    [$0.00, local GPU]
       ├─► [4] Pollinations.ai (Free zero-auth fallback)              [$0.00, cloud API]
       └─► [5] Imagen 3 (Google AI Studio fallback)                   [Paid/quota API]
```

- **`GenerationRouter` (`widget/src/main/movie/router.ts`)**:
  - Evaluates per-shot screenplay requirements: character continuity, scene motion, visual style, and available compute.
  - Implements **Free-First Principle**: Prioritizes local GPU compute and zero-cost cloud workers before ever falling back to metered cloud APIs.
  - Provides dual character-consistent generation at $0.00 cost:
    1. **Immediate offline 1080p 2D animation** via Ancient Pathways Showrunner.
    2. **Deferred cloud GPU character stills** via Colab T4 SDXL IP-Adapter worker (`notebooks/colab_sdxl_ipadapter.ipynb`).
- **`MovieProjectRunner` (`widget/src/main/movie/project-runner.ts`)**:
  - Manages project execution, crash resumption, and shot state tracking (`project.json`).
  - Records per-shot routing decisions in `decision.json` and project audit logs in `logs/router-decisions.jsonl`.
- **UI & Tool Surface**: Drivable in chat via `media_produce_movie` or via the interactive movie runner UI in `MediaStudioPanel.tsx`.

---

## Telemetry and Consent

Telemetry is **opt-in only**. No data is sent remotely.

- Consent is recorded with a timestamp and version in `telemetry-consent.log`.
- If consent is granted, tool call events (name, timestamp, success/fail — no arguments) are appended to a local log file.
- The Telemetry Dashboard in Settings reads and displays this log.
- Consent can be revoked at any time in Settings, which deletes the log.
