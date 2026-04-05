# SADIE — System Architecture Diagrams

Detailed visual representations of the SADIE system architecture, data flow, and security model.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Electron Shell                          │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │   Renderer    │   │   Preload    │   │   Main Process     │  │
│  │  (React 18)   │◄─►│  (Bridge)    │◄─►│   (Node.js)        │  │
│  │              │   │              │   │                    │  │
│  │  Chat UI     │   │  IPC Allow-  │   │  Tool Router       │  │
│  │  Settings    │   │  list Gate   │   │  LLM Orchestrator  │  │
│  │  Analytics   │   │  Schema      │   │  Safety Pipeline   │  │
│  │  Themes      │   │  Validation  │   │  Memory/Persist    │  │
│  └──────────────┘   └──────────────┘   └────────┬───────────┘  │
│                                                  │              │
│                                    ┌─────────────┼──────────┐   │
│                                    │             │          │   │
│                              ┌─────▼───┐  ┌─────▼───┐  ┌──▼─┐ │
│                              │  Ollama  │  │  Cloud   │  │n8n │ │
│                              │  Local   │  │  LLMs    │  │    │ │
│                              │  Models  │  │  (API)   │  │    │ │
│                              └─────────┘  └─────────┘  └────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Process Architecture

SADIE follows Electron's multi-process model with strict isolation:

```
┌──────────────────────────────────┐
│        Renderer Process          │
│  (Chromium sandbox, no Node.js)  │
│                                  │
│  React 18 + Vite HMR            │
│  Components, hooks, state        │
│  CSS themes (dark/light/system)  │
│  No direct access to filesystem  │
│  No direct access to network     │
└───────────┬──────────────────────┘
            │ IPC (contextBridge)
            │ Allowlisted channels only
┌───────────▼──────────────────────┐
│         Preload Script           │
│  (contextIsolation: true)        │
│                                  │
│  Exposes typed API to renderer   │
│  Validates channel names         │
│  Validates message schemas       │
│  Blocks unapproved IPC calls     │
└───────────┬──────────────────────┘
            │ ipcMain handlers
┌───────────▼──────────────────────┐
│         Main Process             │
│  (Full Node.js access)           │
│                                  │
│  Tool execution engine           │
│  LLM provider orchestration      │
│  Permission & safety checks      │
│  File system operations          │
│  Network requests (HTTP client)  │
│  Memory and persistence layer    │
│  Auto-update manager             │
│  System tray & global hotkey     │
└──────────────────────────────────┘
```

---

## Tool Execution Flow

Every tool invocation follows this pipeline:

```
User Message
    │
    ▼
┌────────────────┐
│ Intent Detection│  ← Regex + keyword matching
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Tool Selection  │  ← toolRegistry.ts mapping
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Permission Check│  ← requiredPermissions vs user grants
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Input Validation│  ← JSON schema validation
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Safety Pipeline │  ← 7-layer filter chain
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Tool Execution  │  ← Handler invoked with validated args
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Output Sanitise │  ← Response cleaned before display
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ LLM Synthesis  │  ← Natural language response generation
└────────────────┘
```

---

## Security Layer Model

Seven layers of defence, applied in order:

```
Layer 1  ┌──────────────────────────────┐
         │   Profanity / Toxicity       │  Block harmful language
         └──────────────┬───────────────┘
Layer 2  ┌──────────────▼───────────────┐
         │   Harm Detection             │  Block self-harm, violence
         └──────────────┬───────────────┘
Layer 3  ┌──────────────▼───────────────┐
         │   PII Redaction              │  Strip personal identifiers
         └──────────────┬───────────────┘
Layer 4  ┌──────────────▼───────────────┐
         │   Prompt Injection Guard     │  Detect jailbreak attempts
         └──────────────┬───────────────┘
Layer 5  ┌──────────────▼───────────────┐
         │   Tool-Abuse Prevention      │  Recursion cap, rate limits
         └──────────────┬───────────────┘
Layer 6  ┌──────────────▼───────────────┐
         │   Output Sanitisation        │  XSS, HTML stripping
         └──────────────┬───────────────┘
Layer 7  ┌──────────────▼───────────────┐
         │   Audit Logging              │  All actions logged
         └──────────────────────────────┘
```

---

## Data Flow — Chat Message

```
User types message
        │
        ▼
Renderer: ChatInput component
        │ (React state)
        ▼
Renderer: sendMessage()
        │ (IPC invoke)
        ▼
Preload: contextBridge.exposeInMainWorld
        │ (channel allowlist check)
        ▼
Main: ipcMain.handle('chat:send')
        │
        ├──► Safety pipeline (7 layers)
        │
        ├──► Intent detection
        │        │
        │        ├── Tool detected → Tool execution pipeline
        │        │                        │
        │        │                        ▼
        │        │                   Tool result
        │        │                        │
        │        └── No tool → Direct LLM prompt
        │
        ▼
LLM Provider (Ollama local / Cloud API)
        │ (streaming tokens)
        ▼
Main: Stream chunks to renderer
        │ (IPC send)
        ▼
Renderer: ChatMessage component
        │ (Markdown rendering)
        ▼
User sees response
```

---

## Memory and Persistence

```
┌─────────────────────────────────┐
│      Memory Architecture        │
│                                 │
│  ┌───────────────────────────┐  │
│  │   Short-Term Memory       │  │
│  │   (Conversation context)  │  │
│  │   - Message sliding window│  │
│  │   - Context budget tokens │  │
│  └───────────┬───────────────┘  │
│              │                  │
│  ┌───────────▼───────────────┐  │
│  │   Long-Term Memory        │  │
│  │   (JSON store)            │  │
│  │   - Key-value facts       │  │
│  │   - Named memories        │  │
│  │   - Semantic search       │  │
│  └───────────┬───────────────┘  │
│              │                  │
│  ┌───────────▼───────────────┐  │
│  │   Persistent Storage      │  │
│  │   (Disk: userData)        │  │
│  │   - Conversations         │  │
│  │   - Reminders             │  │
│  │   - Settings / preferences│  │
│  │   - Analytics data        │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

---

## Cloud LLM Integration

```
┌──────────────┐     ┌───────────────────┐
│  LLM Router  │────►│  Ollama (local)   │  Default, offline
│              │     └───────────────────┘
│  Selects     │     ┌───────────────────┐
│  provider    │────►│  OpenAI           │  GPT-4o, GPT-4o Mini
│  based on    │     └───────────────────┘
│  user config │     ┌───────────────────┐
│              │────►│  Anthropic        │  Claude Opus 4, Sonnet 4, Haiku 3.5
│              │     └───────────────────┘
│              │     ┌───────────────────┐
│              │────►│  Google           │  Gemini 2.5 Pro / Flash
│              │     └───────────────────┘
│              │     ┌───────────────────┐
│              │────►│  xAI              │  Grok-3
│              │     └───────────────────┘
│              │     ┌───────────────────┐
│              │────►│  DeepSeek         │  DeepSeek V3
└──────────────┘     └───────────────────┘
```

Each provider uses its native max-token limit from `MODEL_METADATA` (no hardcoded fallbacks). API keys are stored encrypted in the user's Electron `userData` directory and never sent to any server other than the configured provider.

---

## Testing Architecture

```
┌──────────────────────────────────────────┐
│              Test Suite                   │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Unit Tests (Jest)                 │  │
│  │  112 suites │ 1,604 tests          │  │
│  │                                    │  │
│  │  Main process:                     │  │
│  │    Tool handlers, safety pipeline, │  │
│  │    LLM orchestration, persistence, │  │
│  │    intent detection, permissions   │  │
│  │                                    │  │
│  │  Renderer:                         │  │
│  │    React components, hooks, state, │  │
│  │    theme switching, keyboard       │  │
│  │    shortcuts, analytics dashboard  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  E2E Tests (Playwright)            │  │
│  │  Multi-flow scenarios              │  │
│  │                                    │  │
│  │  Full application lifecycle,       │  │
│  │  chat interactions, tool routing,  │  │
│  │  persistence across restarts       │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Electron over web app** | Offline-first privacy, direct filesystem access, system tray integration |
| **Ollama for local AI** | No cloud dependency, user data stays on device, free inference |
| **electron-vite over Webpack** | Faster builds, native ESM support, HMR for renderer |
| **TypeScript strict mode** | Catch errors at compile time, enforce API contracts |
| **IPC allowlist** | Principle of least privilege for renderer ↔ main communication |
| **7-layer safety model** | Defence in depth; no single point of failure for content safety |
| **JSON-based persistence** | Human-readable, no database dependency, git-friendly |
| **Context budget system** | Prevent small models (3B–8B params) from exceeding token limits |
