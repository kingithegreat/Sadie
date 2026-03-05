# Changelog

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
