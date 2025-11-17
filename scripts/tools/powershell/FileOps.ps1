# ============================================================================
# SADIE File Operations Script
# ============================================================================
# Purpose: Safe file operations (read, write, list, move, delete, search)
# Safety: Enforces whitelisted directories and blocked file types
# Returns: JSON output for n8n workflow consumption
# ============================================================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('read', 'write', 'list', 'move', 'delete', 'search', 'info')]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [string]$Path,
    
    [Parameter(Mandatory=$false)]
    [string]$Content,
    
    [Parameter(Mandatory=$false)]
    [string]$Destination,
    
    [Parameter(Mandatory=$false)]
    [string]$Pattern,
    
    [Parameter(Mandatory=$false)]
    [bool]$Confirmed = $false
)

# ============================================================================
# SAFETY CONFIGURATION
# ============================================================================

$ALLOWED_DIRECTORIES = @(
    "C:\Users\adenk\Documents",
    "C:\Users\adenk\Desktop",
    "C:\Users\adenk\Downloads"
)

$BLOCKED_DIRECTORIES = @(
    "C:\Windows",
    "C:\Program Files",
    "C:\Program Files (x86)",
    "C:\ProgramData",
    "C:\Users\adenk\AppData"
)

$BLOCKED_EXTENSIONS = @(
    ".exe", ".dll", ".sys", ".bat", ".cmd", ".ps1", 
    ".vbs", ".com", ".scr", ".msi", ".reg"
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Test-SafePath {
    param([string]$TestPath)
    
    if ([string]::IsNullOrWhiteSpace($TestPath)) {
        return @{ Valid = $false; Reason = "Path is empty or null" }
    }
    
    try {
        $resolvedPath = [System.IO.Path]::GetFullPath($TestPath)
    } catch {
        return @{ Valid = $false; Reason = "Invalid path format: $($_.Exception.Message)" }
    }
    
    # Check if path is in allowed directories
    $isAllowed = $false
    foreach ($allowedDir in $ALLOWED_DIRECTORIES) {
        if ($resolvedPath.StartsWith($allowedDir, [StringComparison]::OrdinalIgnoreCase)) {
            $isAllowed = $true
            break
        }
    }
    
    if (-not $isAllowed) {
        return @{ Valid = $false; Reason = "Path '$resolvedPath' is not in allowed directories" }
    }
    
    # Check if path is in blocked directories
    foreach ($blockedDir in $BLOCKED_DIRECTORIES) {
        if ($resolvedPath.StartsWith($blockedDir, [StringComparison]::OrdinalIgnoreCase)) {
            return @{ Valid = $false; Reason = "Path '$resolvedPath' is in blocked system directory" }
        }
    }
    
    # Check file extension if it's a file
    if (Test-Path $resolvedPath -PathType Leaf) {
        $extension = [System.IO.Path]::GetExtension($resolvedPath)
        if ($BLOCKED_EXTENSIONS -contains $extension) {
            return @{ Valid = $false; Reason = "File extension '$extension' is blocked for safety" }
        }
    }
    
    return @{ Valid = $true; Reason = "Path is safe"; ResolvedPath = $resolvedPath }
}

function Write-JsonOutput {
    param(
        [bool]$Success,
        [string]$Message,
        [object]$Data = $null,
        [string]$Error = $null
    )
    
    $output = @{
        success = $Success
        message = $Message
        action = $Action
        timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
    }
    
    if ($Data) { $output.data = $Data }
    if ($Error) { $output.error = $Error }
    
    return ($output | ConvertTo-Json -Depth 10 -Compress)
}

# ============================================================================
# FILE OPERATION HANDLERS
# ============================================================================

function Invoke-ReadFile {
    $pathCheck = Test-SafePath -TestPath $Path
    if (-not $pathCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Cannot read file" -Error $pathCheck.Reason
    }
    
    if (-not (Test-Path $pathCheck.ResolvedPath)) {
        return Write-JsonOutput -Success $false -Message "File not found" -Error "Path does not exist: $($pathCheck.ResolvedPath)"
    }
    
    try {
        $fileContent = Get-Content -Path $pathCheck.ResolvedPath -Raw -ErrorAction Stop
        $fileInfo = Get-Item $pathCheck.ResolvedPath
        
        return Write-JsonOutput -Success $true -Message "File read successfully" -Data @{
            content = $fileContent
            size = $fileInfo.Length
            name = $fileInfo.Name
            last_modified = $fileInfo.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to read file" -Error $_.Exception.Message
    }
}

function Invoke-WriteFile {
    $pathCheck = Test-SafePath -TestPath $Path
    if (-not $pathCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Cannot write file" -Error $pathCheck.Reason
    }
    
    if ([string]::IsNullOrWhiteSpace($Content)) {
        return Write-JsonOutput -Success $false -Message "Cannot write empty content" -Error "Content parameter is required"
    }
    
    try {
        # Ensure directory exists
        $directory = Split-Path -Path $pathCheck.ResolvedPath -Parent
        if (-not (Test-Path $directory)) {
            New-Item -Path $directory -ItemType Directory -Force | Out-Null
        }
        
        # Write file
        Set-Content -Path $pathCheck.ResolvedPath -Value $Content -ErrorAction Stop
        $fileInfo = Get-Item $pathCheck.ResolvedPath
        
        return Write-JsonOutput -Success $true -Message "File written successfully" -Data @{
            path = $pathCheck.ResolvedPath
            size = $fileInfo.Length
            created = $fileInfo.CreationTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to write file" -Error $_.Exception.Message
    }
}

function Invoke-ListDirectory {
    $pathCheck = Test-SafePath -TestPath $Path
    if (-not $pathCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Cannot list directory" -Error $pathCheck.Reason
    }
    
    if (-not (Test-Path $pathCheck.ResolvedPath)) {
        return Write-JsonOutput -Success $false -Message "Directory not found" -Error "Path does not exist: $($pathCheck.ResolvedPath)"
    }
    
    try {
        $items = Get-ChildItem -Path $pathCheck.ResolvedPath -ErrorAction Stop | ForEach-Object {
            @{
                name = $_.Name
                type = if ($_.PSIsContainer) { "directory" } else { "file" }
                size = if ($_.PSIsContainer) { $null } else { $_.Length }
                last_modified = $_.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                extension = if ($_.PSIsContainer) { $null } else { $_.Extension }
            }
        }
        
        return Write-JsonOutput -Success $true -Message "Directory listed successfully" -Data @{
            path = $pathCheck.ResolvedPath
            items = @($items)
            count = $items.Count
        }
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to list directory" -Error $_.Exception.Message
    }
}

function Invoke-MoveFile {
    if (-not $Confirmed) {
        return Write-JsonOutput -Success $false -Message "Move operation requires confirmation" -Error "User confirmation required"
    }
    
    $sourceCheck = Test-SafePath -TestPath $Path
    if (-not $sourceCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Invalid source path" -Error $sourceCheck.Reason
    }
    
    $destCheck = Test-SafePath -TestPath $Destination
    if (-not $destCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Invalid destination path" -Error $destCheck.Reason
    }
    
    if (-not (Test-Path $sourceCheck.ResolvedPath)) {
        return Write-JsonOutput -Success $false -Message "Source not found" -Error "Source path does not exist"
    }
    
    try {
        # Ensure destination directory exists
        $destDir = if (Test-Path $destCheck.ResolvedPath -PathType Container) {
            $destCheck.ResolvedPath
        } else {
            Split-Path -Path $destCheck.ResolvedPath -Parent
        }
        
        if (-not (Test-Path $destDir)) {
            New-Item -Path $destDir -ItemType Directory -Force | Out-Null
        }
        
        Move-Item -Path $sourceCheck.ResolvedPath -Destination $destCheck.ResolvedPath -Force -ErrorAction Stop
        
        return Write-JsonOutput -Success $true -Message "File moved successfully" -Data @{
            from = $sourceCheck.ResolvedPath
            to = $destCheck.ResolvedPath
        }
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to move file" -Error $_.Exception.Message
    }
}

function Invoke-DeleteFile {
    if (-not $Confirmed) {
        return Write-JsonOutput -Success $false -Message "Delete operation requires confirmation" -Error "User confirmation required"
    }
    
    $pathCheck = Test-SafePath -TestPath $Path
    if (-not $pathCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Cannot delete file" -Error $pathCheck.Reason
    }
    
    if (-not (Test-Path $pathCheck.ResolvedPath)) {
        return Write-JsonOutput -Success $false -Message "File not found" -Error "Path does not exist"
    }
    
    try {
        $itemName = Split-Path -Path $pathCheck.ResolvedPath -Leaf
        Remove-Item -Path $pathCheck.ResolvedPath -Force -ErrorAction Stop
        
        return Write-JsonOutput -Success $true -Message "File deleted successfully" -Data @{
            deleted = $itemName
            path = $pathCheck.ResolvedPath
        }
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to delete file" -Error $_.Exception.Message
    }
}

function Invoke-SearchFiles {
    $pathCheck = Test-SafePath -TestPath $Path
    if (-not $pathCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Cannot search directory" -Error $pathCheck.Reason
    }
    
    if ([string]::IsNullOrWhiteSpace($Pattern)) {
        $Pattern = "*"
    }
    
    try {
        $results = Get-ChildItem -Path $pathCheck.ResolvedPath -Filter $Pattern -Recurse -File -ErrorAction Stop | ForEach-Object {
            # Re-validate each found file is safe
            $fileCheck = Test-SafePath -TestPath $_.FullName
            if ($fileCheck.Valid) {
                @{
                    name = $_.Name
                    path = $_.FullName
                    size = $_.Length
                    extension = $_.Extension
                    last_modified = $_.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                }
            }
        } | Where-Object { $_ -ne $null }
        
        return Write-JsonOutput -Success $true -Message "Search completed" -Data @{
            pattern = $Pattern
            search_path = $pathCheck.ResolvedPath
            results = @($results)
            count = $results.Count
        }
    } catch {
        return Write-JsonOutput -Success $false -Message "Search failed" -Error $_.Exception.Message
    }
}

function Invoke-GetFileInfo {
    $pathCheck = Test-SafePath -TestPath $Path
    if (-not $pathCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Cannot get file info" -Error $pathCheck.Reason
    }
    
    if (-not (Test-Path $pathCheck.ResolvedPath)) {
        return Write-JsonOutput -Success $false -Message "File not found" -Error "Path does not exist"
    }
    
    try {
        $item = Get-Item $pathCheck.ResolvedPath -ErrorAction Stop
        
        return Write-JsonOutput -Success $true -Message "File info retrieved" -Data @{
            name = $item.Name
            full_path = $item.FullName
            type = if ($item.PSIsContainer) { "directory" } else { "file" }
            size = if ($item.PSIsContainer) { $null } else { $item.Length }
            extension = if ($item.PSIsContainer) { $null } else { $item.Extension }
            created = $item.CreationTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            modified = $item.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            accessed = $item.LastAccessTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            is_readonly = $item.IsReadOnly
        }
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to get file info" -Error $_.Exception.Message
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

try {
    switch ($Action) {
        'read'   { Invoke-ReadFile }
        'write'  { Invoke-WriteFile }
        'list'   { Invoke-ListDirectory }
        'move'   { Invoke-MoveFile }
        'delete' { Invoke-DeleteFile }
        'search' { Invoke-SearchFiles }
        'info'   { Invoke-GetFileInfo }
        default  { Write-JsonOutput -Success $false -Message "Invalid action" -Error "Unknown action: $Action" }
    }
} catch {
    Write-JsonOutput -Success $false -Message "Unexpected error" -Error $_.Exception.Message
}
