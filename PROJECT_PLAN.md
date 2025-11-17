# SADIE - Structured AI Desktop Intelligence Engine
## Project Planning Document

---

# 1. Project Summary

**SADIE** is a fully local, privacy-first AI personal assistant system that runs entirely on Windows without cloud dependencies. It combines:

- **n8n** as the orchestration backbone
- **Ollama** for local LLM inference (Phi-4, Llama3, LLaVA, Whisper)
- **Electron-based desktop widget** for user interaction
- **Modular workflow architecture** for extensibility
- **Structured JSON tool-calling** for safe, predictable agent behavior
- **Multi-layer safety validation** to prevent harmful actions
- **Local memory subsystem** for context persistence

### Core Principles
1. **Privacy**: All data stays local
2. **Modularity**: Each capability is a separate workflow
3. **Safety**: Multi-layer validation and user confirmation
4. **Transparency**: All actions are logged and explainable
5. **Extensibility**: Easy to add new tools and workflows

---

# 2. Full Folder Structure

```
sadie/
├── README.md
├── PROJECT_PLAN.md (this file)
├── LICENSE
├── .gitignore
├── docker-compose.yml (n8n + optional services)
│
├── docs/
│   ├── architecture.md
│   ├── setup-guide.md
│   ├── workflow-development.md
│   ├── safety-guidelines.md
│   └── api-reference.md
│
├── widget/                          # Electron desktop widget
│   ├── package.json
│   ├── package-lock.json
│   ├── electron-builder.json
│   ├── .eslintrc.json
│   ├── tsconfig.json
│   │
│   ├── src/
│   │   ├── main/                    # Electron main process
│   │   │   ├── index.ts
│   │   │   ├── window-manager.ts
│   │   │   ├── tray-manager.ts
│   │   │   ├── ipc-handlers.ts
│   │   │   ├── config-manager.ts
│   │   │   └── hotkey-manager.ts
│   │   │
│   │   ├── renderer/                # Electron renderer (UI)
│   │   │   ├── index.html
│   │   │   ├── index.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── ChatInterface.tsx
│   │   │   │   ├── InputBox.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── ActionConfirmation.tsx
│   │   │   │   ├── SettingsPanel.tsx
│   │   │   │   └── StatusIndicator.tsx
│   │   │   ├── styles/
│   │   │   │   ├── global.css
│   │   │   │   └── themes.css
│   │   │   └── utils/
│   │   │       ├── api-client.ts
│   │   │       └── helpers.ts
│   │   │
│   │   ├── shared/                  # Shared types/interfaces
│   │   │   ├── types.ts
│   │   │   ├── schemas.ts
│   │   │   └── constants.ts
│   │   │
│   │   └── preload/
│   │       └── index.ts
│   │
│   └── build/                       # Build artifacts
│
├── n8n-workflows/                   # n8n workflow definitions
│   ├── core/
│   │   ├── main-orchestrator.json
│   │   ├── tool-router.json
│   │   └── safety-validator.json
│   │
│   ├── tools/
│   │   ├── file-manager.json
│   │   ├── email-manager.json
│   │   ├── vision-tool.json
│   │   ├── voice-tool.json
│   │   ├── planning-agent.json
│   │   ├── api-tool.json
│   │   ├── memory-manager.json
│   │   ├── search-tool.json
│   │   └── system-info.json
│   │
│   └── README.md
│
├── prompts/                         # LLM prompt templates
│   ├── system/
│   │   ├── orchestrator-system.txt
│   │   ├── tool-selection.txt
│   │   └── response-formatting.txt
│   │
│   ├── tools/
│   │   ├── file-operations.txt
│   │   ├── email-operations.txt
│   │   ├── vision-analysis.txt
│   │   ├── planning-agent.txt
│   │   └── memory-operations.txt
│   │
│   └── safety/
│       ├── validation-prompt.txt
│       └── confirmation-generator.txt
│
├── schemas/                         # JSON schemas for validation
│   ├── tool-call-schema.json
│   ├── file-operation-schema.json
│   ├── email-operation-schema.json
│   ├── vision-request-schema.json
│   ├── memory-operation-schema.json
│   └── safety-rules-schema.json
│
├── config/                          # Configuration files
│   ├── default-config.json
│   ├── safety-rules.json
│   ├── tool-allowlist.json
│   ├── ollama-models.json
│   └── n8n-endpoints.json
│
├── scripts/                         # Helper scripts
│   ├── setup/
│   │   ├── install-ollama.ps1
│   │   ├── pull-models.ps1
│   │   ├── setup-n8n.ps1
│   │   └── install-dependencies.ps1
│   │
│   ├── deployment/
│   │   ├── build-widget.ps1
│   │   ├── import-workflows.ps1
│   │   └── start-services.ps1
│   │
│   └── tools/
│       ├── ahk/                     # AutoHotkey scripts
│       │   ├── global-hotkeys.ahk
│       │   └── widget-trigger.ahk
│       │
│       └── powershell/              # PowerShell modules
│           ├── FileOps.ps1
│           ├── SystemInfo.ps1
│           └── SafetyValidation.ps1
│
├── memory/                          # Local memory subsystem
│   ├── database/
│   │   ├── conversations.db
│   │   └── embeddings.db (optional ChromaDB)
│   │
│   ├── json-store/
│   │   ├── user-preferences.json
│   │   ├── conversation-history.json
│   │   └── tool-usage-stats.json
│   │
│   └── cache/
│       └── .gitkeep
│
├── logs/                            # Application logs
│   ├── widget.log
│   ├── n8n-actions.log
│   ├── safety-validations.log
│   └── errors.log
│
├── tests/                           # Test suite
│   ├── unit/
│   │   ├── widget/
│   │   │   ├── api-client.test.ts
│   │   │   └── window-manager.test.ts
│   │   │
│   │   └── schemas/
│   │       └── validation.test.ts
│   │
│   ├── integration/
│   │   ├── widget-to-n8n.test.ts
│   │   ├── n8n-to-ollama.test.ts
│   │   ├── tool-workflows.test.ts
│   │   └── safety-validation.test.ts
│   │
│   ├── e2e/
│   │   ├── full-conversation.test.ts
│   │   ├── file-operations.test.ts
│   │   └── memory-persistence.test.ts
│   │
│   └── fixtures/
│       ├── mock-responses.json
│       └── test-files/
│
└── examples/                        # Example configurations
    ├── example-conversation.json
    ├── example-tool-calls.json
    └── custom-workflow-template.json
```

---

# 3. Component Descriptions

## 3.1 Widget (Electron Desktop Application)

### Main Process (`widget/src/main/`)
- **index.ts**: Entry point, initializes Electron app
- **window-manager.ts**: Creates/manages overlay window, handles positioning, always-on-top behavior
- **tray-manager.ts**: System tray icon, context menu, quick actions
- **ipc-handlers.ts**: Inter-process communication handlers (renderer ↔ main)
- **config-manager.ts**: Loads/saves user configuration
- **hotkey-manager.ts**: Global hotkey registration (e.g., Ctrl+Shift+Space to activate)

### Renderer Process (`widget/src/renderer/`)
- **App.tsx**: Root React component
- **ChatInterface.tsx**: Main conversational UI
- **InputBox.tsx**: Text/voice input with submit button
- **MessageList.tsx**: Displays user/assistant messages
- **ActionConfirmation.tsx**: Modal for confirming dangerous actions
- **SettingsPanel.tsx**: Configuration UI (Ollama endpoint, n8n URL, hotkeys)
- **StatusIndicator.tsx**: Shows connection status (Ollama, n8n)

### Preload Script (`widget/src/preload/`)
- **index.ts**: Exposes safe IPC methods to renderer via contextBridge

### Shared (`widget/src/shared/`)
- **types.ts**: TypeScript interfaces for all data structures
- **schemas.ts**: JSON schema definitions (mirrors `/schemas`)
- **constants.ts**: App constants (default ports, timeouts, etc.)

## 3.2 n8n Workflows

### Core Workflows (`n8n-workflows/core/`)

#### main-orchestrator.json
- **Trigger**: Webhook POST `/sadie/chat`
- **Function**: Receives user input, calls Ollama for tool selection
- **Output**: Routes to appropriate tool workflow OR returns direct response

#### tool-router.json
- **Function**: Parses Ollama's JSON response, validates tool name
- **Routes**: Dispatches to specific tool workflows based on `tool_name`

#### safety-validator.json
- **Function**: Pre-execution validation of tool calls
- **Checks**: 
  - Tool is in allowlist
  - Parameters match schema
  - File paths are within allowed directories
  - Dangerous operations flagged for confirmation
- **Output**: `{safe: true/false, requires_confirmation: true/false, reason: string}`

### Tool Workflows (`n8n-workflows/tools/`)

#### file-manager.json
- **Actions**: read_file, write_file, list_directory, move_file, delete_file, search_files
- **Integration**: PowerShell scripts (`scripts/tools/powershell/FileOps.ps1`)
- **Safety**: Path whitelisting, no system directory access

#### email-manager.json
- **Actions**: send_email, read_inbox, search_emails
- **Integration**: Local email client COM automation or IMAP/SMTP
- **Safety**: Confirmation required for sending emails

#### vision-tool.json
- **Actions**: analyze_screenshot, ocr_text, describe_image
- **Integration**: Ollama LLaVA model + Tesseract OCR
- **Input**: Base64 image or file path

#### voice-tool.json
- **Actions**: transcribe_audio, text_to_speech
- **Integration**: Ollama Whisper model (transcription), local TTS (e.g., Windows SAPI or Piper TTS)

#### planning-agent.json
- **Actions**: break_down_task, create_plan, execute_steps
- **Function**: Multi-step task orchestration
- **Integration**: Recursive calls to main orchestrator

#### api-tool.json
- **Actions**: http_get, http_post
- **Safety**: URL allowlist, no arbitrary API calls without confirmation

#### memory-manager.json
- **Actions**: store_fact, retrieve_context, search_memory
- **Storage**: JSON files or ChromaDB embeddings
- **Integration**: Ollama for embedding generation (if using ChromaDB)

#### search-tool.json
- **Actions**: search_local_files, search_web (optional)
- **Integration**: Everything Search CLI (for Windows file search)

#### system-info.json
- **Actions**: get_system_stats, get_running_processes, get_disk_space
- **Integration**: PowerShell `Get-ComputerInfo`, `Get-Process`

## 3.3 Ollama Integration

### Models Required
1. **Phi-4** or **Llama3**: Primary reasoning/tool-calling model
2. **LLaVA**: Vision analysis
3. **Whisper**: Voice transcription

### Endpoint Usage
- **POST `http://localhost:11434/api/generate`**: Main generation endpoint
- **POST `http://localhost:11434/api/embeddings`**: For memory embeddings (optional)

### Prompt Engineering
- System prompts stored in `/prompts/system/`
- Tool-specific prompts in `/prompts/tools/`
- Prompts include JSON schema examples for tool-calling

## 3.4 Memory Subsystem

### JSON Store (Simple)
- **conversations.json**: Rolling history of user/assistant exchanges
- **user-preferences.json**: Learned user preferences
- **tool-usage-stats.json**: Analytics for improving tool selection

### ChromaDB (Advanced - Optional)
- **Embedding-based semantic memory**
- Requires Ollama embeddings endpoint
- Better for large conversation histories

### Memory Operations
- **store_fact**: Add new information to memory
- **retrieve_context**: Get relevant past conversations
- **search_memory**: Semantic search across history

---

# 4. Communication Flow

## 4.1 Standard Conversation Flow

```
┌──────────────┐
│  User Input  │ (Text or Voice)
└──────┬───────┘
       │
       ▼
┌─────────────────────────────┐
│  Electron Widget (Renderer) │
└──────────────┬──────────────┘
               │ IPC
               ▼
┌─────────────────────────────┐
│  Electron Widget (Main)     │
└──────────────┬──────────────┘
               │ HTTP POST
               ▼
┌─────────────────────────────────────┐
│  n8n: Main Orchestrator             │
│  - Webhook receives input           │
│  - Loads conversation history       │
│  - Constructs Ollama prompt         │
└──────────────┬──────────────────────┘
               │ HTTP POST
               ▼
┌─────────────────────────────────────┐
│  Ollama (Phi-4 / Llama3)            │
│  - Processes prompt                 │
│  - Returns JSON:                    │
│    {                                │
│      "response": "...",             │
│      "tool_call": {                 │
│        "tool_name": "file_manager", │
│        "parameters": {...}          │
│      }                              │
│    }                                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  n8n: Safety Validator              │
│  - Validates tool call              │
│  - Checks safety rules              │
│  - Flags if confirmation needed     │
└──────────────┬──────────────────────┘
               │
               ├─► If dangerous/unclear:
               │   └─► Return to widget for confirmation
               │
               ▼ If safe:
┌─────────────────────────────────────┐
│  n8n: Tool Router                   │
│  - Routes to specific tool workflow │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  n8n: Tool Workflow (e.g., File Mgr)│
│  - Executes PowerShell/Python       │
│  - Returns structured result        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  n8n: Main Orchestrator             │
│  - Formats result for user          │
│  - Updates memory                   │
│  - Logs action                      │
└──────────────┬──────────────────────┘
               │ HTTP Response
               ▼
┌─────────────────────────────────────┐
│  Electron Widget                    │
│  - Displays response                │
│  - Updates UI                       │
└─────────────────────────────────────┘
```

## 4.2 Voice Input Flow

```
User speaks → Widget captures audio → POST to n8n voice-tool
→ n8n calls Ollama Whisper → Returns text → Routes to main orchestrator
```

## 4.3 Vision Input Flow

```
User takes screenshot → Widget sends image → POST to n8n vision-tool
→ n8n calls Ollama LLaVA + Tesseract → Returns analysis → Routes to main orchestrator
```

---

# 5. JSON Schemas for Tool-Calling

## 5.1 Base Tool Call Schema

**File**: `schemas/tool-call-schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["response", "tool_call"],
  "properties": {
    "response": {
      "type": "string",
      "description": "Natural language response to user"
    },
    "tool_call": {
      "oneOf": [
        { "type": "null" },
        {
          "type": "object",
          "required": ["tool_name", "parameters"],
          "properties": {
            "tool_name": {
              "type": "string",
              "enum": [
                "file_manager",
                "email_manager",
                "vision_tool",
                "voice_tool",
                "planning_agent",
                "api_tool",
                "memory_manager",
                "search_tool",
                "system_info"
              ]
            },
            "parameters": {
              "type": "object",
              "description": "Tool-specific parameters"
            },
            "reasoning": {
              "type": "string",
              "description": "Why this tool was selected"
            }
          }
        }
      ]
    }
  }
}
```

## 5.2 File Manager Schema

**File**: `schemas/file-operation-schema.json`

```json
{
  "type": "object",
  "required": ["action", "parameters"],
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "read_file",
        "write_file",
        "list_directory",
        "move_file",
        "delete_file",
        "search_files"
      ]
    },
    "parameters": {
      "type": "object",
      "anyOf": [
        {
          "properties": {
            "path": { "type": "string" },
            "encoding": { "type": "string", "default": "utf-8" }
          },
          "required": ["path"]
        },
        {
          "properties": {
            "path": { "type": "string" },
            "content": { "type": "string" },
            "encoding": { "type": "string", "default": "utf-8" },
            "create_backup": { "type": "boolean", "default": true }
          },
          "required": ["path", "content"]
        },
        {
          "properties": {
            "path": { "type": "string" },
            "recursive": { "type": "boolean", "default": false }
          },
          "required": ["path"]
        },
        {
          "properties": {
            "source": { "type": "string" },
            "destination": { "type": "string" }
          },
          "required": ["source", "destination"]
        },
        {
          "properties": {
            "path": { "type": "string" },
            "permanent": { "type": "boolean", "default": false }
          },
          "required": ["path"]
        },
        {
          "properties": {
            "query": { "type": "string" },
            "path": { "type": "string" },
            "file_pattern": { "type": "string", "default": "*.*" }
          },
          "required": ["query"]
        }
      ]
    }
  }
}
```

## 5.3 Email Manager Schema

**File**: `schemas/email-operation-schema.json`

```json
{
  "type": "object",
  "required": ["action", "parameters"],
  "properties": {
    "action": {
      "type": "string",
      "enum": ["send_email", "read_inbox", "search_emails"]
    },
    "parameters": {
      "type": "object",
      "anyOf": [
        {
          "properties": {
            "to": { "type": "array", "items": { "type": "string" } },
            "subject": { "type": "string" },
            "body": { "type": "string" },
            "cc": { "type": "array", "items": { "type": "string" } },
            "attachments": { "type": "array", "items": { "type": "string" } }
          },
          "required": ["to", "subject", "body"]
        },
        {
          "properties": {
            "folder": { "type": "string", "default": "INBOX" },
            "limit": { "type": "integer", "default": 20 },
            "unread_only": { "type": "boolean", "default": false }
          }
        },
        {
          "properties": {
            "query": { "type": "string" },
            "folder": { "type": "string", "default": "INBOX" },
            "limit": { "type": "integer", "default": 50 }
          },
          "required": ["query"]
        }
      ]
    }
  }
}
```

## 5.4 Vision Request Schema

**File**: `schemas/vision-request-schema.json`

```json
{
  "type": "object",
  "required": ["action", "parameters"],
  "properties": {
    "action": {
      "type": "string",
      "enum": ["analyze_screenshot", "ocr_text", "describe_image"]
    },
    "parameters": {
      "type": "object",
      "properties": {
        "image_source": {
          "type": "string",
          "enum": ["screenshot", "clipboard", "file"],
          "default": "screenshot"
        },
        "file_path": { "type": "string" },
        "prompt": { "type": "string" },
        "ocr_only": { "type": "boolean", "default": false }
      }
    }
  }
}
```

## 5.5 Memory Operation Schema

**File**: `schemas/memory-operation-schema.json`

```json
{
  "type": "object",
  "required": ["action", "parameters"],
  "properties": {
    "action": {
      "type": "string",
      "enum": ["store_fact", "retrieve_context", "search_memory"]
    },
    "parameters": {
      "type": "object",
      "anyOf": [
        {
          "properties": {
            "content": { "type": "string" },
            "category": { "type": "string" },
            "importance": { "type": "integer", "minimum": 1, "maximum": 10 }
          },
          "required": ["content"]
        },
        {
          "properties": {
            "query": { "type": "string" },
            "limit": { "type": "integer", "default": 5 }
          },
          "required": ["query"]
        }
      ]
    }
  }
}
```

---

# 6. Safety Enforcement Design

## 6.1 Multi-Layer Safety Architecture

### Layer 1: Client-Side Validation (Widget)
- **Purpose**: Immediate feedback, prevent obviously bad inputs
- **Checks**: 
  - Input length limits
  - Basic sanitization
  - Hotkey abuse prevention (rate limiting)
- **Location**: `widget/src/shared/schemas.ts`

### Layer 2: n8n Safety Validator Workflow
- **Purpose**: Pre-execution validation of all tool calls
- **Checks**:
  - Tool name is in allowlist
  - Parameters match JSON schema
  - File paths are within allowed directories
  - Dangerous actions flagged for confirmation
  - API endpoints against URL allowlist
- **Location**: `n8n-workflows/core/safety-validator.json`
- **Config**: `config/safety-rules.json`, `config/tool-allowlist.json`

### Layer 3: Tool Workflow Safety
- **Purpose**: Tool-specific validation before execution
- **Checks**:
  - File operations: Path traversal prevention, system directory protection
  - Email: Recipient validation, attachment scanning
  - API calls: Rate limiting, timeout enforcement
- **Location**: Within each tool workflow

### Layer 4: PowerShell/Python Script Safety
- **Purpose**: Final execution layer safety
- **Checks**:
  - PowerShell execution policy
  - Sandboxed execution where possible
  - Error handling and rollback
- **Location**: `scripts/tools/powershell/`, individual scripts

### Layer 5: Logging and Audit
- **Purpose**: Post-execution tracking and forensics
- **Logs**:
  - All tool calls with timestamps
  - Safety validation results
  - User confirmations
  - Errors and failures
- **Location**: `logs/safety-validations.log`, `logs/n8n-actions.log`

## 6.2 Safety Rules Configuration

**File**: `config/safety-rules.json`

```json
{
  "file_operations": {
    "allowed_directories": [
      "C:\\Users\\adenk\\Documents",
      "C:\\Users\\adenk\\Desktop",
      "C:\\Users\\adenk\\Downloads"
    ],
    "blocked_directories": [
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      "C:\\ProgramData",
      "C:\\Users\\adenk\\AppData"
    ],
    "blocked_extensions": [".exe", ".dll", ".sys", ".bat", ".cmd", ".ps1"],
    "require_confirmation": {
      "delete": true,
      "move": false,
      "write": false
    },
    "max_file_size_mb": 50
  },
  "email_operations": {
    "require_confirmation": {
      "send": true
    },
    "max_recipients": 10,
    "max_attachment_size_mb": 25,
    "blocked_domains": []
  },
  "api_operations": {
    "require_confirmation": true,
    "allowed_domains": ["localhost", "127.0.0.1"],
    "timeout_seconds": 30,
    "max_retries": 3
  },
  "system_operations": {
    "allowed_commands": ["Get-Process", "Get-ComputerInfo", "Get-Disk"],
    "blocked_commands": ["Stop-Process", "Restart-Computer", "Remove-Item"]
  },
  "global": {
    "safe_mode": true,
    "log_all_actions": true,
    "require_confirmation_for_ambiguous": true
  }
}
```

## 6.3 Confirmation Flow

When safety validator flags an action:

```
1. n8n returns: 
   {
     "requires_confirmation": true,
     "action_summary": "Delete file: documents/report.docx",
     "risk_level": "medium",
     "confirmation_token": "abc123"
   }

2. Widget displays modal:
   "SADIE wants to delete a file:
    📄 documents/report.docx
    
    ⚠️ This action cannot be undone.
    
    [Cancel] [Confirm]"

3. User confirms → Widget POSTs back with token:
   {
     "confirmation_token": "abc123",
     "user_confirmed": true
   }

4. n8n validates token and executes action
```

---

# 7. List of Required Prompts

## 7.1 System Prompts (`prompts/system/`)

### orchestrator-system.txt
```
Purpose: Main system prompt for Ollama
Content:
- Role definition (helpful local assistant)
- Capabilities overview
- Tool-calling instructions
- JSON response format
- Safety guidelines
- When to ask for clarification
```

### tool-selection.txt
```
Purpose: Guide LLM to select appropriate tools
Content:
- Decision tree for tool selection
- Examples of user intents → tool mappings
- Multi-tool scenarios
- When no tool is needed (conversational response)
```

### response-formatting.txt
```
Purpose: Ensure consistent JSON output
Content:
- JSON schema definition
- Examples of valid responses
- Common mistakes to avoid
- Handling partial information
```

## 7.2 Tool Prompts (`prompts/tools/`)

### file-operations.txt
```
Purpose: Guide file manager tool usage
Content:
- When to use each file operation
- Path resolution strategies
- Error handling guidelines
- Safety considerations (paths, backups)
```

### email-operations.txt
```
Purpose: Guide email manager tool usage
Content:
- Email composition best practices
- Search query formulation
- Recipient validation
- Attachment handling
```

### vision-analysis.txt
```
Purpose: Guide vision tool usage
Content:
- When to use screenshot vs OCR vs image description
- Prompt engineering for LLaVA
- Handling unclear images
- Privacy considerations
```

### planning-agent.txt
```
Purpose: Guide multi-step task planning
Content:
- Task decomposition strategies
- Sequential vs parallel execution
- Dependency management
- Progress tracking
```

### memory-operations.txt
```
Purpose: Guide memory subsystem usage
Content:
- What to store (important facts, preferences)
- When to retrieve context
- Semantic search strategies
- Privacy and data retention
```

## 7.3 Safety Prompts (`prompts/safety/`)

### validation-prompt.txt
```
Purpose: LLM-based safety validation (secondary check)
Content:
- Red flags for dangerous operations
- Context-based risk assessment
- When to flag for human review
```

### confirmation-generator.txt
```
Purpose: Generate user-friendly confirmation messages
Content:
- Clear action summaries
- Risk level communication
- Alternatives to dangerous actions
```

---

# 8. Integration Points

## 8.1 Widget ↔ n8n

**Protocol**: HTTP REST API  
**Endpoint**: `http://localhost:5678/webhook/sadie/chat`

### Request Format
```json
{
  "user_id": "user123",
  "message": "Create a new file called notes.txt",
  "context": {
    "conversation_id": "conv456",
    "timestamp": "2025-11-17T10:30:00Z",
    "input_type": "text" // or "voice", "vision"
  },
  "confirmation_token": null // or token if confirming action
}
```

### Response Format
```json
{
  "response": "I'll create a new file called notes.txt in your Documents folder.",
  "requires_confirmation": false,
  "action_summary": null,
  "result": {
    "success": true,
    "data": "File created successfully at C:\\Users\\adenk\\Documents\\notes.txt"
  },
  "conversation_id": "conv456",
  "timestamp": "2025-11-17T10:30:05Z"
}
```

## 8.2 n8n ↔ Ollama

**Protocol**: HTTP REST API  
**Endpoint**: `http://localhost:11434/api/generate`

### Request Format
```json
{
  "model": "phi-4",
  "prompt": "[SYSTEM PROMPT]\n\nUser: Create a new file called notes.txt",
  "stream": false,
  "format": "json",
  "options": {
    "temperature": 0.7,
    "top_p": 0.9
  }
}
```

### Response Format
```json
{
  "response": "{\"response\": \"...\", \"tool_call\": {...}}",
  "done": true,
  "context": [...]
}
```

## 8.3 Tool Workflows ↔ PowerShell/Python

**Protocol**: Execute-Command Node in n8n

### PowerShell Invocation
```javascript
// In n8n Function node
const params = items[0].json.parameters;
const command = `powershell.exe -ExecutionPolicy Bypass -File "C:\\Users\\adenk\\Desktop\\sadie\\scripts\\tools\\powershell\\FileOps.ps1" -Action "${params.action}" -Path "${params.path}"`;
return [{ json: { command } }];
```

### PowerShell Script Structure
```powershell
param(
    [string]$Action,
    [string]$Path,
    [string]$Content
)

# Validate parameters
# Execute action
# Return JSON result
$result = @{
    success = $true
    data = "..."
    error = $null
} | ConvertTo-Json

Write-Output $result
```

## 8.4 Memory Subsystem Integration

### JSON Store (Simple)
- **Read**: n8n "Read Binary File" node → JSON.parse
- **Write**: n8n "Write Binary File" node with JSON.stringify
- **Location**: `memory/json-store/`

### ChromaDB (Optional)
- **Protocol**: HTTP REST API
- **Endpoint**: `http://localhost:8000` (if running ChromaDB server)
- **Operations**: add, query, update, delete

## 8.5 AutoHotkey Integration

**Purpose**: Global hotkey to activate widget

### Trigger Script (`scripts/tools/ahk/widget-trigger.ahk`)
```autohotkey
; Ctrl+Shift+Space activates widget
^+Space::
    Run, "http://localhost:3000/activate", , Hide
return
```

Widget exposes HTTP endpoint for activation (electron shows window).

---

# 9. Testing Strategy

## 9.1 Unit Tests (`tests/unit/`)

### Widget Tests
- **api-client.test.ts**: Test HTTP client, request/response handling
- **window-manager.test.ts**: Test window positioning, show/hide logic
- **config-manager.test.ts**: Test configuration loading/saving

### Schema Tests
- **validation.test.ts**: Validate all JSON schemas against sample data

### Target Coverage: >80%

## 9.2 Integration Tests (`tests/integration/`)

### widget-to-n8n.test.ts
- Test end-to-end widget → n8n communication
- Mock n8n responses
- Verify request format, error handling

### n8n-to-ollama.test.ts
- Test n8n → Ollama communication
- Mock Ollama responses (tool calls, errors)
- Verify prompt construction, JSON parsing

### tool-workflows.test.ts
- Test each tool workflow in isolation
- Mock PowerShell/Python script outputs
- Verify parameter passing, result handling

### safety-validation.test.ts
- Test safety validator against various inputs
- Verify dangerous actions are flagged
- Test confirmation flow

## 9.3 End-to-End Tests (`tests/e2e/`)

### full-conversation.test.ts
- Complete conversation flow: widget → n8n → Ollama → tool → response
- Test conversational responses (no tool call)
- Test multi-turn conversations

### file-operations.test.ts
- Test real file operations in safe test directory
- Create, read, write, delete, search
- Verify safety constraints

### memory-persistence.test.ts
- Test memory storage and retrieval
- Verify context is maintained across conversations

## 9.4 Test Fixtures (`tests/fixtures/`)

### mock-responses.json
```json
{
  "ollama": {
    "conversational": "{\"response\": \"Hello! How can I help?\", \"tool_call\": null}",
    "file_create": "{\"response\": \"I'll create that file.\", \"tool_call\": {\"tool_name\": \"file_manager\", ...}}"
  },
  "n8n": {
    "success": {"response": "...", "result": {"success": true}},
    "confirmation_required": {"requires_confirmation": true, ...}
  }
}
```

### test-files/
- Sample text files, images for vision tests
- Located in safe test directory

## 9.5 Testing Tools

- **Jest**: Unit and integration tests (TypeScript/JavaScript)
- **Playwright**: E2E tests for Electron widget
- **Pester**: PowerShell script tests (optional)
- **n8n CLI**: Workflow testing (if available)

## 9.6 Continuous Testing

- Run unit tests on every commit
- Run integration tests before merges
- Run E2E tests nightly or before releases

---

# 10. Full Build Order (Step-by-Step)

## Phase 1: Environment Setup

### Step 1: Install Core Dependencies
```powershell
# Install Ollama
winget install Ollama.Ollama

# Install Node.js (for Electron and n8n)
winget install OpenJS.NodeJS.LTS

# Install Docker Desktop (for n8n)
winget install Docker.DockerDesktop

# Install AutoHotkey
winget install AutoHotkey.AutoHotkey

# Install Tesseract OCR
winget install UB-Mannheim.TesseractOCR

# Install Everything Search CLI
# Manual download from voidtools.com
```

### Step 2: Pull Ollama Models
```powershell
ollama pull phi-4
ollama pull llama3
ollama pull llava
ollama pull whisper
```

### Step 3: Start n8n
```powershell
# Using Docker Compose
cd c:\Users\adenk\Desktop\sadie
docker-compose up -d
```

### Step 4: Verify Services
```powershell
# Check Ollama
curl http://localhost:11434/api/tags

# Check n8n
curl http://localhost:5678/healthz
```

---

## Phase 2: Project Structure Creation

### Step 5: Create Folder Structure
```powershell
# Run scaffolding script
.\scripts\setup\create-structure.ps1
```

### Step 6: Initialize Git Repository
```powershell
git init
git add .
git commit -m "Initial project structure"
```

---

## Phase 3: Configuration Files

### Step 7: Create Configuration Files
- `config/default-config.json`
- `config/safety-rules.json`
- `config/tool-allowlist.json`
- `config/ollama-models.json`
- `config/n8n-endpoints.json`

### Step 8: Create JSON Schemas
- All files in `schemas/` directory
- Validate schemas with online validator

---

## Phase 4: Prompt Engineering

### Step 9: Write System Prompts
- `prompts/system/orchestrator-system.txt`
- `prompts/system/tool-selection.txt`
- `prompts/system/response-formatting.txt`

### Step 10: Write Tool Prompts
- All files in `prompts/tools/`
- Include examples and edge cases

### Step 11: Write Safety Prompts
- `prompts/safety/validation-prompt.txt`
- `prompts/safety/confirmation-generator.txt`

---

## Phase 5: n8n Workflow Development

### Step 12: Create Core Workflows
**Order**:
1. `safety-validator.json` (needed by others)
2. `main-orchestrator.json` (entry point)
3. `tool-router.json` (dispatcher)

**Testing**: Test each workflow with manual webhook calls

### Step 13: Create Tool Workflows
**Order**:
1. `system-info.json` (simplest, no external deps)
2. `memory-manager.json` (simple JSON operations)
3. `file-manager.json` (core functionality)
4. `search-tool.json` (integrates with Everything)
5. `vision-tool.json` (integrates with Ollama LLaVA)
6. `voice-tool.json` (integrates with Ollama Whisper)
7. `email-manager.json` (complex, email client integration)
8. `api-tool.json` (HTTP operations)
9. `planning-agent.json` (most complex, recursive)

**Testing**: Test each workflow independently

### Step 14: Import Workflows to n8n
```powershell
.\scripts\deployment\import-workflows.ps1
```

---

## Phase 6: PowerShell/Python Scripts

### Step 15: Write PowerShell Modules
- `scripts/tools/powershell/FileOps.ps1`
- `scripts/tools/powershell/SystemInfo.ps1`
- `scripts/tools/powershell/SafetyValidation.ps1`

**Testing**: Run each script with sample parameters

### Step 16: Write AutoHotkey Scripts
- `scripts/tools/ahk/global-hotkeys.ahk`
- `scripts/tools/ahk/widget-trigger.ahk`

**Testing**: Test hotkey activation

---

## Phase 7: Electron Widget Development

### Step 17: Initialize Electron Project
```powershell
cd widget
npm init -y
npm install electron electron-builder typescript react react-dom
npm install --save-dev @types/react @types/react-dom
```

### Step 18: Configure TypeScript and Build
- Create `tsconfig.json`
- Create `electron-builder.json`
- Set up build scripts in `package.json`

### Step 19: Implement Main Process
**Order**:
1. `index.ts` (entry point)
2. `config-manager.ts` (load config)
3. `window-manager.ts` (create window)
4. `tray-manager.ts` (system tray)
5. `hotkey-manager.ts` (global hotkeys)
6. `ipc-handlers.ts` (communication with renderer)

**Testing**: Run `npm start`, verify window appears

### Step 20: Implement Renderer Process
**Order**:
1. `index.html`, `index.tsx` (basic structure)
2. `App.tsx` (root component)
3. `utils/api-client.ts` (n8n communication)
4. `components/InputBox.tsx` (user input)
5. `components/MessageList.tsx` (display messages)
6. `components/ChatInterface.tsx` (combine input + messages)
7. `components/StatusIndicator.tsx` (connection status)
8. `components/ActionConfirmation.tsx` (confirmation modal)
9. `components/SettingsPanel.tsx` (configuration UI)

**Testing**: Test UI components independently

### Step 21: Implement Shared Types
- `shared/types.ts` (all TypeScript interfaces)
- `shared/schemas.ts` (JSON schema definitions)
- `shared/constants.ts` (app constants)

### Step 22: Implement Preload Script
- `preload/index.ts` (safe IPC bridge)

**Testing**: Verify renderer can communicate with main process

---

## Phase 8: Memory Subsystem

### Step 23: Implement JSON Store
- Initialize empty JSON files in `memory/json-store/`
- Create utility functions for read/write

**Testing**: Test memory operations via n8n workflow

### Step 24: (Optional) Implement ChromaDB Integration
- Set up ChromaDB server
- Create embedding generation workflow
- Test semantic search

---

## Phase 9: Integration Testing

### Step 25: End-to-End Manual Testing
**Test Cases**:
1. Simple conversation (no tool call)
2. File creation
3. File reading
4. Directory listing
5. File search
6. System info query
7. Vision analysis (screenshot)
8. Voice transcription (if audio input ready)
9. Memory storage and retrieval
10. Dangerous action (confirmation flow)

### Step 26: Automated Integration Tests
- Write tests in `tests/integration/`
- Run test suite: `npm test`

---

## Phase 10: Polish and Documentation

### Step 27: Logging and Error Handling
- Implement comprehensive logging across all components
- Add error boundaries in React
- Graceful degradation when services unavailable

### Step 28: Write User Documentation
- `docs/setup-guide.md` (step-by-step installation)
- `docs/architecture.md` (system overview)
- `docs/workflow-development.md` (how to add new tools)
- `docs/safety-guidelines.md` (security considerations)
- `docs/api-reference.md` (API endpoints, schemas)

### Step 29: Create Example Configurations
- `examples/example-conversation.json`
- `examples/example-tool-calls.json`
- `examples/custom-workflow-template.json`

### Step 30: Update README.md
- Project overview
- Quick start guide
- Feature list
- Screenshots
- Contributing guidelines
- License

---

## Phase 11: Packaging and Deployment

### Step 31: Build Electron App
```powershell
cd widget
npm run build
```

### Step 32: Create Installer
```powershell
npm run dist
```

### Step 33: Create Setup Script
- `scripts/setup/install-all.ps1` (one-click setup)
- Automates: Ollama install, model pulling, n8n setup, widget installation

### Step 34: Create Startup Script
- `scripts/deployment/start-services.ps1`
- Starts: n8n, verifies Ollama, launches widget

---

## Phase 12: Testing and Hardening

### Step 35: Security Audit
- Review safety rules
- Test path traversal attacks
- Test injection attempts
- Verify all confirmations trigger correctly

### Step 36: Performance Testing
- Test with long conversations
- Memory usage monitoring
- Response time benchmarks

### Step 37: Edge Case Testing
- Test with malformed inputs
- Test when services are down
- Test with very long messages
- Test concurrent requests

---

## Phase 13: Optional Enhancements

### Step 38: Add Voice Input (Optional)
- Implement audio capture in widget
- Test Whisper integration

### Step 39: Add TTS Output (Optional)
- Integrate Windows SAPI or Piper TTS
- Add speech output toggle

### Step 40: Add Custom Workflows (Optional)
- Weather tool (API integration)
- Calendar tool (Outlook integration)
- Browser automation tool

---

# 11. Additional Considerations

## 11.1 Error Handling Strategy

### Widget-Level Errors
- Network errors: Show "Connection lost" indicator
- Invalid responses: Display error message with retry option
- Crashes: Auto-restart with last state recovery

### n8n-Level Errors
- Workflow errors: Return structured error to widget
- Timeout errors: Configurable timeout per tool
- Ollama unavailable: Fallback to error message

### Tool-Level Errors
- File not found: Return clear error with suggestions
- Permission denied: Request user to grant permissions
- Script execution failure: Log error, return safe message

## 11.2 Performance Optimization

### Widget
- Lazy load components
- Debounce user input
- Virtual scrolling for long message lists

### n8n
- Workflow caching where possible
- Parallel execution of independent tools
- Connection pooling for Ollama

### Memory
- LRU cache for frequent queries
- Periodic cleanup of old conversations
- Compression for large conversation histories

## 11.3 Privacy and Data Retention

### Data Stored Locally
- All conversations: `memory/json-store/conversation-history.json`
- User preferences: `memory/json-store/user-preferences.json`
- Logs: `logs/` directory

### Data Retention Policy
- Conversations: Keep last 90 days (configurable)
- Logs: Keep last 30 days
- Cache: Clear weekly

### User Control
- Settings panel to clear all data
- Export conversation history
- Disable logging (not recommended)

## 11.4 Extensibility

### Adding New Tools
1. Create JSON schema in `schemas/`
2. Write prompt in `prompts/tools/`
3. Create n8n workflow in `n8n-workflows/tools/`
4. Add PowerShell/Python script if needed
5. Update tool allowlist in `config/tool-allowlist.json`
6. Update safety rules if needed
7. Test independently, then integrate

### Custom Prompts
- Users can edit prompts in `prompts/` directory
- Changes take effect on next n8n workflow execution

### Custom Workflows
- Use `examples/custom-workflow-template.json` as starting point
- Import to n8n via UI

## 11.5 Troubleshooting

### Common Issues and Solutions

**Widget won't start**
- Check logs: `logs/widget.log`
- Verify n8n is running: `curl http://localhost:5678/healthz`
- Check configuration: `config/default-config.json`

**Ollama not responding**
- Restart Ollama service
- Check model is pulled: `ollama list`
- Verify port: `curl http://localhost:11434/api/tags`

**n8n workflow errors**
- Check n8n logs in Docker: `docker logs n8n`
- Verify webhook URL is correct
- Test workflow manually in n8n UI

**Tool execution fails**
- Check PowerShell execution policy: `Get-ExecutionPolicy`
- Verify script paths in n8n workflows
- Check file permissions

**Memory issues**
- Clear cache: Delete files in `memory/cache/`
- Reduce conversation history retention
- Check available disk space

## 11.6 Development Best Practices

### Code Style
- TypeScript: Use ESLint with recommended rules
- PowerShell: Follow PSScriptAnalyzer guidelines
- n8n: Use descriptive node names, add comments

### Version Control
- Commit frequently with clear messages
- Use feature branches for new tools
- Tag releases with semantic versioning

### Documentation
- Update docs/ when adding features
- Include examples for new tools
- Document breaking changes in CHANGELOG.md

### Testing
- Write tests before implementing features (TDD)
- Maintain >80% code coverage
- Run full test suite before releases

---

# Conclusion

This plan provides a complete blueprint for building SADIE from the ground up. The modular architecture ensures each component can be developed and tested independently, while the multi-layer safety system provides confidence in local automation.

**Next Steps**:
1. Review and approve this plan
2. Request code generation for specific components
3. Begin implementation following the build order

**Key Success Factors**:
- Strict adherence to safety rules
- Thorough testing at each phase
- Clear documentation for maintainability
- Modular design for easy extensibility

**Estimated Timeline** (1 developer):
- Phase 1-4 (Setup + Planning): 1-2 days
- Phase 5-6 (n8n + Scripts): 3-5 days
- Phase 7 (Widget): 5-7 days
- Phase 8-9 (Memory + Testing): 2-3 days
- Phase 10-11 (Polish + Packaging): 2-3 days
- Phase 12 (Hardening): 2-3 days

**Total**: ~2-3 weeks for MVP, 4-6 weeks for production-ready

---

**Plan Status**: ✅ COMPLETE  
**Ready for Implementation**: YES  
**Awaiting**: User approval to begin code generation
