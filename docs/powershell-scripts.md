# PowerShell Scripts Documentation

## Overview

SADIE's PowerShell scripts provide safe, validated tool operations with strict safety enforcement. All scripts return JSON output compatible with n8n workflows.

---

## Scripts

### 1. FileOps.ps1

**Purpose**: Core file operations with path whitelisting and safety validation.

**Parameters**:
- `Action` (required): `read`, `write`, `list`, `move`, `delete`, `search`, `info`
- `Path` (conditional): File or directory path
- `Content` (for write): File content to write
- `Destination` (for move): Destination path
- `Pattern` (for search): Search pattern (wildcards supported)
- `Confirmed` (boolean): User confirmation flag

**Safety Features**:
- Whitelisted directories only (Documents, Desktop, Downloads)
- Blocks system directories (Windows, Program Files, AppData)
- Blocks dangerous file extensions (.exe, .dll, .sys, .bat, .ps1, etc.)
- Requires confirmation for delete/move operations
- Full path resolution and validation

**Example Usage**:
```powershell
# List directory
.\FileOps.ps1 -Action list -Path "C:\Users\adenk\Documents"

# Read file
.\FileOps.ps1 -Action read -Path "C:\Users\adenk\Desktop\notes.txt"

# Search files
.\FileOps.ps1 -Action search -Path "C:\Users\adenk\Documents" -Pattern "*.pdf"

# Delete file (requires confirmation)
.\FileOps.ps1 -Action delete -Path "C:\Users\adenk\Desktop\temp.txt" -Confirmed $true
```

**Output Schema**:
```json
{
  "success": true,
  "message": "File read successfully",
  "action": "read",
  "timestamp": "2025-11-17T12:34:56.789Z",
  "data": {
    "content": "...",
    "size": 1024,
    "name": "notes.txt",
    "last_modified": "2025-11-17T10:00:00.000Z"
  }
}
```

---

### 2. SystemInfo.ps1

**Purpose**: Retrieve system information (read-only, no modifications).

**Parameters**:
- `InfoType` (required): `system`, `disk`, `memory`, `processes`, `network`, `all`
- `TopProcesses` (optional): Number of top processes to return (default: 10)

**Information Types**:
- **system**: OS, computer name, hardware, uptime
- **disk**: Drive usage, free space, percentages
- **memory**: RAM usage, available memory
- **processes**: Top CPU/memory consuming processes
- **network**: Active network adapters, IP addresses
- **all**: Complete system snapshot

**Example Usage**:
```powershell
# Get disk information
.\SystemInfo.ps1 -InfoType disk

# Get all system info
.\SystemInfo.ps1 -InfoType all

# Get top 20 processes
.\SystemInfo.ps1 -InfoType processes -TopProcesses 20
```

**Output Schema**:
```json
{
  "success": true,
  "message": "System information retrieved successfully",
  "info_type": "disk",
  "timestamp": "2025-11-17T12:34:56.789Z",
  "data": {
    "drives": [
      {
        "drive": "C:",
        "used_gb": 150.25,
        "free_gb": 349.75,
        "total_gb": 500.0,
        "used_percent": 30.1
      }
    ],
    "drive_count": 1
  }
}
```

---

### 3. SafetyValidation.ps1

**Purpose**: Pre-execution safety validation for all tool calls.

**Parameters**:
- `ToolName` (required): Name of the tool being invoked
- `Action` (required): Action being performed
- `Parameters` (hashtable): Tool-specific parameters to validate
- `UserConfirmed` (boolean): Whether user has confirmed the action

**Validation Checks**:
- Path safety (whitelists/blacklists)
- File extension restrictions
- Confirmation requirements
- API endpoint validation
- Email recipient limits
- Privacy warnings for screenshots

**Example Usage**:
```powershell
# Validate file delete
.\SafetyValidation.ps1 -ToolName "file_manager" -Action "delete" `
  -Parameters @{Path="C:\Users\adenk\Desktop\test.txt"} -UserConfirmed $true

# Validate email send
.\SafetyValidation.ps1 -ToolName "email_manager" -Action "send" `
  -Parameters @{to="user@example.com"} -UserConfirmed $false
```

**Output Schema**:
```json
{
  "is_valid": false,
  "message": "Safety validation failed with 1 violation(s)",
  "tool_name": "file_manager",
  "action": "delete",
  "violations": ["Path 'C:\\Windows\\System32\\file.dll' targets blocked system directory"],
  "warnings": [],
  "requires_confirmation": true,
  "user_confirmed": false,
  "timestamp": "2025-11-17T12:34:56.789Z"
}
```

---

### 4. ArchiveOps.ps1

**Purpose**: Safe ZIP file operations with size limits and malware checks.

**Parameters**:
- `Action` (required): `extract`, `create`, `list`
- `ArchivePath` (for extract/list): Path to ZIP file
- `Destination` (conditional): Extraction/creation destination
- `Files` (for create): Array of files to archive
- `Confirmed` (boolean): User confirmation (required for suspicious files)

**Safety Features**:
- Maximum extracted size: 500 MB
- Maximum file count: 1000 files
- Detects path traversal attempts
- Warns about executable files in archives
- Validates all paths before extraction

**Example Usage**:
```powershell
# List archive contents
.\ArchiveOps.ps1 -Action list -ArchivePath "C:\Users\adenk\Downloads\files.zip"

# Extract archive
.\ArchiveOps.ps1 -Action extract `
  -ArchivePath "C:\Users\adenk\Downloads\files.zip" `
  -Destination "C:\Users\adenk\Documents\extracted"

# Create archive
.\ArchiveOps.ps1 -Action create `
  -Destination "C:\Users\adenk\Desktop\backup.zip" `
  -Files @("C:\Users\adenk\Documents\file1.txt", "C:\Users\adenk\Documents\file2.pdf")
```

**Output Schema**:
```json
{
  "success": true,
  "message": "Archive extracted successfully",
  "action": "extract",
  "timestamp": "2025-11-17T12:34:56.789Z",
  "data": {
    "archive": "C:\\Users\\adenk\\Downloads\\files.zip",
    "destination": "C:\\Users\\adenk\\Documents\\extracted",
    "file_count": 15,
    "total_size_mb": 25.6
  }
}
```

---

## Integration with n8n

### Script Execution Node Configuration

Use n8n's **Execute Command** node with PowerShell:

```json
{
  "command": "powershell.exe -ExecutionPolicy Bypass -File \"C:\\Users\\adenk\\Desktop\\sadie\\scripts\\tools\\powershell\\FileOps.ps1\" -Action \"{{ $json.action }}\" -Path \"{{ $json.path }}\"",
  "cwd": "C:\\Users\\adenk\\Desktop\\sadie"
}
```

### Parsing Script Output

Add a **Code** node after execution:

```javascript
const stdout = $input.item.json.stdout;
let result;

try {
  result = JSON.parse(stdout);
} catch (error) {
  result = {
    success: false,
    error: "Failed to parse script output",
    raw_output: stdout
  };
}

return { json: result };
```

---

## Error Handling

All scripts follow consistent error handling:

1. **Parameter Validation**: Invalid parameters return error immediately
2. **Safety Checks**: Unsafe operations blocked with clear error messages
3. **Try/Catch**: All operations wrapped in error handlers
4. **JSON Output**: Always returns valid JSON, even on error
5. **Error Logging**: Errors include timestamp and context

**Error Response Example**:
```json
{
  "success": false,
  "message": "Failed to read file",
  "action": "read",
  "timestamp": "2025-11-17T12:34:56.789Z",
  "error": "Access to the path 'C:\\Users\\adenk\\Documents\\protected.txt' is denied."
}
```

---

## Testing

### Test Cases for Phase 8

#### FileOps.ps1 Tests
- ✅ Read file in allowed directory
- ✅ Write file in allowed directory
- ❌ Read file in blocked directory (should fail)
- ❌ Delete file without confirmation (should fail)
- ✅ Search files with pattern
- ❌ Access .exe file (should fail)
- ✅ List directory contents
- ✅ Get file info

#### SystemInfo.ps1 Tests
- ✅ Get system information
- ✅ Get disk usage
- ✅ Get memory stats
- ✅ Get top processes
- ✅ Get network adapters
- ✅ Get all information

#### SafetyValidation.ps1 Tests
- ❌ Validate blocked path (should fail)
- ✅ Validate allowed path
- ❌ Validate without confirmation (should require confirmation)
- ❌ Validate dangerous extension (should fail)
- ✅ Validate safe file operation
- ❌ Validate system directory access (should fail)

#### ArchiveOps.ps1 Tests
- ✅ List ZIP contents
- ✅ Extract small archive
- ❌ Extract oversized archive (should fail)
- ❌ Extract archive with path traversal (should fail)
- ✅ Create new archive
- ❌ Extract archive with executables without confirmation (should fail)

---

## Dependencies

- **PowerShell 5.1+**: Core runtime
- **.NET Framework**: For System.IO.Compression (ZIP operations)
- **CIM/WMI**: For system information gathering
- **File System Access**: Read/write permissions in allowed directories

---

## Security Notes

1. **Execution Policy**: Scripts require `-ExecutionPolicy Bypass` flag
2. **Path Traversal**: All paths resolved to absolute before validation
3. **Confirmation**: Destructive operations require explicit user confirmation
4. **Logging**: Consider adding audit logs for sensitive operations
5. **Network Isolation**: Scripts don't make external network calls

---

## Future Enhancements (Phase 7+)

1. **File Versioning**: Create backups before modifications
2. **Checksum Validation**: Verify file integrity
3. **Encryption Support**: Encrypt/decrypt sensitive files
4. **Advanced Search**: Content-based file search
5. **Batch Operations**: Process multiple files in single call
6. **Progress Reporting**: Real-time progress for long operations
7. **Rollback Support**: Undo recent file operations
8. **Cloud Integration**: OneDrive/Dropbox sync (with user consent)
