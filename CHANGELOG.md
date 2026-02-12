# Changelog

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
