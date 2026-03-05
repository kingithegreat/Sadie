# SADIE Architecture

This document describes the high-level architecture of SADIE: how the major components fit together, how a tool call flows through the system, and how safety and persistence are handled.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  User Desktop                                                        │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SADIE Electron Widget  (widget/)                            │   │
│  │                                                              │   │
│  │  ┌────────────────────────────────┐  ┌───────────────────┐  │   │
│  │  │  Renderer (React + TypeScript) │  │  Main Process     │  │   │
│  │  │  widget/src/renderer/          │  │  widget/src/main/ │  │   │
│  │  │                                │  │                   │  │   │
│  │  │  • Chat UI (MessageList)       │←→│  • IPC handlers   │  │   │
│  │  │  • Settings Panel              │  │  • Tool executor  │  │   │
│  │  │  • Tools Panel                 │  │  • Message router │  │   │
│  │  │  • Action Confirmation Modal   │  │  • Config manager │  │   │
│  │  └────────────────────────────────┘  └────────┬──────────┘  │   │
│  │                   ↑                           │             │   │
│  │            Preload bridge                     │             │   │
│  │         (window.electron.*)                   │             │   │
│  └──────────────────────────────────────────────┼─────────────┘   │
│                                                  │                  │
│      ┌───────────────────┐   ┌──────────────────┐│                │
│      │  Ollama (local)   │   │  n8n Orchestrator ││                │
│      │  localhost:11434  │   │  localhost:5678    ││                │
│      │                   │   │                    ││                │
│      │  qwen2.5:7b       │←──│  Workflow triggers ││               │
│      │  llava:latest     │   │  HTTP webhooks     ││               │
│      │  qwen2.5-coder:3b │   │  Scheduled jobs    ││               │
│      └───────────────────┘   └────────────────────┘│               │
│                                                      │              │
│      ┌──────────────────────────────────────────────┘              │
│      ↓                                                              │
│      Local disk: config/, memory/, logs/                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### Renderer Process (`widget/src/renderer/`)

The React UI running in Chromium. Responsibilities:

- **Chat surface** — renders message history, handles user input, shows streaming responses.
- **Action confirmation** — presents destructive or sensitive tool calls for user approval before execution.
- **Settings** — edits and persists user preferences (models, hotkey, permissions, API keys).
- **Tools Panel** — lists all registered tools grouped by category with a live search.
- **Telemetry UI** — opt-in consent flow and event dashboard (no data leaves the machine).

The renderer communicates with the main process exclusively through the preload bridge (`window.electron.*`). It never accesses Node.js APIs directly.

### Preload Bridge (`widget/src/preload/index.ts`)

The `contextBridge` layer that safely exposes a typed API surface to the renderer. Each renderer-callable function maps 1:1 to a named IPC channel. This eliminates `nodeIntegration` and keeps the renderer sandboxed.

Key bindings exposed: `sendMessage`, `saveSettings`, `loadSettings`, `listTools`, `readMemory`, `writeMemory`, `readConsentLog`, `readTelemetryEvents`, `getCalendarEvents`, `openExternal`.

### Main Process (`widget/src/main/`)

The Node.js Electron main process. Responsibilities:

- **IPC handlers** (`ipc-handlers.ts`) — receives calls from the preload bridge and routes them to the correct subsystem.
- **Message router** (`message-router.ts`) — parses user messages, detects tool intent, streams Ollama completions, executes tool calls, and returns results.
- **Config manager** — reads/writes `config/default-config.json` and the per-session settings.
- **Window manager** — manages always-on-top behaviour, global hotkey registration, and the system tray icon.

---

## Tool System

### Registration

Every tool is a TypeScript module that exports two objects:

```typescript
export const myToolDefs: ToolDefinition[] = [
  {
    name:        'my_tool',
    description: 'Does something useful',
    category:    'utility',
    parameters:  { /* JSON Schema */ },
  }
];

export const myToolHandlers: Record<string, ToolHandler> = {
  my_tool: async (args, context) => {
    // implementation
    return { success: true, result: '...' };
  }
};
```

All tool modules are imported and merged in `widget/src/main/tools/index.ts`:

```
tools/
  filesystem-tools.ts      read_file, write_file, list_directory, …
  system-tools.ts          run_command, get_system_info, …
  memory-tools.ts          read_memory, write_memory, …
  web-tools.ts             open_in_browser, browser_search, …
  email-tools.ts           email_send, email_draft, email_list
  clipboard-tools.ts       clipboard_read, clipboard_write
  search-tools.ts          search_files
  planning-tools.ts        plan_task, get_plans
  api-tool.ts              api_request
  calendar-tools.ts        get_calendar_events
  git-tools.ts             git_status, git_commit, …
  …
```

### Execution Flow

```
User types message
      │
      ▼
message-router.ts
  ├─ Sends conversation + tool list to Ollama (streaming)
  ├─ Ollama returns text or a tool_call JSON block
  │
  ├─ [text response] → stream tokens back to renderer
  │
  └─ [tool_call]
        │
        ▼
     Safety check (safety-rules.ts)
        │
        ├─ Approved → execute handler → return result to Ollama → continue
        │
        └─ Requires confirmation → send confirmation request to renderer
                │
                ▼
           ActionConfirmation modal shown to user
                │
                ├─ User approves → execute → continue
                └─ User denies  → tool_call rejected, inform model
```

### Tool Categories

| Category | Example tools |
|---|---|
| `filesystem` | `read_file`, `write_file`, `list_directory`, `delete_file`, `move_file` |
| `system` | `run_command`, `get_system_info`, `kill_process` |
| `web` | `open_in_browser`, `browser_search` |
| `email` | `email_send`, `email_draft`, `email_list` |
| `clipboard` | `clipboard_read`, `clipboard_write` |
| `memory` | `read_memory`, `write_memory`, `list_memory_keys` |
| `search` | `search_files` |
| `planning` | `plan_task`, `get_plans` |
| `utility` | `api_request`, `get_calendar_events` |
| `git` | `git_status`, `git_diff`, `git_commit` |
| `code` | `run_code_snippet` |
| `voice` | `transcribe_audio` |

---

## Safety Model

SADIE runs entirely locally — no data is sent to external servers except through explicit user-configured integrations. Safety is enforced at three layers:

### 1. Tool allowlist (`config/tool-allowlist.json`)

Defines which tools are enabled. Disabled tools are not registered and cannot be called.

### 2. Safety rules (`config/safety-rules.json`)

Contains:

- **Path whitelist** — file tools are restricted to a configurable set of directories (defaults to user home + Desktop + Downloads).
- **Command blocklist** — patterns of shell commands that are always refused.
- **Confirmation-required list** — tool names that always require explicit user approval.

### 3. API allowlist (`config/api-allowlist.json`)

The `api_request` tool can only reach a built-in set of safe public APIs plus any hostnames listed here. Requests to unlisted hosts are rejected before the HTTP call is made.

---

## Memory & Persistence

```
memory/
  json-store/     ← key-value pairs written by the write_memory tool
  cache/          ← ephemeral cache (cleared on restart)
```

Memory entries are plain JSON files keyed by a user-defined name. The `read_memory` / `write_memory` tools read and write these files. There is no database; everything is human-readable on disk.

### Settings persistence

User settings are read from and written to `config/default-config.json` via the `loadSettings` / `saveSettings` IPC channels.

---

## Telemetry & Consent

Telemetry is **opt-in only**. No data is sent remotely.

- Consent is recorded with a timestamp and version in `telemetry-consent.log`.
- If consent v1 is granted, tool call events (name, timestamp, success/fail, no arguments) are appended to a local log file.
- The Telemetry Dashboard in Settings reads and displays this log.
- Consent can be revoked at any time in Settings → Telemetry, which deletes the log.

---

## n8n Integration

n8n is an optional workflow engine that extends SADIE with scheduled tasks, external API integrations, and multi-step automations. SADIE communicates with n8n via HTTP webhooks.

The `n8n_trigger` tool sends a POST request to the configured n8n webhook URL. Workflows in `n8n-workflows/core/` define what happens next (e.g., send an email, post to Slack, call an external API and return the result).

n8n is not required for core SADIE functionality — all built-in tools work without it.

---

## Build & Packaging

```
widget/
  src/
    main/        ← Electron main process (Node.js, TypeScript)
    renderer/    ← React UI (built with Vite)
    preload/     ← Context bridge (TypeScript)
    shared/      ← Types shared between main and renderer
  electron.vite.config.ts
  electron-builder.yml    ← packager configuration
```

`npm run dev` starts Vite for the renderer with hot-reload + Electron main with nodemon-style restart.

`npm run build` compiles everything (tsc + vite build).

`npm run dist` invokes electron-builder to create a platform-specific installer (`.exe` NSIS on Windows, `.dmg` on macOS, `.AppImage` on Linux).

---

## Testing

Tests live at two levels:

| Level | Location | Runner |
|---|---|---|
| Unit (tools, router, utils) | `widget/src/__tests__/` | Jest + ts-jest |
| Integration (IPC flows) | `tests/` | Jest |
| E2E (renderer UI) | `widget/` (playwright.config.ts) | Playwright |

Run all unit and integration tests:

```powershell
cd widget
npm test
```

Run E2E tests:

```powershell
cd widget
npx playwright test
```
