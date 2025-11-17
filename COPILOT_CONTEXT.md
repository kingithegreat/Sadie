# COPILOT_CONTEXT.md

**SADIE - Structured AI Desktop Intelligence Engine**  
**Master Context File for GitHub Copilot**

---

## 🎯 Purpose

This file provides **persistent context** for GitHub Copilot when working on SADIE.

**Always reference this file** when generating code:
```
@workspace /COPILOT_CONTEXT.md
```

---

## 📐 Architecture Summary

**SADIE** is a **privacy-first, local AI desktop assistant** that runs entirely on the user's machine.

### Core Components:

1. **Electron Widget** (`widget/`)
   - Desktop UI (React + TypeScript)
   - Communicates with n8n orchestrator via IPC → axios POST
   - 450x650px frameless window, always-on-top
   - Displays chat interface + action confirmations

2. **n8n Orchestrator** (`n8n-workflows/`)
   - `main-orchestrator.json` - Routes messages to Ollama, parses tool calls
   - `safety-validator.json` - Validates dangerous actions before execution
   - 9 tool workflows - Execute system operations (FileOps, SystemInfo, etc.)

3. **PowerShell Tools** (`scripts/tools/`)
   - `FileOps.ps1` - Read/write/delete files
   - `SystemInfo.ps1` - Get system information
   - `SafetyValidation.ps1` - Validate tool call safety
   - `ArchiveOps.ps1` - Compress/extract archives
   - (Future: EmailOps.ps1, VoiceOps.ps1, SearchOps.ps1)

4. **Ollama** (External Service)
   - Local LLM inference (llama3.1, deepseek-coder-v2)
   - Runs on `http://localhost:11434`
   - Tool-calling enabled models

5. **AutoHotkey** (Future - `scripts/autohotkey/`)
   - Global hotkey: `Ctrl+Shift+Space` to activate widget

---

## 📁 Folder Structure

```
sadie/
├── COPILOT_CONTEXT.md          ← YOU ARE HERE
├── SADIE_SPEC_LOCK.txt         ← Unchangeable specifications
├── PROJECT_PLAN.md             ← Master implementation plan
├── COMPLIANCE_REPORT.md        ← Progress tracking
├── CHATGPT_EXECUTION_PROMPT.md ← Phase-by-phase execution plan
│
├── widget/                     ← Electron Desktop App
│   ├── package.json
│   ├── tsconfig.json
│   ├── webpack.config.js
│   ├── src/
│   │   ├── main/               ← Main process (Node.js)
│   │   │   ├── index.ts
│   │   │   ├── window-manager.ts
│   │   │   └── ipc-handlers.ts
│   │   ├── preload/            ← Preload script (contextBridge)
│   │   │   └── index.ts
│   │   ├── renderer/           ← Renderer process (React UI)
│   │   │   ├── App.tsx
│   │   │   ├── index.tsx
│   │   │   ├── index.html
│   │   │   ├── components/
│   │   │   │   ├── ChatInterface.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── InputBox.tsx
│   │   │   │   ├── ActionConfirmation.tsx
│   │   │   │   ├── StatusIndicator.tsx
│   │   │   │   └── SettingsPanel.tsx
│   │   │   ├── utils/
│   │   │   │   └── api-client.ts
│   │   │   └── styles/
│   │   │       └── global.css
│   │   └── shared/             ← Shared TypeScript types
│   │       └── types.ts
│   ├── config/
│   │   └── user-settings.json  ← Persistent user settings
│   └── dist/                   ← Webpack build output
│
├── n8n-workflows/              ← n8n JSON Workflow Files
│   ├── orchestrator/
│   │   ├── main-orchestrator.json
│   │   └── safety-validator.json
│   └── tools/
│       ├── file-operations.json
│       ├── system-info.json
│       ├── archive-operations.json
│       ├── browser-automation.json
│       ├── calendar-tool.json
│       ├── clipboard-tool.json
│       └── (email-manager.json - FUTURE)
│       └── (voice-tool.json - FUTURE)
│       └── (search-tool.json - FUTURE)
│
├── scripts/                    ← PowerShell Automation Scripts
│   ├── tools/
│   │   ├── FileOps.ps1
│   │   ├── SystemInfo.ps1
│   │   ├── SafetyValidation.ps1
│   │   └── ArchiveOps.ps1
│   ├── setup/                  ← (FUTURE) Installation scripts
│   └── deployment/             ← (FUTURE) Build/deploy scripts
│
├── prompts/                    ← LLM System Prompts
│   └── system/
│       ├── main-system-prompt.txt
│       ├── tool-executor-prompt.txt
│       └── safety-validator-prompt.txt
│
├── schemas/                    ← JSON Schemas for Tool Calls
│   ├── file-operation-schema.json
│   ├── system-info-schema.json
│   ├── archive-operation-schema.json
│   ├── browser-automation-schema.json
│   ├── calendar-operation-schema.json
│   └── clipboard-operation-schema.json
│
├── docs/                       ← Documentation
│   ├── architecture.md
│   ├── setup-guide.md
│   ├── api-reference.md
│   └── PHASE_6_CHECKLIST.md
│
└── tests/                      ← (FUTURE) Test suite
    ├── unit/
    ├── integration/
    └── e2e/
```

---

## 🔒 SADIE Rules & Constraints

### **NEVER CHANGE THESE:**

1. **All operations are LOCAL ONLY**
   - No cloud APIs (except for future optional integrations)
   - All data stays on user's machine
   - Privacy is paramount

2. **Safety Validation is MANDATORY**
   - Every dangerous action MUST go through `safety-validator.json`
   - User MUST confirm destructive operations
   - Widget MUST display action summary + warnings

3. **n8n Webhook Endpoint**
   - Main entry point: `POST http://localhost:5678/webhook/sadie/chat`
   - Request body:
     ```json
     {
       "user_id": "desktop-user",
       "message": "user's message here",
       "conversation_id": "uuid-v4-string"
     }
     ```

4. **IPC Security**
   - **contextIsolation: true**
   - **nodeIntegration: false**
   - **sandbox: true**
   - Use `contextBridge` in preload script
   - Whitelist ONLY these IPC channels:
     - `sadie:message`
     - `sadie:reply`
     - `sadie:get-settings`
     - `sadie:save-settings`

5. **Widget Window Specifications**
   - Size: 450x650 pixels
   - Frameless: true
   - Always on top: true (user-configurable)
   - Transparent background: false
   - Resizable: false

6. **Tool Call Format** (from Ollama)
   ```json
   {
     "tool_calls": [
       {
         "name": "tool_name",
         "arguments": {
           "param1": "value1",
           "param2": "value2"
         }
       }
     ]
   }
   ```

7. **Response Status Types** (from n8n to widget)
   - `normal` - Regular chat response
   - `needs_confirmation` - Dangerous action requires user approval
   - `blocked` - Action denied by safety validator
   - `error` - System error occurred

---

## 🎨 Coding Conventions

### TypeScript

- **Strict mode enabled** (`"strict": true`)
- Use **interfaces** for type definitions (not `type` aliases unless needed)
- Prefer **async/await** over `.then()` chains
- Use **functional components** in React (no class components)
- Use **named exports** (avoid default exports except for React components)

### Naming

- **Files**: kebab-case (`window-manager.ts`, `api-client.ts`)
- **Components**: PascalCase (`ChatInterface.tsx`, `MessageList.tsx`)
- **Functions**: camelCase (`sendToSadie`, `handleSendMessage`)
- **Constants**: UPPER_SNAKE_CASE (`ALLOWED_CHANNELS`, `DEFAULT_SETTINGS`)
- **Interfaces**: PascalCase with descriptive names (`Message`, `ToolCall`, `Settings`)

### File Headers

Add JSDoc comments to exported functions:
```typescript
/**
 * Send a message to the SADIE orchestrator via n8n webhook
 * 
 * @param message - The user's message to send
 * @param conversationId - The conversation ID for message threading
 * @returns The response from the SADIE orchestrator
 */
export async function sendToSadie(message: string, conversationId: string): Promise<SadieResponse> {
  // ...
}
```

### Error Handling

- Use `try/catch` blocks for async operations
- Return error objects instead of throwing (where appropriate)
- Log errors to console in development
- Display user-friendly error messages in UI

### React Patterns

- Use `useState` for local component state
- Use `useEffect` for side effects (IPC listeners, timers)
- Use `useRef` for DOM references and mutable values
- Props should be typed with interfaces
- Avoid inline styles (use CSS classes)

---

## 📋 JSON Schemas

### Tool Call Schema (Generic)

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The name of the tool to call"
    },
    "arguments": {
      "type": "object",
      "description": "Tool-specific parameters"
    }
  },
  "required": ["name", "arguments"]
}
```

### File Operation Schema

```json
{
  "operation": "read_file" | "write_file" | "delete_file" | "list_directory",
  "path": "string (absolute path)",
  "content": "string (for write_file)",
  "recursive": "boolean (for list_directory)"
}
```

### System Info Schema

```json
{
  "query_type": "hardware" | "software" | "network" | "processes" | "all"
}
```

### Archive Operation Schema

```json
{
  "operation": "compress" | "extract",
  "source_path": "string",
  "destination_path": "string",
  "format": "zip" | "7z"
}
```

### Browser Automation Schema

```json
{
  "operation": "open_url" | "close_browser",
  "url": "string (for open_url)"
}
```

### Calendar Operation Schema

```json
{
  "operation": "add_event" | "list_events",
  "title": "string",
  "start_time": "ISO 8601 string",
  "end_time": "ISO 8601 string",
  "description": "string"
}
```

### Clipboard Operation Schema

```json
{
  "operation": "copy" | "paste",
  "content": "string (for copy)"
}
```

---

## 🔌 IPC Design

### Architecture

```
Renderer Process (React UI)
    ↓ (window.electron.sendMessage)
Preload Script (contextBridge)
    ↓ (ipcRenderer.send)
Main Process (ipc-handlers.ts)
    ↓ (axios.post)
n8n Orchestrator
    ↓ (responds)
Main Process
    ↓ (mainWindow.webContents.send)
Preload Script
    ↓ (callback)
Renderer Process (updates UI)
```

### Preload API

```typescript
interface ElectronAPI {
  sendMessage: (message: string) => void;
  onMessage: (callback: (response: any) => void) => () => void;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
```

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `sadie:message` | Renderer → Main | Send user message to n8n |
| `sadie:reply` | Main → Renderer | Forward n8n response to UI |
| `sadie:get-settings` | Renderer ↔ Main | Load user settings |
| `sadie:save-settings` | Renderer → Main | Save user settings |

---

## 🔗 Workflow Naming Guarantees

### n8n Workflow Names (MUST MATCH EXACTLY)

| Workflow File | Workflow Name in n8n | Webhook Path |
|---------------|----------------------|--------------|
| `main-orchestrator.json` | `SADIE Main Orchestrator` | `/webhook/sadie/chat` |
| `safety-validator.json` | `SADIE Safety Validator` | `/webhook/sadie/safety` |
| `file-operations.json` | `SADIE Tool: File Operations` | `/webhook/sadie/tool/file-ops` |
| `system-info.json` | `SADIE Tool: System Info` | `/webhook/sadie/tool/system-info` |
| `archive-operations.json` | `SADIE Tool: Archive Operations` | `/webhook/sadie/tool/archive-ops` |
| `browser-automation.json` | `SADIE Tool: Browser Automation` | `/webhook/sadie/tool/browser` |
| `calendar-tool.json` | `SADIE Tool: Calendar` | `/webhook/sadie/tool/calendar` |
| `clipboard-tool.json` | `SADIE Tool: Clipboard` | `/webhook/sadie/tool/clipboard` |

### PowerShell Script Names (MUST MATCH EXACTLY)

| Script File | Exported Functions |
|-------------|-------------------|
| `FileOps.ps1` | `Invoke-FileOperation` |
| `SystemInfo.ps1` | `Get-SystemInformation` |
| `SafetyValidation.ps1` | `Test-SafetyValidation` |
| `ArchiveOps.ps1` | `Invoke-ArchiveOperation` |

---

## 🛡️ Safety Rules

### Dangerous Operations (REQUIRE CONFIRMATION)

1. **File System**
   - Delete files/folders
   - Write to system directories (`C:\Windows`, `C:\Program Files`)
   - Modify files with sensitive extensions (`.exe`, `.dll`, `.sys`, `.bat`, `.ps1`)

2. **System Operations**
   - Terminate processes
   - Modify registry (FUTURE)
   - Change system settings (FUTURE)

3. **Network Operations**
   - Send emails (FUTURE)
   - Upload files to external servers (FUTURE)

### Blocked Operations (NEVER ALLOWED)

1. **Cryptographic Operations**
   - Encrypt/decrypt user files without explicit request
   - Generate cryptographic keys

2. **Credential Access**
   - Read password databases
   - Access browser stored passwords
   - Read Windows Credential Manager (FUTURE)

3. **Remote Execution**
   - Execute code on remote machines
   - Open reverse shells

### Safety Validator Behavior

```
User Request → Ollama (generates tool call) → Safety Validator
                                                    ↓
                                        YES: dangerous? ──→ return "needs_confirmation"
                                                    ↓
                                        NO: not dangerous ──→ return "approved"
```

---

## 💬 Widget Communication Rules

### Message Flow

1. **User types message** → `InputBox.tsx`
2. **App.tsx calls** `window.electron.sendMessage(message)`
3. **Preload** forwards to main via `ipcRenderer.send('sadie:message', message)`
4. **Main process** (ipc-handlers.ts) sends `axios.post` to n8n
5. **n8n responds** with JSON
6. **Main process** sends `mainWindow.webContents.send('sadie:reply', response)`
7. **Preload** forwards to renderer callback
8. **App.tsx** updates state and UI

### Response Handling

```typescript
// In App.tsx
const handleSadieReply = (response: any) => {
  if (response.status === 'blocked') {
    // Show error message
    addMessage({ role: 'assistant', content: response.message, timestamp: Date.now() });
  } else if (response.status === 'needs_confirmation') {
    // Show confirmation modal
    setPendingAction(response.action);
    setShowConfirmation(true);
  } else {
    // Normal message
    addMessage({ role: 'assistant', content: response.message, timestamp: Date.now() });
  }
};
```

### Settings Persistence

- Settings stored in `widget/config/user-settings.json`
- Loaded on app startup via `window.electron.getSettings()`
- Saved when user clicks "Save" in SettingsPanel
- Settings interface:
  ```typescript
  interface Settings {
    alwaysOnTop: boolean;
    n8nUrl: string;
    hotkey: string;
  }
  ```

---

## 📊 Execution Plan Phases

### Phase 1: Electron Widget ✅ (IN PROGRESS)
- ✅ package.json, tsconfig.json, webpack.config.js
- ✅ Main process (index.ts, window-manager.ts, ipc-handlers.ts)
- ✅ Preload script (index.ts with contextBridge)
- ✅ Renderer components (App.tsx + 6 components)
- ✅ API client utility (api-client.ts)
- ⚠️ REMAINING: index.html, index.tsx, types.ts, global.css, global.d.ts

### Phase 2: Complete n8n Workflows ⚠️ (PARTIAL)
- ✅ main-orchestrator.json
- ✅ safety-validator.json
- ✅ 6 tool workflows (file-ops, system-info, archive-ops, browser, calendar, clipboard)
- ❌ MISSING: email-manager.json, voice-tool.json, search-tool.json

### Phase 3: Testing Infrastructure ❌ (NOT STARTED)
- Create Jest configuration
- Unit tests for widget components
- Integration tests for IPC flow
- PowerShell test cases
- E2E tests for full workflow

### Phase 4: Setup Scripts ❌ (NOT STARTED)
- install-ollama.ps1
- pull-models.ps1
- setup-n8n.ps1
- install-dependencies.ps1

### Phase 5: Deployment Scripts ❌ (NOT STARTED)
- build-widget.ps1
- import-workflows.ps1
- start-services.ps1
- stop-services.ps1

### Phase 6: Documentation ⚠️ (PARTIAL)
- ✅ PROJECT_PLAN.md
- ✅ COMPLIANCE_REPORT.md
- ✅ CHATGPT_EXECUTION_PROMPT.md
- ❌ MISSING: setup-guide.md, api-reference.md, architecture.md

### Phase 7: AutoHotkey Integration ❌ (NOT STARTED)
- global-hotkeys.ahk
- Ctrl+Shift+Space activation
- Focus management

### Phase 8: Final Integration Testing ❌ (NOT STARTED)
- Full system smoke test
- Performance benchmarks
- User acceptance testing

---

## 🧰 Development Commands

### Widget Development

```powershell
# Install dependencies
cd widget
npm install

# Development mode (auto-reload)
npm run dev

# Build for production
npm run build

# Create installer
npm run dist

# Start without build
npm start
```

### n8n Development

```powershell
# Start n8n
npx n8n start

# Import workflows
# Manual: n8n UI → Import → Select JSON file

# Export workflows
# Manual: n8n UI → Workflow → Download
```

### PowerShell Tools Testing

```powershell
# Test file operations
. .\scripts\tools\FileOps.ps1
Invoke-FileOperation -Operation "read_file" -Path "C:\test.txt"

# Test system info
. .\scripts\tools\SystemInfo.ps1
Get-SystemInformation -QueryType "hardware"

# Test safety validation
. .\scripts\tools\SafetyValidation.ps1
Test-SafetyValidation -ToolName "file_operations" -Arguments @{operation="delete_file"; path="C:\test.txt"}
```

---

## 📌 Common Issues & Solutions

### Issue: TypeScript errors before npm install
**Solution:** Expected behavior. Run `npm install` first.

### Issue: Electron window doesn't appear
**Solution:** Check `dist/` folder exists. Run `npm run build` first.

### Issue: IPC communication not working
**Solution:** Verify preload script path in window-manager.ts is correct.

### Issue: n8n webhook returns 404
**Solution:** 
1. Verify n8n is running on `http://localhost:5678`
2. Check workflow is activated (toggle in n8n UI)
3. Verify webhook path matches exactly: `/webhook/sadie/chat`

### Issue: Settings not persisting
**Solution:** Check `widget/config/` directory exists and is writable.

### Issue: Ollama not responding
**Solution:**
1. Verify Ollama is running: `curl http://localhost:11434/api/version`
2. Check model is pulled: `ollama list`
3. Test model: `ollama run llama3.1`

---

## 🔍 Key Files to Keep Open

**Pin these tabs in VS Code for persistent Copilot context:**

1. `COPILOT_CONTEXT.md` (this file)
2. `SADIE_SPEC_LOCK.txt` (unchangeable specs)
3. `widget/tsconfig.json` (TypeScript config)
4. `widget/webpack.config.js` (Build config)
5. `widget/src/main/index.ts` (Electron entry)
6. `widget/src/main/window-manager.ts` (Window creation)
7. `widget/src/main/ipc-handlers.ts` (IPC logic)
8. `widget/src/preload/index.ts` (Security bridge)
9. `widget/src/renderer/App.tsx` (React root)
10. `widget/src/shared/types.ts` (Shared types)

---

## ✅ When to Use This File

**ALWAYS reference this file when:**
- Creating new widget components
- Modifying IPC handlers
- Adding new tool workflows
- Updating PowerShell scripts
- Writing tests
- Documenting features
- Debugging communication issues

**Prompt pattern:**
```
@workspace /COPILOT_CONTEXT.md

Create a new React component: StatusBadge.tsx
- Should display n8n connection status
- Use StatusIndicator pattern from App.tsx
- Follow TypeScript strict mode
```

---

## 🚀 Next Steps

**Immediate (Phase 1 completion):**
1. Create `widget/src/renderer/index.html`
2. Create `widget/src/renderer/index.tsx`
3. Create `widget/src/shared/types.ts`
4. Create `widget/src/renderer/styles/global.css`
5. Create `widget/src/global.d.ts`
6. Run `npm install` and test build

**Short-term (Phase 2-3):**
1. Complete missing tool workflows (email, voice, search)
2. Set up Jest testing infrastructure
3. Write unit tests for components

**Long-term (Phase 4-8):**
1. Create setup automation scripts
2. Build deployment pipeline
3. Add AutoHotkey global hotkey
4. Complete documentation
5. Full integration testing

---

## 📝 Notes

- **Privacy is paramount** - All data stays local
- **User confirmation required** for dangerous operations
- **Type safety enforced** - Use TypeScript strict mode
- **Security first** - Electron security best practices
- **Modular design** - Each component has single responsibility
- **No hallucination** - Follow specs exactly as written

---

**Last Updated:** November 17, 2025  
**SADIE Version:** 1.0.0  
**Project Status:** Phase 1 (Electron Widget) - 90% Complete
