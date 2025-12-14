# n8n Workflows for SADIE

This directory contains all n8n workflow JSON files for SADIE's automation layer.

## Structure

### Core Workflows (`core/`)
These are the main orchestration workflows:

- **main-orchestrator.json**: Entry point webhook that receives user messages, calls Ollama for reasoning, routes to tools, and manages conversation history
 - **main-orchestrator-streaming.json**: Streaming-capable orchestrator that proxies Ollama chunked output and includes an inline safety check for tool calls
- **safety-validator.json**: Pre-execution safety checks for all tool calls (path validation, confirmation requirements, blocked operations)

### Tool Workflows (`tools/`)
Individual tool execution workflows:

- **file-manager.json**: File operations (read, write, list, delete, search)
- **memory-manager.json**: Context storage and retrieval (facts, preferences, search)
- **vision-tool.json**: Image analysis using LLaVA and Tesseract OCR
- **system-info.json**: System information queries (disk usage, processes, computer info)
- **planning-agent.json**: Multi-step task breakdown and planning
- **api-tool.json**: HTTP requests to external/local APIs

## Importing into n8n

1. Start your n8n instance:
   ```powershell
   cd C:\Users\adenk\Desktop\sadie
   docker-compose up -d
   ```

2. Access n8n at http://localhost:5678

3. For each workflow file:
   - Click "Add workflow" → "Import from File"
   - Select the JSON file
   - Click "Save"

4. Import order (recommended):
   - Core workflows first (main-orchestrator, safety-validator)
   - Then tool workflows

## Configuration Notes

- All workflows use absolute paths: `C:/Users/adenk/Desktop/sadie`
- Ollama endpoint: `http://localhost:11434`
 - Ollama endpoint: `http://localhost:11434`
- Primary model: `llama3.2:3b`
- Vision model: `llava:latest`
- Memory storage: `memory/json-store/` directory

## Workflow Communication

```
User Message → main-orchestrator.json
              ↓
       Ollama reasoning
              ↓
    Has tool call? → Yes → Execute tool workflow
              ↓              ↓
             No       Return tool result
              ↓              ↓
       Direct response ← ←  ←
```

## Customization

To modify workflows:
1. Import into n8n
2. Edit visually in the workflow editor
3. Export as JSON
4. Save back to this directory
5. Commit changes to Git

## Testing

Test the main webhook:
```powershell
curl -X POST http://localhost:5678/webhook/sadie/chat `
  -H "Content-Type: application/json" `
  -d '{"message": "Hello Sadie!"}'
```

To test the streaming endpoint (replace the default orchestrator):
```powershell
curl -X POST http://localhost:5678/webhook/sadie/chat/stream `
   -H "Content-Type: application/json" `
   -d '{"message": "Stream test"}'
```

Note: `main-orchestrator-streaming.json` contains an inline safety check that reads `/data/config/safety-rules.json`. Ensure the file exists in your n8n container or mount it into `/data/config` before importing. The streaming webhook will return an immediate JSON response if a tool call is blocked or requires confirmation.
