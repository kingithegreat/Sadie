# Sadie API Documentation

## Architecture

Sadie consists of several key components:

1. **Desktop Widget** (PyQt5) - User interface
2. **Core Assistant** - Main logic and orchestration
3. **Ollama Client** - AI model integration
4. **Module Router** - Routes actions to appropriate modules
5. **Safety Validator** - Ensures safe operations
6. **Modules** - Specialized functionality handlers
7. **n8n Integration** - Workflow automation (optional)

## Module System

### Available Modules

#### File Actions Module
Handles file system operations.

**Actions:**
- `file_read` - Read file contents
- `file_write` - Write to file
- `file_delete` - Delete file (requires confirmation)
- `file_move` - Move file (requires confirmation)
- `file_copy` - Copy file
- `file_list` - List directory contents
- `file_info` - Get file information

**Parameters:**
```python
{
    "action": "file_read",
    "params": {
        "path": "/path/to/file.txt"
    }
}
```

#### Vision Module
Handles image analysis and OCR.

**Actions:**
- `image_describe` - Describe image using LLaVA
- `image_ocr` - Extract text using OCR
- `image_analyze` - Both description and OCR

**Parameters:**
```python
{
    "action": "image_describe",
    "params": {
        "path": "/path/to/image.jpg",
        "prompt": "What do you see?"  # optional
    }
}
```

#### Voice Module
Handles speech-to-text using Whisper.

**Actions:**
- `voice_transcribe` - Transcribe audio file
- `voice_record` - Record audio from microphone

**Parameters:**
```python
{
    "action": "voice_transcribe",
    "params": {
        "path": "/path/to/audio.wav",
        "language": "en"  # optional
    }
}
```

#### Email Module
Handles email operations.

**Actions:**
- `email_draft` - Create email draft
- `email_send` - Send email (requires confirmation)

**Parameters:**
```python
{
    "action": "email_draft",
    "params": {
        "recipient": "user@example.com",
        "subject": "Subject line",
        "body": "Email content"
    }
}
```

#### API Module
Handles external API calls.

**Actions:**
- `api_get` - Make GET request
- `api_post` - Make POST request

**Parameters:**
```python
{
    "action": "api_get",
    "params": {
        "url": "https://api.example.com/data",
        "headers": {},  # optional
        "params": {}    # optional query params
    }
}
```

#### Memory Module
Handles conversation history and context.

**Actions:**
- `memory_save` - Save to memory
- `memory_recall` - Recall history
- `memory_get_context` - Get context value
- `memory_set_context` - Set context value
- `memory_clear` - Clear memory

**Parameters:**
```python
{
    "action": "memory_recall",
    "params": {
        "limit": 10,
        "role": "user"  # optional filter
    }
}
```

#### Planning Module
Handles task planning and decomposition.

**Actions:**
- `plan_task` - Create task plan
- `plan_validate` - Validate plan safety

**Parameters:**
```python
{
    "action": "plan_task",
    "params": {
        "task": "Organize my documents"
    }
}
```

## Python API

### Using Sadie Programmatically

```python
from sadie.core.assistant import get_assistant

# Get assistant instance
assistant = get_assistant()

# Process a message
result = assistant.process_message("Hello Sadie")
print(result['response'])

# Execute an action directly
result = assistant.execute_action('file_read', {
    'path': 'C:/Users/Me/Documents/file.txt'
})

if result['success']:
    print(result['content'])
else:
    print(result['error'])
```

### Using Modules Directly

```python
from sadie.modules.file_actions import FileActionsModule

# Create module instance
file_module = FileActionsModule()

# Execute action
result = file_module.execute('file_list', {
    'path': 'C:/Users/Me/Documents',
    'pattern': '*.txt'
})

print(result['files'])
```

### Configuration

```python
from sadie.core.config import get_config

config = get_config()

# Get configuration values
ollama_url = config.get('ollama.url')
is_enabled = config.is_module_enabled('vision')
requires_confirm = config.requires_confirmation('file_delete')
```

### Safety Validation

```python
from sadie.core.safety import get_safety_validator

validator = get_safety_validator()

# Validate an action
is_safe, message = validator.validate_action('file_delete', {
    'path': 'C:/Users/Me/Documents/old.txt'
})

if not is_safe:
    print(f"Action blocked: {message}")
    suggestion = validator.get_safe_alternative('file_delete', message)
    print(f"Alternative: {suggestion}")
```

## n8n Integration

### Webhook Format

Sadie sends requests to n8n in this format:

```json
{
  "type": "tool_call",
  "data": {
    "action": "action_name",
    "params": {
      "param1": "value1"
    }
  }
}
```

Or for queries:

```json
{
  "type": "query",
  "query": "user message",
  "context": {}
}
```

### Response Format

n8n should respond with:

```json
{
  "success": true,
  "data": {},
  "message": "Action completed"
}
```

### Importing the Workflow

1. Start n8n: `n8n start`
2. Open http://localhost:5678
3. Go to Workflows → Import from File
4. Select `src/sadie/n8n_workflows/sadie_workflow.json`
5. Activate the workflow

## Response Format

All module actions return a dictionary with:

```python
{
    "success": bool,          # Whether action succeeded
    "error": str,             # Error message if failed (optional)
    "message": str,           # Success message (optional)
    "data": {},               # Action-specific data
    "requires_confirmation": bool,  # If user confirmation needed
    "suggestion": str         # Alternative suggestion (optional)
}
```

## Error Handling

Common error types:

1. **Safety Error** - Action blocked by safety validator
2. **Module Error** - Module execution failed
3. **Connection Error** - Ollama/n8n not accessible
4. **File Error** - File not found or access denied
5. **Configuration Error** - Invalid configuration

All errors include descriptive messages and suggestions when available.

## Extending Sadie

### Adding a Custom Module

1. Create module file in `src/sadie/modules/`
2. Implement `execute(action, params)` method
3. Register in `ModuleRouter` in `core/module_router.py`
4. Add configuration in `config/config.yaml`

Example:

```python
class CustomModule:
    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if action == 'custom_action':
            return self._custom_action(params)
        return {"success": False, "error": "Unknown action"}
    
    def _custom_action(self, params):
        # Your implementation
        return {"success": True, "data": {}}
```

### Adding Safety Rules

Edit `src/sadie/core/safety.py` to add custom validation:

```python
def _validate_custom_action(self, params):
    # Your validation logic
    if not_safe:
        return False, "Reason it's not safe"
    return True, "Action is safe"
```

## Best Practices

1. Always validate user input
2. Use safety validator for potentially dangerous operations
3. Provide clear error messages with suggestions
4. Log important actions for debugging
5. Handle exceptions gracefully
6. Request confirmation for destructive operations
7. Keep modules focused and single-purpose
8. Document your code and configuration options
