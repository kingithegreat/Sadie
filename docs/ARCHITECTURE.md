# Sadie Architecture

This document describes the architecture and design decisions behind Sadie AI Assistant.

## Overview

Sadie is designed as a modular, extensible AI assistant that runs completely offline. The architecture emphasizes safety, privacy, and modularity.

## Core Principles

1. **Privacy First** - All processing happens locally
2. **Safety by Default** - Multiple layers of validation
3. **Modular Design** - Easy to extend and maintain
4. **Offline Operation** - No cloud dependencies
5. **User Control** - Transparent about actions and limitations

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface Layer                      │
├─────────────────┬───────────────────────────────────────────┤
│  Desktop Widget │  Command Line Interface  │  Python API    │
│    (PyQt5)      │       (CLI)              │                │
└─────────────────┴───────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Core Assistant Layer                      │
├─────────────────────────────────────────────────────────────┤
│  • Message Processing                                        │
│  • Context Management                                        │
│  • Response Generation                                       │
│  • Tool Call Extraction                                      │
└─────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
│ Ollama Client   │ │ n8n Client   │ │ Module Router│
│                 │ │  (Optional)  │ │              │
└─────────────────┘ └──────────────┘ └──────────────┘
                                             │
                        ┌────────────────────┼────────────────────┐
                        │                    │                    │
                        ▼                    ▼                    ▼
              ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐
              │ Safety Validator│  │ Config Manager  │  │    Modules   │
              └─────────────────┘  └─────────────────┘  └──────────────┘
                                                                  │
        ┌────────────┬────────────┬────────────┬────────────────┼────────────┐
        │            │            │            │                │            │
        ▼            ▼            ▼            ▼                ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│   File   │ │  Vision  │ │  Voice   │ │  Email   │ │   API    │ │ Planning │
│ Actions  │ │ (LLaVA+  │ │(Whisper) │ │          │ │          │ │          │
│          │ │   OCR)   │ │          │ │          │ │          │ │          │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
                                             │
                                             ▼
                                      ┌──────────┐
                                      │  Memory  │
                                      │ (SQLite) │
                                      └──────────┘
```

## Component Details

### 1. User Interface Layer

#### Desktop Widget (PyQt5)
- **Purpose**: Graphical user interface for Windows
- **Features**: 
  - Chat interface
  - Status indicators
  - Confirmation dialogs
  - Always-on-top option
- **Technology**: PyQt5
- **Entry Point**: `src/sadie/ui/widget.py`

#### CLI Interface
- **Purpose**: Command-line interface for terminal users
- **Features**:
  - Interactive conversations
  - Single-message mode
  - Status checking
- **Entry Point**: `src/sadie/main.py`

### 2. Core Assistant Layer

#### SadieAssistant (`core/assistant.py`)
- **Purpose**: Main orchestration and conversation management
- **Responsibilities**:
  - Process user messages
  - Manage conversation context
  - Generate AI responses
  - Extract and route tool calls
  - Coordinate between components

**Key Methods:**
```python
process_message(message, context) -> response
execute_action(action, params) -> result
check_status() -> status_dict
```

### 3. Integration Layer

#### Ollama Client (`core/ollama_client.py`)
- **Purpose**: Interface with local Ollama AI models
- **Features**:
  - Text generation
  - Chat conversations
  - Tool call extraction
  - Connection monitoring
- **Models Supported**: llama2, mistral, codellama, llava, etc.

#### n8n Client (`core/n8n_client.py`)
- **Purpose**: Optional workflow automation
- **Features**:
  - Send tool calls to n8n
  - Process complex workflows
  - External integrations
- **Note**: Optional component

#### Module Router (`core/module_router.py`)
- **Purpose**: Route actions to appropriate modules
- **Features**:
  - Action dispatching
  - Module management
  - Result aggregation
- **Routing Logic**: Action prefix → Module mapping

### 4. Safety & Configuration

#### Safety Validator (`core/safety.py`)
- **Purpose**: Validate all actions for safety
- **Checks**:
  - File path validation
  - Directory restrictions
  - Dangerous command detection
  - Action blocking
  - Confirmation requirements
- **Default Blocks**:
  - System directory access
  - Registry modifications
  - Disk formatting
  - Destructive operations

#### Config Manager (`core/config.py`)
- **Purpose**: Centralized configuration management
- **Features**:
  - YAML-based configuration
  - Module enable/disable
  - Safety settings
  - UI preferences
- **Location**: `config/config.yaml`

### 5. Modules

All modules follow a common interface:

```python
class Module:
    def execute(self, action: str, params: Dict) -> Dict:
        """Execute an action and return result"""
        pass
```

#### File Actions Module (`modules/file_actions.py`)
- **Actions**: read, write, delete, move, copy, list, info
- **Safety**: Path validation, size limits, forbidden directories
- **Use Cases**: File management, organization, reading/writing

#### Vision Module (`modules/vision.py`)
- **Actions**: image_describe, image_ocr, image_analyze
- **Technologies**: 
  - LLaVA (via Ollama) for descriptions
  - Tesseract for OCR
- **Use Cases**: Image analysis, text extraction, accessibility

#### Voice Module (`modules/voice.py`)
- **Actions**: voice_transcribe, voice_record
- **Technology**: OpenAI Whisper
- **Use Cases**: Speech-to-text, voice commands, accessibility

#### Email Module (`modules/email.py`)
- **Actions**: email_draft, email_send
- **Safety**: Confirmation required, disabled by default
- **Use Cases**: Email composition, communication

#### API Module (`modules/api.py`)
- **Actions**: api_get, api_post
- **Safety**: Domain whitelist, timeout limits
- **Use Cases**: External integrations, data fetching

#### Memory Module (`modules/memory.py`)
- **Actions**: save, recall, get_context, set_context, clear
- **Storage**: SQLite database
- **Use Cases**: Conversation history, user preferences, context

#### Planning Module (`modules/planning.py`)
- **Actions**: plan_task, plan_validate
- **Features**: Task decomposition, step validation
- **Use Cases**: Complex task planning, multi-step workflows

## Data Flow

### 1. User Message Processing

```
User Input → Widget/CLI → Assistant → Ollama
                                         ↓
                              AI Response Generated
                                         ↓
                              Tool Calls Extracted
                                         ↓
                              Module Router
                                         ↓
                         ┌───────────────┴───────────────┐
                         │                               │
                    Safety Check                    Execute Action
                         │                               │
                   ✓ Safe / ✗ Blocked              Module Logic
                         │                               │
                         └───────────────┬───────────────┘
                                         ↓
                                   Result Returned
                                         ↓
                                   Memory Saved
                                         ↓
                               Display to User
```

### 2. Action Execution Flow

```
Action Request
      ↓
Safety Validation
      ↓
   Safe? ──No──→ Return Error + Suggestion
      ↓
     Yes
      ↓
Requires Confirmation? ──Yes──→ Request User Confirmation
      ↓                               ↓
     No                          Confirmed?
      ↓                               ↓
Execute Action ←────────────────────Yes
      ↓
Return Result
```

## Security Architecture

### Multi-Layer Security

1. **Input Validation**
   - All user inputs validated
   - Path canonicalization
   - Type checking

2. **Safety Validator**
   - Action-level checks
   - Resource access control
   - Pattern matching for dangerous operations

3. **Configuration-Based Security**
   - Configurable restrictions
   - Whitelist/blacklist support
   - Module enable/disable

4. **Confirmation Layer**
   - User confirmation for risky actions
   - Clear explanation of actions
   - Undo suggestions where possible

5. **Sandboxing**
   - Limited file system access
   - No direct system command execution
   - Controlled external API access

### Threat Model

**Protected Against:**
- Accidental destructive operations
- System file modifications
- Unauthorized data access
- Malicious prompt injection (partial)

**Out of Scope:**
- Physical security
- OS-level vulnerabilities
- Network security (runs offline)

## Extension Points

### Adding a New Module

1. Create module file in `src/sadie/modules/`
2. Implement `execute(action, params)` method
3. Register in `ModuleRouter`
4. Add to config.yaml
5. Document in API.md

### Adding a New Action

1. Add method to existing module
2. Update action map in module's `execute()`
3. Add safety rules if needed
4. Document parameters and return format

### Custom Safety Rules

1. Add validation method in `SafetyValidator`
2. Call from `validate_action()`
3. Provide clear error messages
4. Suggest safe alternatives

## Performance Considerations

### Optimization Strategies

1. **Lazy Loading**: Modules loaded on first use
2. **Caching**: Configuration cached in memory
3. **Streaming**: Large file operations use streaming
4. **Background Processing**: UI uses threads for AI calls
5. **Database Indexing**: Memory module uses indexed queries

### Resource Usage

- **Memory**: ~100-500MB (depends on Ollama model)
- **Disk**: <10MB for Sadie, models vary (1-7GB each)
- **CPU**: Dependent on AI model and operations
- **Network**: None (offline operation)

## Future Architecture Plans

### Planned Enhancements

1. **Plugin System**: Load external modules dynamically
2. **Web Interface**: Browser-based UI option
3. **Mobile Support**: Android/iOS clients
4. **Multi-Model**: Support multiple AI backends
5. **Distributed**: Multi-machine coordination
6. **Enhanced Security**: Sandboxed execution environment

## Design Decisions

### Why PyQt5?
- Native Windows integration
- Rich UI capabilities
- Python ecosystem compatibility
- No web server required

### Why Ollama?
- Fully local operation
- Easy model management
- Good performance
- Active development

### Why SQLite for Memory?
- No server required
- ACID compliance
- File-based portability
- Python built-in support

### Why Modular Architecture?
- Easy to extend
- Clear separation of concerns
- Testable components
- Independent development

## Contributing to Architecture

When proposing architectural changes:

1. Open an issue describing the change
2. Explain the problem being solved
3. Consider security implications
4. Maintain backward compatibility
5. Update documentation

## References

- [API Documentation](API.md)
- [Module Implementation Guide](API.md#extending-sadie)
- [Safety Guidelines](../config/config.yaml)
- [Ollama Documentation](https://ollama.ai/docs)
