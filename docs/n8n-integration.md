# n8n Workflow Integration Guide

## Integrating PowerShell Scripts into n8n Workflows

This guide shows how to wire PowerShell scripts into existing SADIE n8n workflows.

---

## File Manager Workflow Update

### Current Workflow Structure
`n8n-workflows/tools/file-manager.json`

### Changes Needed

1. **Replace Execute Command nodes** with proper PowerShell script calls
2. **Add JSON parsing** after script execution
3. **Add error handling** for script failures

### Updated Node Configuration

#### Execute Command Node (for any file operation)

```json
{
  "parameters": {
    "command": "powershell.exe -ExecutionPolicy Bypass -NoProfile -File \"C:\\Users\\adenk\\Desktop\\sadie\\scripts\\tools\\powershell\\FileOps.ps1\" -Action \"={{ $json.params.action }}\" -Path \"={{ $json.params.file_path || $json.params.directory_path }}\" {{ $json.params.content ? `-Content \"${$json.params.content}\"` : '' }} {{ $json.params.destination ? `-Destination \"${$json.params.destination}\"` : '' }} {{ $json.params.pattern ? `-Pattern \"${$json.params.pattern}\"` : '' }} -Confirmed ${{ $json.params.user_confirmed || false }}",
    "cwd": "C:\\Users\\adenk\\Desktop\\sadie"
  },
  "name": "Execute File Operation",
  "type": "n8n-nodes-base.executeCommand"
}
```

#### Parse JSON Output Node

Add this **Code** node immediately after Execute Command:

```javascript
// Parse PowerShell script JSON output
const stdout = $input.item.json.stdout || '';
const stderr = $input.item.json.stderr || '';

let result;

if (stderr) {
  result = {
    success: false,
    error: stderr,
    action: $input.item.json.params?.action || 'unknown'
  };
} else {
  try {
    result = JSON.parse(stdout);
  } catch (parseError) {
    result = {
      success: false,
      error: 'Failed to parse script output',
      raw_output: stdout,
      parse_error: parseError.message
    };
  }
}

return { json: result };
```

---

## Safety Validator Workflow Update

### Pre-execution Safety Check Node

Add this **Code** node at the start of any tool workflow:

```javascript
// Call safety validation script before tool execution
const toolCall = $input.item.json.tool_call;
const toolName = toolCall.tool_name;
const params = toolCall.parameters;
const userConfirmed = params.user_confirmed || false;

// Build parameters hashtable for PowerShell
const paramsJson = JSON.stringify(params).replace(/"/g, '\\"');

const command = `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "C:\\Users\\adenk\\Desktop\\sadie\\scripts\\tools\\powershell\\SafetyValidation.ps1" -ToolName "${toolName}" -Action "${params.action}" -Parameters (ConvertFrom-Json '${paramsJson}') -UserConfirmed $${userConfirmed}`;

return {
  json: {
    ...toolCall,
    validation_command: command
  }
};
```

---

## System Info Workflow Update

### System Info Node

Replace existing system info collection with:

```json
{
  "parameters": {
    "command": "powershell.exe -ExecutionPolicy Bypass -NoProfile -File \"C:\\Users\\adenk\\Desktop\\sadie\\scripts\\tools\\powershell\\SystemInfo.ps1\" -InfoType \"={{ $json.params.info_type || 'all' }}\" -TopProcesses {{ $json.params.top_processes || 10 }}",
    "cwd": "C:\\Users\\adenk\\Desktop\\sadie"
  },
  "name": "Get System Information",
  "type": "n8n-nodes-base.executeCommand"
}
```

---

## Archive Operations (New Workflow)

Create: `n8n-workflows/tools/archive-ops.json`

### Workflow Structure

```
Start Node
  ↓
Parse Parameters
  ↓
Execute ArchiveOps.ps1
  ↓
Parse JSON Output
  ↓
Format Result
```

### Execute Archive Operation Node

```json
{
  "parameters": {
    "command": "powershell.exe -ExecutionPolicy Bypass -NoProfile -File \"C:\\Users\\adenk\\Desktop\\sadie\\scripts\\tools\\powershell\\ArchiveOps.ps1\" -Action \"={{ $json.params.action }}\" {{ $json.params.archive_path ? `-ArchivePath \"${$json.params.archive_path}\"` : '' }} {{ $json.params.destination ? `-Destination \"${$json.params.destination}\"` : '' }} {{ $json.params.files ? `-Files @(${$json.params.files.map(f => `\"${f}\"`).join(',')})` : '' }} -Confirmed ${{ $json.params.user_confirmed || false }}",
    "cwd": "C:\\Users\\adenk\\Desktop\\sadie"
  },
  "name": "Execute Archive Operation",
  "type": "n8n-nodes-base.executeCommand"
}
```

---

## Tool Call Parameter Examples

### File Operations

```json
{
  "tool_call": {
    "tool_name": "file_manager",
    "parameters": {
      "action": "read",
      "file_path": "C:\\Users\\adenk\\Documents\\notes.txt"
    }
  }
}
```

```json
{
  "tool_call": {
    "tool_name": "file_manager",
    "parameters": {
      "action": "search",
      "directory_path": "C:\\Users\\adenk\\Documents",
      "pattern": "*.pdf"
    }
  }
}
```

```json
{
  "tool_call": {
    "tool_name": "file_manager",
    "parameters": {
      "action": "delete",
      "file_path": "C:\\Users\\adenk\\Desktop\\temp.txt",
      "user_confirmed": true
    }
  }
}
```

### System Information

```json
{
  "tool_call": {
    "tool_name": "system_info",
    "parameters": {
      "info_type": "disk"
    }
  }
}
```

```json
{
  "tool_call": {
    "tool_name": "system_info",
    "parameters": {
      "info_type": "processes",
      "top_processes": 20
    }
  }
}
```

### Archive Operations

```json
{
  "tool_call": {
    "tool_name": "archive_ops",
    "parameters": {
      "action": "extract",
      "archive_path": "C:\\Users\\adenk\\Downloads\\files.zip",
      "destination": "C:\\Users\\adenk\\Documents\\extracted"
    }
  }
}
```

```json
{
  "tool_call": {
    "tool_name": "archive_ops",
    "parameters": {
      "action": "create",
      "destination": "C:\\Users\\adenk\\Desktop\\backup.zip",
      "files": [
        "C:\\Users\\adenk\\Documents\\report.pdf",
        "C:\\Users\\adenk\\Documents\\data.xlsx"
      ]
    }
  }
}
```

---

## Workflow Testing Checklist

### Phase 8 Integration Tests

- [ ] Import all workflows into n8n
- [ ] Update Execute Command nodes with script paths
- [ ] Test file read operation
- [ ] Test file write operation
- [ ] Test file search operation
- [ ] Test delete with confirmation
- [ ] Test delete without confirmation (should fail)
- [ ] Test blocked path access (should fail)
- [ ] Test system info retrieval (all types)
- [ ] Test archive extraction
- [ ] Test archive creation
- [ ] Test safety validation for each tool
- [ ] Verify JSON parsing handles errors
- [ ] Verify conversation history saves correctly
- [ ] Test tool routing with real workflow IDs

---

## Error Handling Pattern

All workflows should use this error handling pattern:

```javascript
// After executing PowerShell script
const stdout = $input.item.json.stdout;
const stderr = $input.item.json.stderr;
const exitCode = $input.item.json.exitCode;

let result;

if (exitCode !== 0 || stderr) {
  // Script execution failed
  result = {
    success: false,
    error: stderr || 'Script execution failed',
    exit_code: exitCode,
    tool_name: $input.item.json.tool_name
  };
} else {
  // Parse JSON output
  try {
    result = JSON.parse(stdout);
  } catch (parseError) {
    result = {
      success: false,
      error: 'Invalid JSON output from script',
      raw_output: stdout.substring(0, 500)
    };
  }
}

// Add metadata
result.workflow_id = $workflow.id;
result.execution_id = $execution.id;
result.timestamp = new Date().toISOString();

return { json: result };
```

---

## Performance Optimization

### Script Caching

PowerShell scripts are loaded fresh on each execution. For better performance:

1. **Keep scripts small**: Each script < 500 lines
2. **Minimize file I/O**: Use in-memory operations where possible
3. **Parallel execution**: n8n can run multiple scripts concurrently
4. **Timeout settings**: Set appropriate timeouts for long operations

### Recommended Timeouts

```json
{
  "options": {
    "timeout": 30000  // 30 seconds for most operations
  }
}
```

For longer operations:
- File search: 60 seconds
- Archive extraction: 120 seconds
- System info: 30 seconds
- File operations: 30 seconds

---

## Debugging

### Enable Script Output Logging

Add to each Execute Command node:

```json
{
  "options": {
    "captureStdout": true,
    "captureStderr": true
  }
}
```

### Test Scripts Manually

Before integrating into n8n, test scripts directly:

```powershell
# Test file read
.\FileOps.ps1 -Action read -Path "C:\Users\adenk\Desktop\test.txt"

# Test with verbose output
$VerbosePreference = 'Continue'
.\FileOps.ps1 -Action list -Path "C:\Users\adenk\Documents" -Verbose
```

### n8n Execution Logs

Monitor n8n logs for script errors:

```powershell
docker logs -f sadie-n8n | Select-String "powershell"
```

---

## Next Steps

1. **Update existing workflows**: Replace placeholder Execute Command nodes
2. **Create archive-ops workflow**: New workflow for ZIP operations
3. **Update workflow routing table**: Add archive_ops workflow ID
4. **Test integration**: Run through all test cases
5. **Document edge cases**: Note any limitations discovered
6. **Plan Phase 7**: Vision and voice tool integration
