# Changelog

## v0.9.5 — Model-aware prompts and memory path fix

### Fixed
- **Memory path hardcoding** (`tools/memory.ts`): JSON fallback stores (`memories.json`, `conversation-history.json`) were written to `~/Desktop/sadie/memory/json-store` unconditionally. Now uses the same dev/prod split as `memory-manager.ts`: dev → project root `memory/json-store`; packaged → Electron `userData` folder. Uses lazy `require('electron')` (with `catch` fallback) so Jest tests continue to work without the Electron binary.

### Added
- **Model-aware system prompt** (`shared/system-prompt.ts`, `message-router.ts`): `SADIE_SYSTEM_PROMPT_COMPACT` (~400 tokens) added alongside the full ~1500-token prompt. `isSmallModel()` detects <=3B models by name pattern (`:1b`, `:3b`, `phi-3`, `gemma:2b`, `tinyllama`, etc.). `getSystemPromptForModel()` selects the appropriate variant and appends user guidelines. Both `streamFromLLM` and `streamFromOllamaWithTools` now use it, giving `llama3.2:3b` ~1100 extra tokens of usable context per turn.

---

## v0.9.4 — Image UX polish and Pollinations availability cache

### Fixed
- **Progress line persists after image arrives**: `MessageBubble.tsx` now strips any line starting with `⏳ Generating image` from the text segment before the `__SADIE_IMAGE__:` token, so the finished message shows only the image (and any real caption text).

### Changed
- **Pollinations.ai availability cache** (`web.ts`): After any HTTP failure from Pollinations.ai, the result is cached for 5 minutes (`POLLINATIONS_BACKOFF_MS`). Subsequent `image_generate` calls skip the HTTPS round-trip entirely and go straight to Stable Horde. The cache clears on success so the service is transparently retried when it recovers.

---

## v0.9.3 — Image generation: Stable Horde backend, API key, progress indicator

### Fixed
- **`image_generate` permission denied**: `image_generate` was missing from `DEFAULT_SETTINGS.permissions`, causing `assertPermission` to return `false` and `executeToolBatch` to short-circuit with a permission-denied result. The stale `'n8n webhook not reachable'` default was shown because the result shape had a `.reason` field (not `.error`). Fixed both by adding `image_generate: true` to defaults and checking `r?.reason` alongside `r?.error` in the error extraction.
- **Wrong image MIME type**: `MessageBubble.tsx` hardcoded `data:image/png;base64,…` for all generated images. Stable Horde returns WebP. Fixed with magic-bytes detection (`UklGR` → `image/webp`, `/9j/` → `image/jpeg`, else `image/png`).

### Added
- **Stable Horde backend** (`web.ts`): `tryStableHorde()` submits a job to the free community-powered Stable Horde network, polls `/check/{id}` every 6 s until done, then fetches the base64 image from `/status/{id}`. Wired into `imageGenerateHandler` after Pollinations.ai in the fallback cascade.
- **Stable Horde API key setting** (`SettingsPanel.tsx`, `types.ts`, `ipc-handlers.ts`, `web.ts`): New "Image Generation" settings section with a password field for the Stable Horde API key. Without a key the anonymous queue (~60-120 s) is used; a free registered key drops generation time to ~10-20 s.
- **Image generation progress indicator** (`message-router.ts`): Sends `⏳ Generating image, please wait…` as a stream chunk immediately after the `image_generate` intent is detected, before the `executeToolBatch` call, so the UI doesn't appear frozen during Stable Horde generation.

### Changed
- **Conversation / system-prompt test fixes**: `conversationSystemPrompt` added to `handleSendMessage` `useCallback` deps (stale closure fix); `getMemoryStorePath` dev path corrected from 4 to 3 levels up; `persistence-ui.e2e.spec.ts` waits 1 s after new-chat click to let async IPC settle.
- **Test count**: 422/422 unit tests (up from 418), 12/12 E2E tests.

---

## v0.9.2 — n8n workflow activation: all 16 workflows live

### Fixed
- **All 16 n8n workflows now activate on startup**: Replaced `n8n-nodes-base.start` (ignored by
  `checkIfWorkflowCanBeActivated`) with `n8n-nodes-base.webhook` (typeVersion 1.1) as the trigger
  node in all 10 tool workflows.
- **Switch node schema mismatch** (`memory-manager`, `vision-tool`): Upgraded `n8n-nodes-base.switch`
  typeVersion 1 → 3 in both `workflow_entity` and `workflow_history`. The v1 schema's
  `getNodeParameters` threw "Could not find property option" for v3-format parameters stored in the
  DB, preventing the Workflow constructor from completing.
- **WorkflowHistoryService crash**: Added `N8N_WORKFLOW_HISTORY_ENABLED=false` to `docker-compose.yml`
  to prevent the history service from crashing on startup.

### Changed
- All 10 tool workflow source JSONs in `n8n-workflows/tools/` updated to match the working DB state
  (webhook triggers, correct Switch typeVersion).

---

## v0.9.1 — Phase 6 hardening: search refactor, docs, UX polish

### Changed
- **`web_search` provider registry** (`web.ts`): replaced the 4-branch ad-hoc cascade with a
  typed `SearchProvider` interface + `SEARCH_PROVIDERS` registry (Tavily → Serper → DDG Instant →
  DuckDuckGo → Google → Brave). Single `for` loop replaces ~80 lines of duplicated `if` blocks.
- **`isE2E` isolation fix** (`env.ts`): removed `NODE_ENV === 'test'` from the `isE2E` constant.
  The flag now only activates when `SADIE_E2E=1|true` is explicitly set (all Playwright specs
  already do this). Unit tests no longer see `isE2E=true`, so the n8n probe fires correctly →
  418/418 unit tests now pass (was 417/418 pre-existing failure).
- **Permission toggles** (`SettingsPanel.tsx`): dangerous tools (`delete_file`, `move_file`,
  `launch_app`, `screenshot`) now show a ⚠ amber icon inline in the label and render their
  description text in amber. Tooltip (`title` attr) gives hover / screen-reader context.
- **Telemetry label** (`SettingsPanel.tsx`): updated from "required, anonymous" → "anonymous,
  opt-in". A privacy hint is added below: clarifies events are stored locally only, nothing
  leaves the device, and consent can be reviewed/revoked in the Telemetry Consent Log.

### Added
- **`docs/api-reference.md`**: full reference for the IPC channel surface (~50 channels), all
  tool schemas (filesystem, web, system, memory, voice, sports/NBA, documents) with parameter
  tables and return shapes, the permission system (persistent settings, confirmation-gated tools,
  allow-once / always-allow, batch fail-fast), safety rules / path restrictions, and all shared
  TypeScript types.

### Fixed
- **E2E streaming suite** (12/12 pass): n8n probe guard, hydration race, async write-queue dedup,
  auto-title clobber, write-through cache, and inline conversation prompt — all stabilised in the
  preceding session (committed `1728ba0`).

---

## v0.9.0 — Search, Planning & API Tools

### Added
- **`search_files` tool**: Find files and folders on the local filesystem by name pattern. Uses Everything Search (`es.exe`) when available for instant results, falls back to PowerShell `Get-ChildItem -Recurse`. Supports wildcards (`*.pdf`, `report*`). Searches within the user home directory tree; path-traversal is blocked.
- **`plan_task` tool**: Break a complex goal into a numbered list of ordered steps and save the plan locally (`~/sadie-plans.json`). Call this when the user asks to "make a plan" or "what steps do I need to…". Plans survive across sessions.
- **`get_plans` tool**: Retrieve recently saved plans by ID, goal, and step count.
- **`api_request` tool**: Make HTTPS GET or POST requests to an approved allowlist of public API hosts (weather, finance, sports, GitHub, etc.). Full SSRF protection — private IPs, loopback, `.local`/`.internal` domains, non-https URLs, and non-allowlisted hosts are all blocked. The allowlist can be extended via `config/api-allowlist.json`.
- **42 new tests** covering all three tools (50 total suites / 418 tests).

### Changed
- Intent routing in `preProcessIntent` extended with patterns for file-search queries, planning requests, and plan-list queries.
- Result formatting extended with rendering for search hits (🔍), saved plans (📋), plan lists, and API responses (🌐).

---

## v0.8.1 — Synthesis Cloud Routing & Voice Button Fix

### Added
- **Synthesis cloud routing**: Web-search synthesis (web queries, surf reports, news fallback) now routes through the configured cloud LLM (`useCustomLLM` + `customLLM` settings) when active. Falls back to local Ollama when no cloud LLM is configured.

### Fixed
- **Voice mic button now always visible in Electron**: The microphone button was previously hidden because it only checked `window.SpeechRecognition` (absent in Electron's renderer). It now also checks for `electron.startSpeechRecognition` (Windows SAPI), so the button appears in all Electron builds.

### No-op
- Scheduler UI for reminders/tasks was already fully wired in v0.8.0 — no changes required.

---

## v0.8.0 — Word Documents, Code Cloud API & UI Polish

### Added
- **`create_docx` tool**: SADIE can now generate real Microsoft Word (`.docx`) files using the `docx` package. Supports `# Heading`, `## Subheading`, `### Sub-subheading`, paragraphs, and an optional document title. Files go anywhere under the home directory. Requires confirmation before writing.
- **Code cloud API routing**: Settings panel now has a "Code model — Cloud API" section. Set a provider (OpenAI / Anthropic / OpenRouter / Custom), an API key, and an optional base URL. Coding queries are automatically routed to the cloud model instead of Ollama when the key is present.
- **`qwen2.5-coder:3b` added to model picker** with "Best for your GPU" label and set as the default code model.
- **Uncensored mode amber border**: The input box gets an amber glow when uncensored mode is active (cross-component sync via `CustomEvent` bus — no prop-drilling).
- **Sidebar timestamps & message count badges**: Conversation list shows granular relative times ("just now", "5m ago", "Yesterday", weekday) and a pill badge with the message count.
- **Image thumbnail strip**: Attached images render as 72×72 cover thumbnails with an overlay × button (no filename clutter beneath).

### Fixed
- `write_file` / `codeApiKey` fields now correctly trimmed/cleaned in `handleSave` — previously the spread could leave stale values on save.
- Unused `AxiosError` and `OpenAITool` imports removed from `custom-llm-client.ts`.
- Missing `os` import added to `ipc-handlers.ts` (prevented `os.homedir()` call in telemetry path from compiling).
- Undefined `message` reference in `message-router.ts` image-caption line fixed to `request.message`.

### Removed
- Root-level temp/debug artefacts: `tmp_chat.json`, `tmp_tool_call.json`, `tmp_database.sqlite`, `execution.log.jsonl`, `run-*.json`, `tmp/`, `widget/tmp/` — none were referenced by any build step.

---

## v0.7.1 — IPC hardening, stream diagnostics & telemetry dashboard

### Added
- Local telemetry events log (`telemetry-events.log`) and an in-app **Telemetry Dashboard** (Settings → Telemetry) showing recent events and stream-failure counts. ✅
- `stream-metrics` helper script to summarize local telemetry events (`npm run stream-metrics`).

### Fixed
- Prevent crashes from duplicate `ipcMain.handle` registrations during dev/hot-reload cycles by making handler registration idempotent.
- Improved `sadie:stream-error` payloads with richer diagnostics (url, httpStatus, n8nResponded, errorText) and recorded local telemetry events for stream failures.

---

## v0.7.0 — UI Polish, Markdown Rendering & Developer Cleanup

### Added
- **Retry button** wired up: error-state assistant messages now have a functional "↻ Retry" button that re-sends the preceding user message.
- **Copy full response** button: finished assistant messages show a "📋 Copy" button that copies the entire response to clipboard with visual feedback.
- **Auto-title conversations**: the first user message automatically sets the conversation title (truncated to 40 characters) instead of "New Conversation".
- **Custom markdown renderer** in MessageBubble: fenced code blocks with copy button, inline code, bold, italic, links, headings, lists — zero external dependencies.
- **`sadie:get-env` IPC handler**: new IPC channel for retrieving environment info from the main process.

### Fixed
- **Vite dev server loading**: `window-manager.ts` now correctly loads from `ELECTRON_RENDERER_URL` in dev mode, enabling HMR and live code changes.
- **Duplicate CSS removed**: deleted ~55 lines of conflicting message-bubble overrides in `chatgpt-theme.css` that silently shrank bubbles, stripped borders/shadows, and broke text colors.

### Removed
- Dead code cleanup: removed `_appendAssistantIfMissing`, `_handleSadieReply`, `_cancelStream` (~100 lines) and all `@ts-expect-error` suppressions from `App.tsx`.

## v0.6.1 — Tool Routing Hardening and NBA Query Robustness

### Improved
- Tool routing hardening for more reliable intent-to-tool matching.
- NBA query robustness with better sports data handling.
- Serper.dev search integration (working) alongside Tavily (key-dependent).
- Search API keys UI in Settings panel.
- Web search upgraded: Tavily → Serper → DDG → Google → Brave fallback chain.
- System prompt updated for code generation support.

## v0.6.0 — Permissions & Batch Execution

### Added
- Atomic tool batch execution with preflight permission checks.
- Permission escalation flow with **Allow once** and **Always allow** options.
- Tool-level `requiredPermissions` and execution-scoped `overrideAllowed` support.

### Improved
- Prevented partial side effects when a batch contains disallowed tools.
- Standardized path resolution across Electron, Jest, and CI via `resolveUserPath`.

### Testing
- Added CI smoke coverage for permission-allowed batch execution.
- Stabilized Playwright E2E permission flow tests.
