# SADIE — Demo Script

A structured walkthrough demonstrating SADIE's core capabilities. Each section is self-contained and can be run independently.

---

## Prerequisites

Before starting the demo:

1. **Ollama** is running with `llama3.2:3b` pulled.
2. **SADIE** is launched via `npm run dev` (development) or the installed application.
3. (Optional) Docker Desktop running for n8n workflow demos.
4. (Optional) Cloud API keys configured for cloud LLM demos.

---

## Demo Sections

### 1. First Launch and Onboarding

**Goal:** Show the first-run experience.

1. Launch SADIE with a clean profile (delete `%APPDATA%/sadie` if needed).
2. The **First Run Modal** appears with setup guidance.
3. Accept the terms to proceed.
4. The modal does not appear on subsequent launches.

**Talking Points:**
- Onboarding is shown once and persisted.
- Settings are stored in the user's Electron `userData` directory.

---

### 2. Basic Chat — Local AI

**Goal:** Demonstrate offline AI conversation.

1. Type: `Hello, who are you?`
2. Observe streaming response from Ollama (`llama3.2:3b`).
3. Type: `Explain the concept of recursion in programming`
4. Observe formatted Markdown with code blocks.
5. Hover a response to see the **Copy**, **Bookmark**, and **React** buttons.

**Talking Points:**
- All inference happens locally via Ollama — no data leaves the machine.
- Responses stream token-by-token for a responsive experience.
- Markdown rendering supports code blocks, headings, lists, and inline formatting.

---

### 3. Tool System — File Operations

**Goal:** Show SADIE's tool routing and permission model.

1. Type: `Create a file called test-demo.txt with the content "Hello from SADIE"`
2. The **Permission Modal** appears requesting file-write access.
3. Click **Allow Once** (or **Always Allow**).
4. SADIE creates the file and confirms.
5. Type: `Read the file test-demo.txt`
6. SADIE reads and displays the file contents.

**Talking Points:**
- SADIE detects the user's intent and routes to the correct tool handler.
- File operations require explicit user permission (never auto-granted).
- Permission choices are remembered per-tool when "Always Allow" is selected.

---

### 4. Tool System — Web Search

**Goal:** Show real-time information retrieval.

1. Type: `Search the web for latest Electron.js release notes`
2. Observe search results presented with source URLs.

**Talking Points:**
- Web search uses a fallback chain of providers.
- Results are synthesised by the LLM into a natural language response.
- SSRF protection prevents requests to internal network addresses.

---

### 5. Tool System — Code Generation and Execution

**Goal:** Demonstrate code writing and sandboxed execution.

1. Type: `Write a Python function that calculates the Fibonacci sequence`
2. Observe the code block with syntax highlighting.
3. Type: `Run this Python code: print(sum(range(1, 101)))`
4. Permission modal appears for code execution.
5. Approve — output `5050` is displayed.

**Talking Points:**
- Code model (`qwen2.5-coder:3b`) is used for code generation.
- Code execution runs in a sandboxed environment with timeout enforcement.
- Users must approve execution of any code.

---

### 6. Computer Vision

**Goal:** Show image understanding capabilities.

1. Drag an image into the chat (or paste from clipboard).
2. Type: `Describe this image in detail`
3. Observe the vision model (llava) analysing the image.
4. Type: `What colours are dominant in this image?`

**Talking Points:**
- Vision uses the `llava` model running locally via Ollama.
- Image data never leaves the user's machine.
- Supports drag-drop, clipboard paste, and file picker.

---

### 7. Sports Intelligence — NBA

**Goal:** Demonstrate live sports data retrieval.

1. Type: `What were last night's NBA scores?`
2. Observe formatted game results with scores and status.
3. Type: `Show me all this season's NBA results in a table`
4. Observe full-season data formatted as a Markdown table.
5. Type: `When is the next Lakers game?`

**Talking Points:**
- ESPN API integration provides live scores, standings, and schedules.
- Full-season fetch uses date-range queries for complete data.
- Table formatting is detected via intent analysis ("in a table").
- Timezone-aware display shows times in the user's local zone (NZST).

---

### 8. Memory and Persistence

**Goal:** Show SADIE's memory capabilities.

1. Type: `Remember that my favourite programming language is TypeScript`
2. SADIE stores this in long-term memory.
3. Start a **new conversation** (click + in the sidebar).
4. Type: `What is my favourite programming language?`
5. SADIE recalls "TypeScript" from memory.

**Talking Points:**
- Short-term memory holds the current conversation context.
- Long-term memory persists facts across conversations.
- Memory is stored locally in JSON files — no cloud storage.

---

### 9. Reminders

**Goal:** Show the reminder system.

1. Type: `Remind me in 2 minutes to check the build`
2. SADIE confirms the reminder is set.
3. Wait 2 minutes — a toast notification appears.

**Talking Points:**
- Reminders persist across app restarts.
- Toast notifications use the Windows notification system.
- Reminder data is stored in the local persistence layer.

---

### 10. Conversation Management

**Goal:** Show sidebar and conversation features.

1. Create 3-4 conversations with different topics.
2. **Pin** a conversation (right-click → Pin).
3. **Archive** a conversation (right-click → Archive).
4. Use the **sidebar filter** to search conversations.
5. **Sort** conversations by date, name, or pinned status.
6. **Export** a conversation as JSON.

**Talking Points:**
- Conversations are automatically saved and titled.
- Pinned conversations appear at the top of the sidebar.
- Archived conversations are hidden but recoverable.
- JSON export includes all messages, metadata, and timestamps.

---

### 11. Message Features

**Goal:** Show per-message capabilities.

1. Send a message and observe the **reading time** estimate.
2. Click the **timestamp** to see the exact send time.
3. **Bookmark** a message (star icon).
4. Add a **reaction** to a message (emoji picker).
5. **Edit** a previously sent message (pencil icon).
6. Toggle **message density** (compact/comfortable) in Settings.

**Talking Points:**
- Reading time is calculated based on word count.
- Bookmarks provide quick navigation to important messages.
- Reactions use a standard emoji picker.
- Message editing re-sends to the LLM for a fresh response.

---

### 12. Themes and Appearance

**Goal:** Show SADIE's theming system.

1. Open Settings → Appearance.
2. Switch between **Dark**, **Light**, and **System** themes.
3. Observe the futuristic accent colours (cyan/magenta gradients).
4. Toggle **Focus Mode** (hides sidebar and non-essential UI).

**Talking Points:**
- Three theme modes with smooth transitions.
- Focus Mode provides a distraction-free chat experience.
- All theme preferences persist across sessions.

---

### 13. Analytics Dashboard

**Goal:** Show usage analytics.

1. Open the **Analytics Dashboard** (from the sidebar or settings).
2. View response time metrics, message counts, and tool usage.
3. Observe the telemetry consent model (opt-in only).

**Talking Points:**
- Analytics are collected locally — no data sent externally.
- Telemetry requires explicit opt-in via the consent modal.
- Dashboard provides insight into usage patterns and performance.

---

### 14. Cloud LLM Integration (Optional)

**Goal:** Show cloud model support.

1. Open Settings → LLM Provider.
2. Enter an OpenAI API key.
3. Select **GPT-4o** from the model dropdown.
4. Send a message and compare response quality.
5. Switch to **Claude Opus 4** (with Anthropic API key).

**Talking Points:**
- SADIE supports 6 cloud providers: OpenAI, Anthropic, Google, xAI, DeepSeek.
- API keys are stored encrypted locally.
- Each provider uses its native token limit from `MODEL_METADATA`.
- Cloud models are optional — Ollama works fully offline.

---

### 15. Keyboard Shortcuts

**Goal:** Show keyboard-driven workflow.

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New conversation |
| `Ctrl+/` | Open shortcuts panel |
| `Ctrl+Shift+F` | Toggle focus mode |
| `Escape` | Cancel current stream |

1. Press `Ctrl+/` to view all available shortcuts.
2. Use `Ctrl+N` to create a new conversation.
3. Toggle focus mode with `Ctrl+Shift+F`.

---

## Quick Demo (5 Minutes)

For a condensed demonstration, run sections **2**, **3**, **7**, and **12** in sequence. This covers:

- Local AI chat with streaming
- Tool routing with permission model
- Sports data retrieval
- Theme switching

---

## Test Suite Verification

After the demo, verify the test suite:

```bash
cd widget
npx jest --config jest.config.ts --no-coverage
```

Expected output: **112 suites, 1,604 tests, 0 failures**.
