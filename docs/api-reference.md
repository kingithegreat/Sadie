# HomeBot API Reference

This document describes the full public surface of HomeBot: the IPC channels exposed through the preload bridge, the tool schemas the LLM may call, and the permission model that gates tool execution.

---

## Contents

1. [Preload Bridge (`window.electron`)](#1-preload-bridge-windowelectron)
2. [IPC Channel Reference](#2-ipc-channel-reference)
3. [Tool Schemas](#3-tool-schemas)
4. [Permission System](#4-permission-system)
5. [Safety Rules & Path Restrictions](#5-safety-rules--path-restrictions)
6. [Shared Types](#6-shared-types)

---

## 1. Preload Bridge (`window.electron`)

The renderer process communicates with the main process exclusively through the context-isolated preload bridge. Every method maps 1:1 to a named IPC channel. The full TypeScript type is `ElectronAPI` (`widget/src/shared/types.ts`).

### Messaging

| Method | Description |
|---|---|
| `sendMessage(request: HomeBotRequest): Promise<HomeBotResponse>` | Send a single non-streaming message and receive a complete response. |
| `sendStreamMessage(request: HomeBotRequestWithImages & { streamId?: string }): Promise<void>` | Start a streaming conversation turn. The request may include `images[]`, `documents[]`, `modelOverride`, and `retry`. Chunks arrive via `onStreamChunk`. |
| `cancelStream(streamId?: string): void` | Cancel an in-progress stream. Omitting `streamId` cancels all active streams. |

### Stream Events

| Method | Event fired | Payload |
|---|---|---|
| `onStreamChunk(cb)` | `homebot:stream-chunk` | `{ streamId?: string; chunk: string }` |
| `onStreamEnd(cb)` | `homebot:stream-end` | `{ streamId?: string; cancelled?: boolean }` |
| `onStreamError(cb)` | `homebot:stream-error` | `{ streamId?: string; error?: string; message?: string; details?: string; diagnostic?: any; recoveryHint?: any }` |
| `subscribeToStream(streamId, handlers)` | all three above | filtered by `streamId` |

### Confirmation & Permission Modals

| Method | Description |
|---|---|
| `onConfirmationRequest(cb)` | Fires when a tool requires explicit user approval. Payload: `{ confirmationId, message, streamId }`. |
| `sendConfirmationResponse(id, confirmed)` | Reply to a confirmation request. |
| `onPermissionRequest(cb)` | Fires when a tool requires a permission the user hasn't granted. Payload: `{ requestId, missingPermissions, reason, streamId? }`. |
| `sendPermissionResponse(id, decision, missingPermissions?)` | Reply with `'allow_once'`, `'always_allow'`, or `'cancel'`. |

### Settings

| Method | Returns | Description |
|---|---|---|
| `getSettings()` | `Promise<Settings>` | Read current user settings. |
| `saveSettings(partial)` | `Promise<Settings>` | Merge and persist a partial settings update. |
| `resetPermissions()` | `Promise<Settings>` | Reset all tool permissions to their defaults. |
| `hasPermission(toolName)` | `Promise<{ success, allowed? }>` | Check whether a specific named permission is currently granted. |

### Telemetry & Consent

| Method | Description |
|---|---|
| `exportTelemetryConsent()` | Write a consent-snapshot JSON to `logs/` and return its path. |
| `readConsentLog()` | Read the raw `telemetry-consent.log` content. |
| `readTelemetryEvents()` | Read all locally-stored telemetry events. |

### Conversations & Memory

| Method | Description |
|---|---|
| `loadConversations()` | Load the full conversation store. |
| `getConversation(id)` | Fetch a single conversation by ID. |
| `createConversation(title?)` | Create and persist a new conversation. |
| `saveConversation(conv)` | Save (overwrite) a conversation. |
| `deleteConversation(id)` | Delete a conversation. |
| `setActiveConversation(id \| null)` | Mark the active conversation. |
| `addMessage(convId, message)` | Append a message to a conversation. |
| `updateMessage(convId, msgId, updates)` | Patch a message. |

### System Utilities

| Method | Description |
|---|---|
| `checkConnection()` | Probe n8n and Ollama reachability. Returns `{ n8n, ollama, lastChecked }`. |
| `getMode()` | Returns `{ demo: boolean }`. |
| `getEnv()` | Returns `{ isE2E, isPackagedBuild, isReleaseBuild, userDataPath }`. |
| `getConfigPath()` | Absolute path to the active `config.json`. |
| `listTools()` | List all registered tools with name, description, and category. |
| `openFile(path)` | Open a file with the system default application. |
| `showInFolder(path)` | Reveal a file in the system file explorer. |
| `exportChat(markdown)` | Write chat history markdown to the Desktop; returns `{ success, path? }`. |
| `writeClipboard(text)` | Write text to the system clipboard. |
| `openExternalUrl(url)` | Open a URL in the system default browser. Protocol-validated (http/https only). |
| `minimizeWindow()` | Minimize the widget window. |
| `closeWindow()` | Close the widget window. |
| `restartApp()` | Restart the Electron process. |

### Voice & TTS

| Method | Description |
|---|---|
| `startSpeechRecognition()` | Start Windows SAPI offline speech recognition. Returns `{ success, text }`. |
| `ttsSpeak(text, rate?)` | Speak text aloud via system TTS. |
| `ttsStop()` | Stop current TTS playback. |

### Hardware & Model Management

| Method | Returns | Description |
|---|---|---|
| `detectGpuVram()` | `Promise<{ vramGB: number \| null, gpuName: string \| null }>` | Detect GPU VRAM via PowerShell `Win32_VideoController`. Used for model selector warnings and first-run hardware profiling. |
| `onOllamaStatus(cb)` | `() => void` (unsubscribe) | Fires on Ollama connectivity change. Payload: `{ online: boolean, url: string, autoRestarting?: boolean }`. Heartbeat checks every 30s. |
| `onModelFallback(cb)` | `() => void` (unsubscribe) | Fires at startup when the configured chat model is not installed and a fallback was selected. Payload: `{ from: string, to: string }`. |

### Uncensored Mode

| Method | Description |
|---|---|
| `getUncensoredMode()` | Returns `{ enabled: boolean }`. |
| `setUncensoredMode(enabled)` | Toggle uncensored mode; persisted to settings. |

### Scheduler

| Method | Description |
|---|---|
| `schedulerList()` | List all scheduled jobs. |
| `schedulerAdd(input)` | Add a scheduled job. |
| `schedulerRemove(id)` | Remove a job by ID. |
| `schedulerToggle(id, enabled)` | Enable or disable a job. |

### MCP Servers

| Method | Description |
|---|---|
| `mcpListServers()` | List configured MCP servers. |
| `mcpGetStatus()` | Get connection status of all MCP servers. |
| `mcpAddServer(config)` | Add a new MCP server definition. |
| `mcpRemoveServer(name)` | Remove an MCP server by name. |
| `mcpToggleServer(name, enabled)` | Enable or disable an MCP server. |

---

## 2. IPC Channel Reference

The table below lists every named IPC channel. Direction: **R→M** = renderer sends / main handles; **M→R** = main pushes to renderer.

### Request/Response (invoke)

| Channel | Dir | Description |
|---|---|---|
| `homebot:send-message` | R→M | Non-streaming chat message. |
| `homebot:get-settings` | R→M | Read current settings. |
| `homebot:save-settings` | R→M | Merge-save settings. Returns `{ success, data }`. |
| `homebot:reset-permissions` | R→M | Reset all tool permissions. |
| `homebot:has-permission` | R→M | Check a named permission. |
| `homebot:export-consent` | R→M | Export consent snapshot. |
| `homebot:read-consent-log` | R→M | Read consent log file. |
| `homebot:read-telemetry-events` | R→M | Read telemetry events. |
| `homebot:list-custom-llm-models` | R→M | Probe a custom LLM endpoint for available models. |
| `homebot:check-connection` | R→M | Probe n8n + Ollama health. |
| `homebot:get-mode` | R→M | Returns `{ demo }`. |
| `homebot:get-env` | R→M | Returns runtime env flags. |
| `homebot:get-config-path` | R→M | Returns config file path. |
| `homebot:list-tools` | R→M | Returns registered tool list. |
| `homebot:get-uncensored-mode` | R→M | Returns `{ enabled }`. |
| `homebot:set-uncensored-mode` | R→M | Toggle uncensored mode. |
| `homebot:read-debug-logs` | R→M | Read renderer + main log buffers (dev only). |
| `homebot:capture-logs` | R→M | Write log snapshot to disk. |
| `homebot:open-file` | R→M | Open file with OS default app. |
| `homebot:show-in-folder` | R→M | Reveal file in explorer. |
| `homebot:export-chat` | R→M | Export markdown chat to Desktop. |
| `homebot:restart-app` | R→M | Restart the process. |
| `homebot:tts-speak` | R→M | TTS speak. |
| `homebot:tts-stop` | R→M | TTS stop. |
| `homebot:start-speech-recognition` | R→M | Windows SAPI recognition. |
| `homebot:scheduler-list` | R→M | List jobs. |
| `homebot:scheduler-add` | R→M | Add job. |
| `homebot:scheduler-remove` | R→M | Remove job. |
| `homebot:scheduler-toggle` | R→M | Toggle job. |
| `homebot:load-conversations` | R→M | Load conversation store. |
| `homebot:get-conversation` | R→M | Get single conversation. |
| `homebot:create-conversation` | R→M | Create conversation. |
| `homebot:save-conversation` | R→M | Save conversation. |
| `homebot:delete-conversation` | R→M | Delete conversation. |
| `homebot:set-active-conversation` | R→M | Set active conversation. |
| `homebot:add-message` | R→M | Append message. |
| `homebot:update-message` | R→M | Patch message. |
| `homebot:mcp-list-servers` | R→M | List MCP servers. |
| `homebot:mcp-get-status` | R→M | MCP connection status. |
| `homebot:mcp-add-server` | R→M | Add MCP server. |
| `homebot:mcp-remove-server` | R→M | Remove MCP server. |
| `homebot:mcp-toggle-server` | R→M | Toggle MCP server. |
| `homebot:detect-gpu-vram` | R→M | Detect GPU VRAM (PowerShell). Returns `{ vramGB, gpuName }`. |
| `homebot:open-external-url` | R→M | Open URL in system browser (http/https only). |
| `homebot:automation:image:generate` | R→M | Generate image via SD/cloud. |

### Fire-and-forget (send)

| Channel | Dir | Payload | Description |
|---|---|---|---|
| `homebot:stream-message` | R→M | `HomeBotRequestWithImages & { streamId?: string }` | Start streaming turn with optional image/document attachments, model override, and retry metadata. |
| `homebot:stream-cancel` | R→M | `{ streamId? }` | Cancel stream. |
| `homebot:confirmation-response` | R→M | `{ confirmationId, confirmed }` | User confirmation reply. |
| `homebot:permission-response` | R→M | `{ requestId, decision, missingPermissions? }` | User permission reply. |
| `window-minimize` | R→M | — | Minimize window. |
| `window-close` | R→M | — | Close window. |

### Main → Renderer (push)

| Channel | Payload | Description |
|---|---|---|
| `homebot:reply` | `HomeBotResponse` | Non-streaming reply. |
| `homebot:stream-chunk` | `{ streamId, chunk }` | One streaming token chunk. |
| `homebot:stream-end` | `{ streamId, cancelled? }` | Stream completed or cancelled. |
| `homebot:stream-error` | `{ streamId, error, message?, details?, diagnostic?, recoveryHint? }` | Stream error. `recoveryHint` may instruct the renderer to start Ollama, pull a missing model, retry, or reattach a document. |
| `homebot:confirmation-request` | `{ confirmationId, message, streamId }` | Dangerous tool needs approval. |
| `homebot:permission-request` | `{ requestId, missingPermissions, reason, streamId? }` | Tool needs a permission grant. |
| `homebot:show-window` | — | Show / focus widget. |
| `homebot:hide-window` | — | Hide widget. |
| `homebot:reminder-fired` | `{ message, label }` | A scheduled reminder fired. |
| `homebot:ollama-status` | `{ online, url, autoRestarting? }` | Ollama heartbeat state change (every 30s check). |
| `homebot:model-fallback` | `{ from, to }` | Configured model not installed; auto-switched to fallback. |
| `homebot:router-log` | `string` | Diagnostic log line from message router (dev / E2E only). |
| `homebot:append-renderer-log` | `string` | Renderer log forwarded to main for persistence. |

---

## 3. Tool Schemas

Tools are JSON-Schema typed objects callable by the LLM during a conversation turn. `required` parameters must always be supplied; optional parameters have defaults noted below.

Tools marked **⚠ Requires confirmation** present an approval modal before execution. Tools marked **🔒 Permission required** will trigger the permission modal if the matching setting is not enabled.

---

### Filesystem

#### `list_directory`
List the contents of a directory.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | ✓ | — | Directory path to list. |
| `showHidden` | boolean | | `false` | Include hidden files. |

**Returns:** Array of entries with `name`, `type`, `size`, `modified`.

---

#### `read_file`
Read the text content of a file.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | ✓ | — | File path. |
| `maxLines` | number | | `100` | Maximum lines to read. |

**Returns:** `{ content: string, lines: number, truncated: boolean }`

---

#### `write_file` ⚠
Write or append content to a file.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | ✓ | — | Destination file path. |
| `content` | string | ✓ | — | Content to write. |
| `append` | boolean | | `false` | Append instead of overwrite. |

---

#### `create_directory`
Create a new directory. The path **must** include the new folder name.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Full path including new folder name (e.g. `Desktop/myfolder`). |

---

#### `copy_file`
Copy a file or directory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | string | ✓ | Source path. |
| `destination` | string | ✓ | Destination path. |

---

#### `move_file` ⚠
Move or rename a file or directory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | string | ✓ | Source path. |
| `destination` | string | ✓ | Destination path. |

---

#### `delete_file` ⚠
Delete a file or directory.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | ✓ | — | Path to delete. |
| `recursive` | boolean | | `false` | Delete directories recursively. |

---

#### `get_file_info`
Get metadata for a file or directory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | File or directory path. |

**Returns:** `{ name, size, created, modified, type, extension }`

---

#### `search_files`
Find files by name pattern within an allowed directory.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `directory` | string | ✓ | — | Root directory to search. |
| `pattern` | string | ✓ | — | Glob or substring pattern. |
| `maxResults` | number | | `20` | Max results returned. |

---

#### `create_docx` ⚠
Create a formatted `.docx` Word document. Markdown headings (`#`, `##`, `###`), bullet lists (`-`, `*`), and tables (`| col | col |`) are supported.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Output `.docx` path (e.g. `Desktop/report.docx`). |
| `title` | string | ✓ | Document title (rendered as H1). |
| `content` | string | ✓ | Markdown-formatted body text. |

---

#### `create_spreadsheet` ⚠
Create an `.xlsx` Excel spreadsheet.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Output `.xlsx` path. |
| `title` | string | ✓ | Sheet title. |
| `content` | string | ✓ | Tab-separated or CSV-formatted data. |

---

#### `create_pdf` ⚠
Create a `.pdf` document from Markdown content.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Output `.pdf` path. |
| `title` | string | ✓ | Document title. |
| `content` | string | ✓ | Markdown body text. |

---

### Web

#### `web_search`
Search the web. Automatically tries providers in order: Tavily → Serper → DDG Instant → DuckDuckGo → Google → Brave. Results are cached for 10 minutes.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | ✓ | — | Search query. Include dates when time-sensitive. |
| `maxResults` | number | | `5` | Maximum results (max 10). |
| `fetchResultCount` | number | | `3` | Top results to fetch full content from (max 5). |
| `fetchTopResult` | boolean | | `true` | Auto-fetch content from top result. |

**Returns:** `{ results: [{title, url, snippet}], sources: [{url, title, content}], answer? }`

**API keys (optional, set via Settings):**
- `TAVILY_API_KEY` — enables Tavily (highest quality). Falls back to free providers if absent.
- `SERPER_API_KEY` — enables Serper (second priority). Falls back if absent.

---

#### `fetch_url`
Fetch and extract the text content of a URL. Private/local addresses are blocked (SSRF protection).

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | ✓ | — | Must start with `http://` or `https://`. |
| `maxLength` | number | | `5000` | Maximum characters to return. |

**Returns:** `{ content: string, url: string, truncated: boolean }`

**Blocked:** `file://`, `localhost`, `127.x.x.x`, `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`, and other RFC-1918 ranges.

---

#### `get_weather`
Get current weather using wttr.in (no API key required).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `location` | string | ✓ | City name or location (e.g. `"London"`, `"New York"`). |

**Returns:** Formatted weather report string.

---

#### `image_generate`
Generate an image from a text prompt. Auto-detects available backends: local Stable Diffusion WebUI (`localhost:7860`), ComfyUI (`localhost:8188`), DALL-E 3 (requires `OPENAI_API_KEY`), Pollinations.ai, or Stable Horde fallback.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | ✓ | — | Image description. |
| `width` | number | | `512` | Image width (px). |
| `height` | number | | `512` | Image height (px). |
| `steps` | number | | `20` | Sampling steps. |
| `provider` | string | | `'auto'` | `'sd'`, `'comfyui'`, `'dalle3'`, or `'auto'`. |

---

### System

#### `get_system_info`
Return system hardware and software information.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `category` | string | | `'all'` — or one of `'cpu'`, `'memory'`, `'disk'`, `'os'`, `'network'`. |

---

#### `get_clipboard`
Read the current clipboard text.

_(No parameters.)_

---

#### `set_clipboard`
Write text to the clipboard.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | string | ✓ | Text to write. |

---

#### `open_url`
Open a URL in the default system browser.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✓ | URL to open (must be `http://` or `https://`). |

---

#### `launch_app` 🔒
Launch a desktop application by name or executable path.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `app` | string | ✓ | Application name (e.g. `"Notepad"`) or executable path. |

**Required permission:** `launch_app` must be enabled in Settings → Permissions.

---

#### `calculate`
Evaluate a mathematical expression.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `expression` | string | ✓ | Math expression (e.g. `"(12 * 8) / 4"`). |

---

#### `screenshot` 🔒
Capture a screenshot of the screen.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `monitor` | number | | `0` | Monitor index. |
| `format` | string | | `'png'` | Output format (`'png'` or `'jpg'`). |

**Required permission:** `screenshot` must be enabled in Settings → Permissions.

---

#### `get_current_time`
Return the current date and time.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `timezone` | string | | IANA timezone string (e.g. `"America/New_York"`). Defaults to system timezone. |

---

### Memory

#### `remember`
Persist a named fact in long-term memory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | ✓ | Memory key/name. |
| `value` | string | ✓ | Value to store. |

---

#### `recall`
Retrieve a value from long-term memory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | ✓ | Memory key to look up. Supports substring match. |

---

#### `forget` ⚠
Delete a memory entry.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | ✓ | Memory key to delete. |

---

#### `list_memories`
List all stored memory keys.

_(No parameters.)_

---

#### `save_conversation`
Save the current conversation to persistent storage.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | | Optional title for the conversation. |

---

#### `get_conversation_history`
Retrieve conversation history.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | number | | `50` | Max messages to return. |
| `conversationId` | string | | current | Specific conversation ID. |

---

#### `clear_conversation_history` ⚠
Clear the message history of a conversation.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string | | Defaults to the current conversation. |

---

### Voice

#### `speak`
Speak text aloud using the system TTS engine.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | ✓ | — | Text to speak. |
| `rate` | number | | `1.0` | Speech rate (0.5 – 2.0). |
| `voice` | string | | system default | Voice name from `get_voices`. |

---

#### `stop_speaking`
Stop any current TTS playback.

_(No parameters.)_

---

#### `get_voices`
List available TTS voices on this machine.

_(No parameters.)_

---

### Sports / NBA

#### `nba_query`
Query live NBA data including scores, standings, team rosters, and player stats.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✓ | Natural language query (e.g. `"Warriors score tonight"`, `"NBA standings"`). |
| `team` | string | | Team abbreviation to focus on (e.g. `"GSW"`, `"LAL"`). |

**Data source:** ESPN public API (no key required).

---

#### `generate_sports_report` 🔒
Generate a formatted sports report and save it as a file.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sport` | string | ✓ | Sport type (e.g. `"nba"`, `"nfl"`). |
| `team` | string | | Team filter. |
| `outputPath` | string | | Where to save the report. Defaults to Desktop. |

**Required permission:** `write_file`.

---

### Documents

#### `parse_document`
Parse document content from a base64-encoded file payload.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `data` | string | ✓ | Base64-encoded file content. |
| `mimeType` | string | ✓ | MIME type (e.g. `"application/pdf"`, `"application/vnd.openxmlformats-officedocument.wordprocessingml.document"`). |

---

#### `parse_document_from_path`
Parse a document by file path.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Absolute path to the file. |

---

#### `get_document_content`
Alias for `parse_document_from_path` — convenience wrapper.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Absolute path to the file. |

---

#### `list_documents`
List readable documents in a directory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `directory` | string | ✓ | Directory to scan. |

---

#### `search_document`
Search for a text pattern within a document.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Document path. |
| `query` | string | ✓ | Search term. |

---

### Terminal

#### `run_terminal_command` ⚠
Execute a shell command in a terminal and return stdout/stderr. Use for build tools, package managers, test runners, docker, git, and general CLI tasks.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `command` | string | ✓ | — | The shell command to execute (e.g. `"npm test"`, `"docker compose up -d"`). Max 2048 chars. |
| `cwd` | string | | current dir | Working directory (absolute path, must be inside user home). |
| `timeout` | number | | `60` | Timeout in seconds (max 120). |

**Returns:** `{ command, cwd, exit_code, stdout, stderr }`

**Safety:** Blocked patterns include `rm -rf /`, `format C:`, `dd of=/dev/sda`, `shutdown`, `reboot`, fork bombs, and registry deletion. Working directory must exist and be within the user's home directory. Output is truncated to 16 KB per stream. ANSI color codes are suppressed.

**Aliases:** `terminal`, `shell`, `exec`

---

#### `get_terminal_history`
Get the last N commands that were executed via `run_terminal_command` this session.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | number | | `10` | Number of recent commands to return (max 50). |

**Returns:** `{ count, total_session_commands, history: [{command, cwd, exitCode, stdoutPreview, timestamp}] }`

---

### Codebase

#### `grep_code`
Search file contents by regex pattern across a project directory. Returns matching lines with file paths and line numbers. Skips `node_modules`, `.git`, `dist`, `build`, and binary files automatically.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `pattern` | string | ✓ | — | Regex pattern (e.g. `"function handleSubmit"`, `"TODO:"`, `"import.*React"`). |
| `directory` | string | | current dir | Root directory to search (absolute path). |
| `file_pattern` | string | | all text files | Glob filter (e.g. `"*.ts"`, `"*.{js,jsx,ts,tsx}"`). |
| `case_sensitive` | boolean | | `false` | Case-sensitive search. |
| `max_results` | number | | `50` | Max matches to return (max 200). |
| `context_lines` | number | | `0` | Context lines before/after each match (max 5). |

**Returns:** `{ pattern, directory, case_sensitive, match_count, matches: [{file, line, text, context?}] }`

**Engine:** Uses `ripgrep` (rg) when available for speed, falls back to Node.js recursive search. Invalid regex patterns fall back to literal string matching.

**Aliases:** `grep`, `search_code`

---

#### `project_tree`
Get a directory tree structure for a project. Shows files and folders in a visual tree format.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `directory` | string | | current dir | Root directory (absolute path). |
| `max_depth` | number | | `4` | Max traversal depth (max 8). |
| `show_files` | boolean | | `true` | Show files (`true`) or only directories (`false`). |
| `file_pattern` | string | | all files | Only show files matching this pattern (e.g. `"*.ts"`). |
| `max_items` | number | | `200` | Max total items to include (max 500). |

**Returns:** `{ directory, total_items, tree }` where `tree` is a formatted string with Unicode box-drawing characters.

**Aliases:** `tree`

---

#### `analyze_file`
Get a quick overview of a source file: language, line count, imports, exported symbols, function/class names, and the first comment block.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_path` | string | ✓ | Absolute path to the source file. |

**Returns:** `{ file, path, language, lines, size_bytes, imports, exports, symbols, first_comment }`

**Supported languages:** TypeScript, JavaScript, Python, Rust, Go, Java, Ruby, PHP, C, C++, C#, Swift, Kotlin, Scala, HTML, CSS, SCSS, LESS, JSON, YAML, TOML, XML, Markdown, SQL, Shell, PowerShell, Batch, Vue, Svelte.

---

### Git

#### `git_status`
Show the working tree status of a git repository.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `repo_path` | string | | HomeBot project root | Absolute path to the git repository. |

**Returns:** `{ branch, staged, unstaged, untracked, clean }`

---

#### `git_log`
Show recent commit history for a repository.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `repo_path` | string | | HomeBot project root | Absolute path to the repository. |
| `limit` | number | | `10` | Number of commits to return (max 50). |
| `branch` | string | | `HEAD` | Branch to inspect. |

**Returns:** `{ branch, count, commits: [{hash, author, email, date, message}] }`

---

#### `git_diff`
Show the diff between the working tree and HEAD (or between two commits/branches). Output truncated to 8 KB.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `repo_path` | string | | HomeBot project root | Absolute path to the repository. |
| `target` | string | | `"unstaged"` | `"staged"`, `"unstaged"`, a file path, or a ref like `"HEAD~1"`. |

**Returns:** `{ diff, truncated, total_chars }`

---

#### `git_branches`
List local (and optionally remote) branches.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `repo_path` | string | | HomeBot project root | Absolute path to the repository. |
| `include_remote` | boolean | | `false` | Include remote tracking branches. |

**Returns:** `{ current, branches: [{name, hash, upstream, current}] }`

---

#### `git_commit` ⚠
Stage all changes and create a git commit.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `repo_path` | string | | HomeBot project root | Absolute path to the repository. |
| `message` | string | ✓ | — | Commit message (max 200 chars). |
| `stage_all` | boolean | | `true` | Stage all tracked changes before committing. |

**Returns:** `{ message, output }`

---

### News

#### `get_news`
Fetch the latest headlines from a news RSS feed.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `source` | string | | `"bbc"` | Source key (`bbc`, `reuters`, `techcrunch`, `hacker_news`, `ars_technica`, `npr`, `guardian`, `espn`) or a full RSS URL. |
| `limit` | number | | `10` | Max headlines (max 30). |
| `topic_filter` | string | | — | Optional keyword to filter headlines (case-insensitive). |

**Returns:** `{ source, count, items: [{title, link, published, summary}] }`

---

#### `list_news_feeds`
List all built-in news feed sources and descriptions.

_(No parameters.)_

---

## 4. Permission System

HomeBot uses a two-layer permission model at tool execution time.

### 4.1 Settings Permissions (persistent)

Stored in the user's `config.json` under `permissions`. Toggleable from **Settings → Permissions**. Defaults:

| Permission key | Default | Controls |
|---|---|---|
| `write_file` | `false` | Creating/writing/overwriting files |
| `delete_file` | `false` | Deleting files or directories |
| `move_file` | `false` | Moving or renaming files |
| `launch_app` | `false` | Launching desktop applications |
| `screenshot` | `false` | Capturing screen content |
| `run_command` | `false` | Running shell commands |
| `kill_process` | `false` | Terminating processes |
| `email_send` | `false` | Sending emails via Outlook |
| `git_commit` | `false` | Creating git commits |

### 4.2 Requires-Confirmation (per-tool)

Some tools always pause for explicit approval regardless of the permissions above. This catches dangerous operations that warrant a one-time human review:

- `delete_file`, `move_file`, `write_file`, `create_docx`, `create_spreadsheet`, `create_pdf`
- `forget` (memory deletion)
- `clear_conversation_history`
- `git_commit`
- `run_terminal_command`
- `kill_process`, `email_send`

When the confirmation modal appears, the user chooses **Approve** or **Cancel**. There is no "always allow" path for confirmation-gated tools.

### 4.3 Allow Once / Always Allow

For permission-gated (but not confirmation-gated) tools, the permission modal offers:

| Choice | Effect |
|---|---|
| **Allow once** | Grants the permission only for this execution. Not persisted. |
| **Always allow** | Adds the permission to the user's persistent settings. |
| **Cancel** | Rejects the tool call; the LLM is informed the operation was denied. |

### 4.4 Batch Execution and Fail-Fast

`executeToolBatch()` performs a preflight permission check across all tools in a batch before executing any of them. If any tool is missing a required permission the entire batch returns `{ status: 'needs_confirmation', missingPermissions }` — no side-effects occur. The router then prompts the user once and retries with `overrideAllowed` if the user chooses Allow once / Always allow.

---

## 5. Safety Rules & Path Restrictions

Defined in `config/safety-rules.json`.

### Allowed Directories (file tools)

By default, file tools (`read_file`, `write_file`, `list_directory`, etc.) are restricted to:

- `~/Documents`
- `~/Desktop`
- `~/Downloads`

Paths outside this set are rejected before execution. The allowlist is configurable.

### Blocked Directories (always)

| Path | Reason |
|---|---|
| `C:\Windows` | System files |
| `C:\Program Files`, `C:\Program Files (x86)` | Installed software |
| `C:\ProgramData` | Shared apps data |
| `%APPDATA%` | User application data |

### Blocked File Extensions

`.exe`, `.dll`, `.sys`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.com`, `.scr`, `.msi`

### Confirmation-Required Operations (file)

| Operation | Requires confirmation |
|---|---|
| `delete` | Yes |
| `execute` | Yes |
| `move` | No (permission instead) |
| `write` | No (permission instead) |

### System Commands

Only an explicit allowlist of read-only PowerShell commands may be used without confirmation (`Get-Process`, `Get-ComputerInfo`, `Get-Disk`, etc.). Destructive commands (`Stop-Process`, `Remove-Item`, `Format-Volume`, etc.) are blocked unconditionally.

### Network / URL Safety

- `fetch_url` and `web_search` reject private network addresses (RFC-1918, loopback) before any HTTP call.
- `api_request` may only reach hosts in `config/api-allowlist.json` plus `localhost` / `127.0.0.1`.
- Max file size for uploads: **50 MB**. Max email attachment: **25 MB**.

---

## 6. Shared Types

Key TypeScript types from `widget/src/shared/types.ts`:

```typescript
interface HomeBotRequest {
  message: string;
  conversation_id?: string;
  user_id?: string;
  streamId?: string;
}

interface HomeBotRequestWithImages extends HomeBotRequest {
  images?: string[];          // base64-encoded image strings
  attachments?: Attachment[]; // file attachments
}

interface HomeBotResponse {
  success: boolean;
  data?: any;
  error?: boolean;
  message?: string;
  details?: string;
  response?: string;
}

interface Settings {
  ollamaUrl: string;
  n8nUrl: string;
  model: string;
  codeModel?: string;
  telemetryEnabled: boolean;
  telemetryConsentVersion?: string;
  permissions: Record<string, boolean>;
  hotkey?: string;
  uncensoredMode?: boolean;
  tavilyApiKey?: string;
  serperApiKey?: string;
  openaiApiKey?: string;
  defaultNbaTeam?: string;
}

interface StoredConversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
  toolResult?: any;
}

type MemoryResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

interface ConnectionStatus {
  n8n: 'online' | 'offline' | 'checking';
  ollama: 'online' | 'offline' | 'checking';
  lastChecked: string;
}
```

---

## Appendix — Complete surface

<!-- BEGIN GENERATED: surface-index -->

> Generated by `scripts/check-docs-drift.mjs`. Do not edit by hand —
> `npm run docs:check` fails when this drifts from the source. The curated
> sections above explain the important APIs; this is the complete list, so
> nothing exists that the reference does not mention.

**Preload methods (175)** — `window.electron`

```
addMessage                browserAttach             browserBack               browserBounds
browserCapture            browserDetach             browserForward            browserNavigate
browserReload             cancelStream              captureLogs               captureScreen
changesDiff               changesList               checkConnection           checkOllamaInstalled
clearPermissionAudit      closeWindow               compactConversation       createAutomation
createConversation        deleteAutomation          deleteConversation        deleteOllamaModel
detectGpuVram             downloadOllama            downloadUpdate            executeImageGenerate
exportChat                exportConversation        exportPermissionAudit     exportSettings
exportTelemetryConsent    fetchPageContent          generateQuiz              generateQuizFromRag
generateTitle             getAnalyticsSummary       getBatchSummaries         getCapabilityReport
getConfigPath             getConversation           getCrmActivity            getCrmDashboard
getEnv                    getGeneratedImage         getMode                   getPerfAggregates
getPerfHistory            getSettings               getSupervisorStatus       getUncensoredMode
getWidgetMode             hasPermission             importSettings            installUpdate
invoke                    licenseActivate           licenseDeactivate         licenseStatus
licenseValidate           listCustomLLMModels       listOllamaModels          listTools
loadAutomations           loadConversations         loadQuizProgress          maximizeWindow
mcpAddServer              mcpGetStatus              mcpListServers            mcpRemoveServer
mcpToggleServer           mediaAdvance              mediaApprove              mediaCreate
mediaDelete               mediaList                 mediaMarkPublished        mediaParseFeed
mediaReject               mediaRun                  minimizeWindow            onAssistantToolActivity
onBatchSummary            onBrowserState            onConfigRecovered         onConfirmationRequest
onConversationCompacted   onHardwareProfileApplied  onHideWindow              onMessage
onModelFallback           onNavigate                onOllamaDownloadProgress  onOllamaStatus
onPermissionRequest       onProactiveBriefing       onPullModelProgress       onReminderFired
onSdCppSetupProgress      onShowWindow              onStreamChunk             onStreamEnd
onStreamError             onSupervisorStatus        onTerminalExit            onTerminalOutput
onTitleUpdated            onUpdateAvailable         onUpdateDownloaded        onUpdateProgress
onWidgetModeChanged       openExternalUrl           openFile                  parseDocument
pullModel                 pullModelStream           ragClear                  ragIndex
ragList                   readConsentLog            readDebugLogs             readPermissionAudit
readTelemetryEvents       removeHideWindowListener  removeShowWindowListener  resetPermissions
resolveActiveModel        restartApp                runAutomation             runDiagnostics
saveConversation          saveQuizProgress          saveSettings              schedulerAdd
schedulerList             schedulerRemove           schedulerToggle           sdCppAutoSetup
sdCppSetup                sdCppStatus               searchConversations       sendConfirmationResponse
sendMessage               sendPermissionResponse    sendStreamMessage         setActiveConversation
setAlwaysOnTop            setUncensoredMode         showInFolder              skillsList
skillsOpenFolder          startOllama               startSpeechRecognition    subscribeToStream
summarizeWebContent       terminalClose             terminalCreate            terminalKill
terminalRun               testN8nConnection         toggleWidgetMode          ttsListVoices
ttsSampleVoice            ttsSpeak                  ttsStop                   updateAutomation
updateMessage             workspaceList             workspaceRead             workspaceRoot
workspaceSave             writeClipboard            writeDocument
```

**IPC channels, renderer → main (127)**

```
homebot:__e2e_get_router_logs         homebot:__e2e_invoke_tool_batch
homebot:__e2e_ping                    homebot:__e2e_trigger_upstream_error
homebot:add-message                   homebot:append-renderer-log
homebot:automation:image:generate     homebot:browse-status
homebot:capability-report             homebot:capture-logs
homebot:capture-screen                homebot:changes-diff
homebot:changes-list                  homebot:check-connection
homebot:check-ollama-installed        homebot:clear-permission-audit
homebot:compact-conversation          homebot:confirmation-response
homebot:create-automation             homebot:create-conversation
homebot:delete-automation             homebot:delete-conversation
homebot:delete-ollama-model           homebot:detect-gpu-vram
homebot:download-ollama               homebot:download-update
homebot:export-chat                   homebot:export-consent
homebot:export-conversation           homebot:export-permission-audit
homebot:export-settings               homebot:fetch-page-content
homebot:generate-quiz                 homebot:generate-quiz-from-rag
homebot:generate-title                homebot:get-analytics-summary
homebot:get-config-path               homebot:get-conversation
homebot:get-env                       homebot:get-generated-image
homebot:get-mode                      homebot:get-perf-aggregates
homebot:get-perf-history              homebot:get-settings
homebot:get-uncensored-mode           homebot:get-widget-mode
homebot:grab-browse-content           homebot:has-permission
homebot:import-settings               homebot:install-update
homebot:license:activate              homebot:license:deactivate
homebot:license:status                homebot:license:validate
homebot:list-custom-llm-models        homebot:list-ollama-models
homebot:list-tools                    homebot:load-automations
homebot:load-conversations            homebot:load-quiz-progress
homebot:mcp-add-server                homebot:mcp-get-status
homebot:mcp-list-servers              homebot:mcp-remove-server
homebot:mcp-toggle-server             homebot:media:advance
homebot:media:approve                 homebot:media:create
homebot:media:delete                  homebot:media:list
homebot:media:mark-published          homebot:media:parse-feed
homebot:media:reject                  homebot:media:run
homebot:message                       homebot:n8n-test-connection
homebot:open-browse                   homebot:open-external-url
homebot:open-file                     homebot:open-web-service
homebot:parse-document                homebot:permission-response
homebot:pull-model                    homebot:pull-model-stream
homebot:rag-clear                     homebot:rag-index
homebot:rag-list                      homebot:read-consent-log
homebot:read-debug-logs               homebot:read-permission-audit
homebot:read-telemetry-events         homebot:reset-permissions
homebot:resolve-active-model          homebot:restart-app
homebot:run-automation                homebot:run-diagnostics
homebot:save-conversation             homebot:save-quiz-progress
homebot:save-settings                 homebot:scheduler-add
homebot:scheduler-list                homebot:scheduler-remove
homebot:scheduler-toggle              homebot:sd-cpp:auto-setup
homebot:sd-cpp:setup                  homebot:sd-cpp:status
homebot:search-conversations          homebot:set-active-conversation
homebot:set-always-on-top             homebot:set-uncensored-mode
homebot:show-in-folder                homebot:skills-list
homebot:skills-open-folder            homebot:start-ollama
homebot:start-speech-recognition      homebot:stream-cancel
homebot:stream-message                homebot:summarize-web-content
homebot:toggle-widget-mode            homebot:tts-list-voices
homebot:tts-sample-voice              homebot:tts-speak
homebot:tts-stop                      homebot:update-automation
homebot:update-message                homebot:web-service-status
homebot:write-document
```

**IPC channels, main → renderer (30)**

```
homebot:assistant-tool-activity   homebot:batch-summary
homebot:config-recovered          homebot:confirmation-request
homebot:conversation-compacted    homebot:hardware-profile-applied
homebot:model-fallback            homebot:n8n-status
homebot:ollama-download-progress  homebot:ollama-status
homebot:permission-request        homebot:proactive-briefing
homebot:pull-model-progress       homebot:reminder-fired
homebot:reply                     homebot:router-log
homebot:sd-cpp:setup-progress     homebot:stream-chunk
homebot:stream-end                homebot:stream-error
homebot:stream-start              homebot:stream-ttfb
homebot:supervisor-status         homebot:title-updated
homebot:tool-call                 homebot:tool-result
homebot:update-available          homebot:update-downloaded
homebot:update-progress           homebot:widget-mode-changed
```

<!-- END GENERATED: surface-index -->
