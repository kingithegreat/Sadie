# SADIE — Copilot Handoff & Issue Tracker

> Generated 2026-05-01 from full codebase audit.  
> **Build**: ✅ Clean | **Tests**: ✅ 118 suites, 1861 passing | **TS Errors**: 6 real (production code)

---

## 1. Project Overview

**SADIE** is an Electron desktop AI assistant with a dark/gold "cyber" aesthetic. It connects to local Ollama LLMs and an optional n8n backend for tool orchestration, with support for cloud LLM providers (OpenAI, Anthropic, Groq, DeepSeek, etc.).

### Tech Stack
- **Electron** (Chromium 130+) with `electron-vite` bundler
- **React 18** (renderer), plain TypeScript (main/preload)
- **Ollama** for local LLM inference
- **n8n** for backend workflow orchestration (webhooks)
- **Jest** + `@testing-library/react` for tests (120 test files)
- **CSS** — single monolithic theme file using oklch color functions, CSS container queries, glassmorphism

### Architecture
```
widget/src/
├── main/               # Electron main process
│   ├── index.ts         # App entry, window creation, global shortcuts
│   ├── ipc-handlers.ts  # All IPC handle() registrations (1292 lines)
│   ├── message-router.ts # LLM routing logic — Ollama/Custom/Code API (4987 lines, LARGEST FILE)
│   ├── custom-llm-client.ts # Cloud LLM streaming (OpenAI/Anthropic/etc)
│   ├── memory-manager.ts # Conversation persistence (JSON file store)
│   ├── config-manager.ts # Settings read/write
│   ├── moa.ts           # Mixture of Agents
│   └── tools/           # 12+ tool modules (web, filesystem, codebase, calendar, etc.)
├── renderer/            # React UI
│   ├── App.tsx           # Root component, state management (1229 lines)
│   ├── components/
│   │   ├── ChatInterface.tsx
│   │   ├── MessageBubble.tsx   # Message rendering + error UX
│   │   ├── InputBox.tsx        # Chat input with attachments
│   │   ├── StatusIndicator.tsx # Header bar (brand, status, model, mode switcher)
│   │   ├── ModelSelector.tsx   # Model picker with prev/next nav
│   │   ├── SettingsPanel.tsx   # Settings modal (1767 lines)
│   │   ├── ConversationSidebar.tsx
│   │   ├── ImageGenerator.tsx  # Image generation panel
│   │   ├── DocumentViewer.tsx  # Document viewer/converter
│   │   └── ... (lazy-loaded panels: Tools, RAG, Analytics, etc.)
│   └── styles/
│       ├── chatgpt-theme.css   # MASTER THEME (5483 lines)
│       └── global.css          # Animations, drop zones
├── preload/
│   └── index.ts         # IPC bridge (568 lines, exposes window.electron)
└── shared/
    └── types.ts         # Shared TypeScript interfaces
```

### Key Files by Size (production only)
| File | Lines | Notes |
|------|-------|-------|
| `message-router.ts` | 4987 | LLM routing, tool execution, streaming — **needs refactoring** |
| `chatgpt-theme.css` | 5483 | Monolithic CSS — consider splitting |
| `SettingsPanel.tsx` | 1767 | All settings UI in one component |
| `web.ts` (tools) | 1400 | Web search, scrape, API tools |
| `ipc-handlers.ts` | 1292 | All IPC registrations |
| `App.tsx` | 1229 | Root state, layout, event wiring |

---

## 2. TypeScript Errors (Production Code) — 6 Real Issues

### 2.1 `Settings.widgetHotkey` not on type (but it IS on the interface)
**File**: `src/main/index.ts:250`  
**Error**: `Property 'widgetHotkey' does not exist on type 'Settings'`  
**Context**: `const hotkey = settings.globalHotkey || settings.widgetHotkey || 'Ctrl+Shift+Space';`  
**Root cause**: `Settings` interface has `widgetHotkey: string` (line 129 of types.ts), but `globalHotkey` is NOT on the interface. The code references `settings.globalHotkey` which doesn't exist in the type.  
**Fix**: Add `globalHotkey?: string;` to the `Settings` interface, or remove the `globalHotkey` reference and just use `widgetHotkey`.

### 2.2 Implicit `any` from index expression
**File**: `src/main/ipc-handlers.ts:672`  
**Error**: `Element implicitly has an 'any' type because index expression is not of type 'number'`  
**Context**: `const conv = conversations[id];` — `conversations` is typed as `StoredConversation[]` (array) but accessed with a string key.  
**Root cause**: The analytics handler reads the raw JSON store and treats `conversations` as a `Record<string, ...>` but the type says it's an array.  
**Fix**: Type the raw store correctly as `{ conversations: Record<string, StoredConversation> }` or use `.find()`.

### 2.3 `Message.createdAt` doesn't exist
**File**: `src/main/memory-manager.ts:516`  
**Error**: `Property 'createdAt' does not exist on type 'Message'`  
**Context**: `...(msg.createdAt ? { createdAt: msg.createdAt } : {})`  
**Root cause**: The `Message` interface in `types.ts` has `timestamp: string` but not `createdAt`. The memory manager uses `createdAt` which was likely intended to be `timestamp`.  
**Fix**: Either add `createdAt?: string` to the `Message` interface, or change the code to use `msg.timestamp`.

### 2.4 `SadieRequest` missing `user_id`
**File**: `src/renderer/components/DocumentViewer.tsx:140`  
**Error**: `Argument of type '{ message: string; conversation_id: string; }' is not assignable to parameter of type 'SadieRequest'. Property 'user_id' is missing.`  
**Context**: `await window.electron.sendMessage({ message: ..., conversation_id: '__doc_export__' })`  
**Fix**: Add `user_id: 'local'` to the call, or make `user_id` optional in `SadieRequest`.

### 2.5 `CustomLLMConfig.provider` type too narrow
**File**: `src/renderer/components/SettingsPanel.tsx:113`  
**Error**: `Type '"huggingface" | "cerebras" | "sambanova" | "together"'` not assignable to the narrower union.  
**Root cause**: `codeApiProvider` in Settings uses the full provider union (includes huggingface, cerebras, sambanova, together), but the `SettingsPanel` local state initializes `codeApiProvider` with a type derived from `CustomLLMConfig.provider` which includes those values — but the Settings type for `codeApiProvider` was narrower.  
**Actual issue**: Looking at `types.ts:157`, `codeApiProvider` on `Settings` already has the full union. The error is that the local variable type in SettingsPanel doesn't match. The `codeApiProvider` field is initialized from `source.codeApiProvider || 'openai'` and inferred as the wider union from CustomLLMConfig.  
**Fix**: Ensure SettingsPanel's local state type for `codeApiProvider` matches the `Settings` interface exactly, or cast it.

### 2.6 Unused imports/variables in production code (TS6133 — minor)
- `ChatInterface.tsx:26` — `inputBoxRef` declared but never read  
- `ConversationSidebar.tsx:1` — `useMemo` imported but never used  
- `documents.ts:137` — `rowNum` declared but never read  

---

## 3. Runtime / Functional Issues

### 3.1 Model Selector Nav Buttons May Not Work
**File**: `src/renderer/components/ModelSelector.tsx:159-186`  
**Symptom**: Clicking ◀/▶ buttons in the header doesn't cycle models.  
**Root cause candidates**:
1. **`-webkit-app-region: drag`** on `.app-header` was swallowing clicks on nested elements. **Partially fixed** — added `no-drag` to `.model-selector` CSS. But if Electron's drag region implementation doesn't respect nested `no-drag` on deeply nested buttons, the model-nav-btn clicks still won't register.
2. **Empty `allModels` array** — if `listOllamaModels` IPC fails or returns empty, `allModels.length === 0` causes the handlers to `return` immediately with no user feedback.
3. **Model ID mismatch** — Ollama reports models as e.g. `llama3.3:70b` but settings may store `llama-3.3-70b`. The `findIndex` at line 159 does exact string match `m.id === currentModel`, so `currentIndex` becomes `-1`. The cycling still works (falls back to first/last), but the display name may not match.

**Suggested fix**: 
- Add `-webkit-app-region: no-drag` to `.model-nav-btn` explicitly
- Add fuzzy model matching (strip `:` and `-` for comparison)
- Show a toast when `allModels` is empty ("No models found — is Ollama running?")

### 3.2 Image Generation — No Backends Available (Expected)
**File**: `src/main/ipc-handlers.ts:219-322`  
**Not a bug** — the image generator tries 5 backends in order:
1. n8n webhook (`/webhook/sadie/image-generate`)
2. AUTOMATIC1111 (`127.0.0.1:7860`)
3. ComfyUI (`127.0.0.1:8188`)
4. Stability AI (needs `STABILITY_API_KEY` env var)
5. OpenAI DALL-E (needs `OPENAI_API_KEY` env var)

If none are configured, the "No image generation backends available" message is correct.

### 3.3 n8n Connection Issues
**Symptom**: N8N status dot shows yellow/offline.  
**Check**: n8n must be running at the URL specified in Settings (default `http://localhost:5678`). The app pings `/webhook/sadie/health` to check. Many SADIE tools (automation, web search routing, image gen) depend on n8n workflows being deployed.

### 3.4 `onExportChat` Prop Unused in StatusIndicator
**File**: `src/renderer/components/StatusIndicator.tsx:35`  
**Status**: Aliased to `_onExportChat` to suppress the TS warning. The export chat button was intentionally removed from the header during the UI redesign. The prop could be removed from the interface if export chat is permanently gone, or re-added as a subtle button if needed.

---

## 4. CSS / UI Issues

### 4.1 Monolithic CSS File (5483 lines)
`chatgpt-theme.css` contains ALL styles for the entire app. Consider splitting into:
- `tokens.css` (design system variables)
- `layout.css` (header, sidebar, grid)
- `messages.css` (bubbles, markdown, code blocks)
- `panels.css` (settings, tools, image gen, docs)
- `components.css` (buttons, inputs, selects, tooltips)

### 4.2 Duplicate/Conflicting CSS Rules
- `.send-button` is defined at line ~1415 AND had a conflicting override at ~3237 (now cleaned up, but watch for regression)
- `.message-avatar.assistant` is defined twice (lines ~531 and ~3229)
- `.input-container` is defined twice (lines ~434 and ~1291)
- Several `.status-dot` definitions exist (header inline status vs custom LLM status)

### 4.3 Light Theme Incomplete
`[data-theme="light"]` overrides exist (line ~3895) but they only cover base tokens, code blocks, tables, and links. Many component-specific styles (toasts, error cards, context menus, model dropdown, image generator) will look broken in light mode because they use hardcoded oklch dark values.

### 4.4 CSS Anchor Positioning (lines ~2990-3020)
Uses `position-anchor`, `anchor()` functions — these are only supported in Chromium 125+. While Electron 130 supports them, the tooltip code doesn't appear to be used anywhere in the React components (no `anchor` attribute usage found).

---

## 5. Test Issues (Non-Critical)

### 5.1 Worker Process Leak
```
A worker process has failed to exit gracefully and has been force exited.
This is likely caused by tests leaking due to improper teardown.
```
Shows on every test run. Likely a timer or open handle in one of the tool tests.

### 5.2 Unused Variables in Tests (22 instances)
All `TS6133` — declared variables that are never read. Mostly test setup boilerplate (`noop`, `noopAsync`, unused destructured imports). Cosmetic only.

### 5.3 One Real Test Type Error
`src/main/__tests__/moa.test.ts:245` — `Object is of type 'unknown'`. Needs a type assertion.

---

## 6. Architecture Concerns

### 6.1 `message-router.ts` is 4987 Lines
This single file handles:
- LLM streaming (Ollama, Custom, Code API routing)
- Tool call parsing and execution
- Intent detection (coding queries, image requests, web searches)
- System prompt construction
- Conversation history management
- Think-tag stripping
- Error recovery with hints

**Recommendation**: Split into `llm-router.ts`, `tool-executor.ts`, `intent-detector.ts`, `prompt-builder.ts`.

### 6.2 No State Management Library
`App.tsx` (1229 lines) manages ALL application state via `useState` hooks. Settings, messages, conversations, connection status, UI panels — all live in one component. Consider React Context or Zustand.

### 6.3 Settings Type Drift
The `Settings` interface has 30+ fields but the `SettingsPanel` accesses many via `(source as any).fieldName` (lines 116-120), indicating fields that exist at runtime but aren't in the type definition:
- `calendarIcsUrl`
- `notificationsEnabled`, `notificationSound`, `notificationDuration`
- `messageDensity`

These should be added to the `Settings` interface.

### 6.4 Preload Bridge is ~568 Lines
Every new IPC channel requires changes in 3 places: `ipc-handlers.ts`, `preload/index.ts`, and the renderer component. Consider generating the bridge or using a typed IPC pattern.

---

## 7. Missing Features / Gaps

| Feature | Status | Notes |
|---------|--------|-------|
| Image Generation | Backend required | Needs AUTOMATIC1111, ComfyUI, or API keys |
| Light theme | Partial | Base tokens work, many components don't adapt |
| Keyboard shortcuts | Panel exists | Some shortcuts may not be wired to actions |
| Notifications | UI exists | Toast + bell + history panel — working |
| RAG | Panel exists | Requires n8n workflow |
| MoA (Mixture of Agents) | Code exists | `moa.ts` — needs multiple models installed |
| Web Services panel | UI exists | Requires API keys for each service |
| Morning Briefing | Code exists | Weather + calendar on first message of day |

---

## 8. Environment & Build

```bash
# Dev
cd widget && npx electron-vite dev

# Build
npx electron-vite build

# Test
npx jest --config jest.config.ts --no-coverage

# Type check
npx tsc --noEmit

# Package for distribution
npx electron-builder   # (config in package.json or electron-builder.yml)
```

### Dependencies to have running:
- **Ollama** (`ollama serve` or Ollama Desktop) — required for local LLM
- **n8n** (optional) — required for tool orchestration, automation, image gen via webhooks

### Key env vars:
- `OLLAMA_URL` — override Ollama endpoint (default: `http://localhost:11434`)
- `LOCAL_SD_ENDPOINT` — AUTOMATIC1111 URL (default: `http://127.0.0.1:7860`)
- `COMFY_ENDPOINT` — ComfyUI URL (default: `http://127.0.0.1:8188`)
- `STABILITY_API_KEY` — Stability AI for cloud image gen
- `OPENAI_API_KEY` — OpenAI for DALL-E image gen

---

## 9. Recent Git History

```
c259fb0 feat: premium UI redesign — design system, glassmorphism, accessibility, image generator styling
e20ecea feat: cloud vision, title gen routing, per-conversation model override
fcce288 fix: model selector unclickable — app-region drag was swallowing clicks
3f55e8e fix: model selector and custom LLM provider support
fb670ef feat: 6 UX improvements — auto-compact, search jump, shortcuts, notifications, wizard, backup
04803fb feat: conversation compaction — archive older messages, keep recent context
51a57b5 feat: daily quote and joke on welcome screen
92cfbe8 feat: document viewer panel, XLSX reading, dead code cleanup, v1.1.0
8cc0c9b feat: MCP retry + timeout, shutdown on quit, installer build, progress report update
6ded1a1 feat: custom avatars, weather follow-up guard, doc updates
```

---

## 10. Priority Fix List (Ordered)

1. **Add missing fields to `Settings` interface** — `globalHotkey`, `calendarIcsUrl`, `notificationsEnabled`, `notificationSound`, `notificationDuration`, `messageDensity` (eliminates 3+ TS errors and `as any` casts)
2. **Add `createdAt?: string` to `Message` interface** — eliminates TS2339 in memory-manager
3. **Make `user_id` optional in `SadieRequest`** or always pass it — fixes DocumentViewer TS error
4. **Fix model selector click reliability** — add `-webkit-app-region: no-drag` to `.model-nav-btn` CSS, add fuzzy model ID matching
5. **Fix SettingsPanel provider type** — align `codeApiProvider` local state type with the `Settings` interface union
6. **Complete light theme** — extend `[data-theme="light"]` overrides to error cards, toasts, context menus, model dropdown, image generator
7. **Split `message-router.ts`** — 4987 lines is unmaintainable; extract tool execution, intent detection, prompt building
8. **Fix test worker leak** — find the timer/handle causing "worker process has failed to exit gracefully"
