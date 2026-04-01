param(
    [Parameter(Mandatory=$true)][string]$Action,
    [Parameter(Mandatory=$true)][string]$LiteralPath,
    [string]$Content
)

function Output-Json($obj) {
    $obj | ConvertTo-Json -Compress
    exit 0
}

if (-not $Action) {
    Output-Json @{ success = $false; error = 'Missing Action parameter' }
}
if (-not $LiteralPath) {
    Output-Json @{ success = $false; error = 'Missing LiteralPath parameter' }
}

switch ($Action.ToLower()) {
    'read' {
        if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
            Output-Json @{ success = $false; error = 'File not found' }
        }
        try {
            $content = Get-Content -LiteralPath $LiteralPath -Raw -ErrorAction Stop
            $size = (Get-Item -LiteralPath $LiteralPath).Length
            Output-Json @{ data = $content; _fileSize = $size }
        } catch {
            Output-Json @{ success = $false; error = $_.Exception.Message }
        }
    }
    'write' {
        try {
            Set-Content -LiteralPath $LiteralPath -Value $Content -Force -ErrorAction Stop
            Output-Json @{ success = $true }
        } catch {
            Output-Json @{ success = $false; error = $_.Exception.Message }
        }
    }
    'delete' {
        if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
            Output-Json @{ success = $false; error = 'File not found' }
        }
        try {
            Remove-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
            Output-Json @{ success = $true }
        } catch {
            Output-Json @{ success = $false; error = $_.Exception.Message }
        }
    }
    Default {
        Output-Json @{ success = $false; error = 'Unknown action' }
    }
}
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
