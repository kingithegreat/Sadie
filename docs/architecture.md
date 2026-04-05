# SADIE Architecture

This document describes the high-level architecture of SADIE: how the major components interact, how messages and tool calls flow through the system, and how safety, persistence, and theming are handled.

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

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  User Desktop                                                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SADIE Electron Widget  (widget/)                            │   │
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
│      │  localhost:11434  │   │  localhost:5678   │|                  │
│      │                   │   │                   │|                  │
│      │  llama3.2:3b      │<──│  Workflow triggers│|                  │
│      │  qwen2.5-coder:3b │   │  HTTP webhooks   │|                  │
│      │  llava:latest     │   │                   │|                  │
│      │  dolphin-llama3:8b│   └───────────────────┘|                  │
│      └───────────────────┘                        |                  │
│                                                   |                  │
│      Local disk: config/ , memory/ , logs/  <─────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

SADIE is a multi-process Electron application. The **renderer process** (React) handles all UI interactions. The **main process** (Node.js) handles tool execution, LLM communication, file I/O, and system access. The two processes communicate exclusively through a typed **preload bridge** using Electron's `contextBridge` API.

---

## Component Details

### Renderer Process (`widget/src/renderer/`)

The React UI running inside Chromium. Key responsibilities:

- **Chat surface** — renders message history, handles user input, displays streaming token-by-token responses with cancel/retry controls.
- **Conversation sidebar** — lists conversations with timestamps, message count badges, pinning, archiving, tags, reactions, and full-text search.
- **Action confirmation** — modal dialog for approving destructive or sensitive tool calls before execution.
- **Permission modal** — prompts the user to allow-once, always-allow, or cancel when a tool requires a permission that has not yet been granted.
- **Settings panel** — edits and persists user preferences (models, hotkey, permissions, API keys, theme, notification preferences).
- **Tools panel** — lists all registered tools grouped by category with a live search filter.
- **Analytics dashboard** — visualises conversation activity and tool usage metrics.
- **Telemetry UI** — opt-in consent flow and event dashboard (no data leaves the machine).
- **Focus mode** — distraction-free full-screen chat.

The renderer communicates with the main process exclusively through the preload bridge (`window.electron.*`). It never accesses Node.js APIs directly.

### Preload Bridge (`widget/src/preload/index.ts`)

The `contextBridge` layer that safely exposes a typed API surface (`ElectronAPI`) to the renderer. Each renderer-callable function maps 1:1 to a named IPC channel. This eliminates `nodeIntegration` and keeps the renderer fully sandboxed.

Key bindings: `sendMessage`, `sendStreamMessage`, `cancelStream`, `saveSettings`, `loadSettings`, `listTools`, `loadConversations`, `createConversation`, `startSpeechRecognition`, `ttsSpeak`, `ragIndex`, `openExternal`, and 40+ additional channels.

### Main Process (`widget/src/main/`)

The Node.js Electron main process. Key responsibilities:

| Module | Purpose |
|---|---|
| `message-router.ts` | Parses user messages, detects tool intent, streams Ollama completions, executes tool batches, and returns synthesised results. Contains context budget logic for small models. |
| `ipc-handlers.ts` | Receives calls from the preload bridge and routes them to the correct subsystem. |
| `config-manager.ts` | Reads and writes `config/default-config.json` and per-session settings with schema validation. |
| `window-manager.ts` | Manages always-on-top behaviour, global hotkey registration (`Ctrl+Shift+Space`), tray icon, and window lifecycle. |
| `auto-updater.ts` | Checks for updates 5 seconds after startup via electron-updater. Sends IPC progress events to the renderer. Skipped in E2E/test mode. |
| `scheduler.ts` | Manages persistent reminders and scheduled jobs. Saves to and loads from `userData/memory/json-store/reminders.json`. |
| `webhook-auth.ts` | Generates and persists a 256-bit shared secret per install. Attaches `X-SADIE-Auth` header to all n8n POST calls. |

### Tool Handlers (`widget/src/main/tools/`)

All 20+ tools are implemented as TypeScript modules that export tool definitions and handler functions. See the [Tool System](#tool-system) section below for details.

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

| Category | Tools |
|---|---|
| `filesystem` | `read_file`, `write_file`, `list_directory`, `delete_file`, `move_file`, `search_files`, `create_directory` |
| `system` | `get_system_info`, `kill_process` |
| `web` | `web_search`, `fetch_url`, `weather`, `browser_action` |
| `vision` | `vision_describe`, `vision_query` |
| `rag` | `rag_index`, `rag_query`, `rag_list`, `rag_clear` |
| `memory` | `read_memory`, `write_memory`, `list_memory_keys`, `memorize`, `recall` |
| `planning` | `plan_task`, `get_plans` |
| `communication` | `email_send`, `email_draft`, `email_list` |
| `clipboard` | `clipboard_read`, `clipboard_write` |
| `code` | `run_code_snippet` |
| `voice` | `tts_speak`, `tts_stop`, `transcribe_audio` |
| `git` | `git_status`, `git_diff`, `git_commit` |
| `utility` | `api_request`, `get_calendar_events`, `generate_sports_report`, `image_generate`, `generate_document` |

### Execution Flow

```
User types message
      |
      v
message-router.ts
  |-- Sends conversation history + tool definitions to Ollama (streaming)
  |-- Ollama returns text or a tool_call JSON block
  |
  |-- [text response] --> stream tokens back to renderer
  |
  |-- [tool_call]
        |
        v
     Permission precheck (executeToolBatch)
        |
        |-- All permissions granted --> safety check --> execute handler
        |                                                    |
        |                                       return result to Ollama
        |                                       (up to MAX_TOOL_ROUNDS=10)
        |
        |-- Missing permissions --> send permission request to renderer
                |
                v
           Permission modal shown to user
                |
                |-- Allow once  --> execute with overrideAllowed
                |-- Always allow --> persist permission, then execute
                |-- Cancel      --> tool_call rejected, inform model
```

### Context Budget for Small Models

Models with 3B parameters or fewer (detected by `isSmallModel()`) receive scaled-down context injection:

| Parameter | Small Model | Full-Size Model |
|---|---|---|
| History turns | 12 | 50 |
| Digest cap | 500 characters | Unlimited |
| Memory recall cap | 300 characters | Unlimited |
| System prompt | Compact (~400 tokens) | Full (~1,500 tokens) |

This prevents silent context overflow on 4,096-token models like `llama3.2:3b`.

---

## Safety Model

SADIE runs entirely locally. No data is sent to external servers except through explicit user-configured cloud LLM integrations. Safety is enforced at multiple layers:

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
- `sadie:open-file` and `sadie:show-in-folder` restrict paths to user home directory
- `webviewTag: false` — no webview elements
- Preload `invoke()` gated behind `isE2E()` check

### Layer 6: Webhook Authentication (`webhook-auth.ts`)

A 256-bit secret is generated per install and persisted to disk. All HTTP requests to n8n include `X-SADIE-Auth` header. n8n workflows validate this header via an Auth Guard Code node.

### Layer 7: Tool Recursion Cap

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

User settings are read from and written to `config/default-config.json` via the `loadSettings` / `saveSettings` IPC channels.

### Reminder Persistence

Scheduled reminders are saved to `userData/memory/json-store/reminders.json` and reloaded on app restart via `scheduler.ts`.

---

## Cloud LLM Integration

SADIE supports optional cloud LLM routing for enhanced capabilities:

### Code Cloud API

Coding queries (detected by `CODING_QUERY_PATTERN`) are automatically routed to a configured cloud provider when an API key is present. Supported providers:

- **OpenAI** (GPT-4, GPT-4o, GPT-4o Mini)
- **Anthropic** (Claude Opus 4, Claude Sonnet 4, Claude 3.5 Haiku)
- **OpenRouter** (100+ models via single API)
- **Custom** (any OpenAI-compatible endpoint, including LM Studio, LocalAI, vLLM)

### Embedded Web Services

ChatGPT, Claude, and Gemini are accessible directly inside SADIE via sandboxed `BrowserWindow` panels. Each panel uses correct Chrome User-Agent, `allowpopups`, and a preload script that clears `navigator.webdriver` to bypass Cloudflare bot-detection. Login and interaction works normally with existing subscriptions.

### Model Metadata

`MODEL_METADATA` in `shared/constants.ts` contains token limits, pricing tiers, and capabilities for all supported cloud models. The message router uses `maxTokens` from metadata instead of hardcoded values.

---

## Theming and UI Architecture

### Theme System

SADIE supports three theme modes: **light**, **dark**, and **system** (follows OS preference).

- Themes are implemented via CSS custom properties (`--bg-*`, `--accent-*`, `--text-*`) with `[data-theme]` selectors.
- 15+ CSS keyframe animations: `headerScan`, `titleShimmer`, `connectedGlow`, `msgSlideIn`, `avatarRingSpin`, `voiceNeonPulse`, `welcomeFloat`, `activeCardGlow`, and more.
- Glass morphism effects on settings panel and modals.
- `@media (prefers-reduced-motion: reduce)` disables all animations for accessibility.

### Custom Markdown Renderer

Chat messages are rendered with a custom Markdown renderer supporting fenced code blocks with copy buttons, inline formatting (bold, italic, strikethrough), links, headings, and lists.

### Streaming UI

Responses are displayed token-by-token in real time. Users can cancel mid-stream or retry failed messages.

---

## Build and Packaging

SADIE uses **electron-vite** as its build system (not Webpack).

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
| `npm run dev` | Start Vite dev server (renderer HMR) + Electron main process |
| `npm run build` | Compile everything (TypeScript + Vite build) |
| `npm run dist` | Create platform-specific installer via electron-builder |

The Windows installer is an NSIS `.exe` with per-user install, directory chooser, and desktop/start-menu shortcuts.

---

## Testing Architecture

Tests live at two levels:

| Level | Location | Runner | Count |
|---|---|---|---|
| Unit (tools, router, utils) | `widget/src/main/__tests__/` | Jest + ts-jest | 70+ suites |
| Unit (renderer components) | `widget/src/renderer/__tests__/` | Jest + React Testing Library | 25+ suites |
| E2E (full application) | `widget/src/renderer/e2e/` | Playwright | 12+ scenarios |

**Total: 112 suites, 1,604 unit tests.**

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

## Telemetry and Consent

Telemetry is **opt-in only**. No data is sent remotely.

- Consent is recorded with a timestamp and version in `telemetry-consent.log`.
- If consent is granted, tool call events (name, timestamp, success/fail — no arguments) are appended to a local log file.
- The Telemetry Dashboard in Settings reads and displays this log.
- Consent can be revoked at any time in Settings, which deletes the log.
