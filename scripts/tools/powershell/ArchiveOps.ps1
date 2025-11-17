# ============================================================================
# SADIE Archive Operations Script
# ============================================================================
# Purpose: Safe ZIP extraction and archiving operations
# Safety: Validates extraction paths and prevents zip bombs
# Returns: JSON output for n8n workflow consumption
# ============================================================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('extract', 'create', 'list')]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [string]$ArchivePath,
    
    [Parameter(Mandatory=$false)]
    [string]$Destination,
    
    [Parameter(Mandatory=$false)]
    [string[]]$Files,
    
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

$MAX_EXTRACTED_SIZE_MB = 500
$MAX_FILE_COUNT = 1000

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Test-SafePath {
    param([string]$TestPath)
    
    if ([string]::IsNullOrWhiteSpace($TestPath)) {
        return @{ Valid = $false; Reason = "Path is empty" }
    }
    
    try {
        $resolvedPath = [System.IO.Path]::GetFullPath($TestPath)
    } catch {
        return @{ Valid = $false; Reason = "Invalid path format" }
    }
    
    # Check blocked directories
    foreach ($blockedDir in $BLOCKED_DIRECTORIES) {
        if ($resolvedPath.StartsWith($blockedDir, [StringComparison]::OrdinalIgnoreCase)) {
            return @{ Valid = $false; Reason = "Path is in blocked directory" }
        }
    }
    
    # Check allowed directories
    $isAllowed = $false
    foreach ($allowedDir in $ALLOWED_DIRECTORIES) {
        if ($resolvedPath.StartsWith($allowedDir, [StringComparison]::OrdinalIgnoreCase)) {
            $isAllowed = $true
            break
        }
    }
    
    if (-not $isAllowed) {
        return @{ Valid = $false; Reason = "Path is not in allowed directories" }
    }
    
    return @{ Valid = $true; ResolvedPath = $resolvedPath }
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
# ARCHIVE OPERATION HANDLERS
# ============================================================================

function Invoke-ExtractArchive {
    # Validate archive path
    $archiveCheck = Test-SafePath -TestPath $ArchivePath
    if (-not $archiveCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Invalid archive path" -Error $archiveCheck.Reason
    }
    
    if (-not (Test-Path $archiveCheck.ResolvedPath)) {
        return Write-JsonOutput -Success $false -Message "Archive not found" -Error "File does not exist"
    }
    
    # Validate destination
    $destCheck = Test-SafePath -TestPath $Destination
    if (-not $destCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Invalid destination" -Error $destCheck.Reason
    }
    
    try {
        # Load ZIP assembly
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        
        # Open archive and inspect contents
        $archive = [System.IO.Compression.ZipFile]::OpenRead($archiveCheck.ResolvedPath)
        
        # Safety check: count files and total size
        $totalSize = 0
        $fileCount = 0
        $suspiciousFiles = @()
        
        foreach ($entry in $archive.Entries) {
            $fileCount++
            $totalSize += $entry.Length
            
            # Check for suspicious file types
            $ext = [System.IO.Path]::GetExtension($entry.FullName)
            if ($ext -in @('.exe', '.dll', '.sys', '.bat', '.cmd', '.ps1', '.vbs')) {
                $suspiciousFiles += $entry.FullName
            }
            
            # Check for path traversal attempts
            if ($entry.FullName -match '\.\.[/\\]') {
                $archive.Dispose()
                return Write-JsonOutput -Success $false -Message "Archive contains path traversal" -Error "Potential security risk detected"
            }
        }
        
        # Check limits
        if ($fileCount -gt $MAX_FILE_COUNT) {
            $archive.Dispose()
            return Write-JsonOutput -Success $false -Message "Archive exceeds file count limit" -Error "Archive contains $fileCount files (max: $MAX_FILE_COUNT)"
        }
        
        $totalSizeMB = [math]::Round($totalSize / 1MB, 2)
        if ($totalSizeMB -gt $MAX_EXTRACTED_SIZE_MB) {
            $archive.Dispose()
            return Write-JsonOutput -Success $false -Message "Archive exceeds size limit" -Error "Archive would extract to $totalSizeMB MB (max: $MAX_EXTRACTED_SIZE_MB MB)"
        }
        
        # Warn about suspicious files
        if ($suspiciousFiles.Count -gt 0 -and -not $Confirmed) {
            $archive.Dispose()
            return Write-JsonOutput -Success $false -Message "Archive contains suspicious files" -Error "Found $($suspiciousFiles.Count) executable files. Confirmation required." -Data @{
                suspicious_files = $suspiciousFiles
            }
        }
        
        # Close archive before extraction
        $archive.Dispose()
        
        # Ensure destination exists
        if (-not (Test-Path $destCheck.ResolvedPath)) {
            New-Item -Path $destCheck.ResolvedPath -ItemType Directory -Force | Out-Null
        }
        
        # Extract archive
        [System.IO.Compression.ZipFile]::ExtractToDirectory($archiveCheck.ResolvedPath, $destCheck.ResolvedPath)
        
        return Write-JsonOutput -Success $true -Message "Archive extracted successfully" -Data @{
            archive = $archiveCheck.ResolvedPath
            destination = $destCheck.ResolvedPath
            file_count = $fileCount
            total_size_mb = $totalSizeMB
        }
        
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to extract archive" -Error $_.Exception.Message
    }
}

function Invoke-CreateArchive {
    if (-not $Files -or $Files.Count -eq 0) {
        return Write-JsonOutput -Success $false -Message "No files specified" -Error "Files parameter is required"
    }
    
    # Validate destination path
    $destCheck = Test-SafePath -TestPath $Destination
    if (-not $destCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Invalid destination" -Error $destCheck.Reason
    }
    
    # Ensure destination has .zip extension
    if (-not $destCheck.ResolvedPath.EndsWith('.zip', [StringComparison]::OrdinalIgnoreCase)) {
        $destCheck.ResolvedPath += '.zip'
    }
    
    try {
        # Validate all source files
        $validFiles = @()
        foreach ($file in $Files) {
            $fileCheck = Test-SafePath -TestPath $file
            if (-not $fileCheck.Valid) {
                return Write-JsonOutput -Success $false -Message "Invalid source file" -Error "File '$file': $($fileCheck.Reason)"
            }
            
            if (-not (Test-Path $fileCheck.ResolvedPath)) {
                return Write-JsonOutput -Success $false -Message "Source file not found" -Error "File does not exist: $file"
            }
            
            $validFiles += $fileCheck.ResolvedPath
        }
        
        # Ensure destination directory exists
        $destDir = Split-Path -Path $destCheck.ResolvedPath -Parent
        if (-not (Test-Path $destDir)) {
            New-Item -Path $destDir -ItemType Directory -Force | Out-Null
        }
        
        # Create archive
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        
        # Delete existing archive if present
        if (Test-Path $destCheck.ResolvedPath) {
            Remove-Item $destCheck.ResolvedPath -Force
        }
        
        $archive = [System.IO.Compression.ZipFile]::Open($destCheck.ResolvedPath, 'Create')
        
        $addedFiles = @()
        foreach ($file in $validFiles) {
            $fileName = Split-Path -Path $file -Leaf
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $fileName) | Out-Null
            $addedFiles += $fileName
        }
        
        $archive.Dispose()
        
        $archiveInfo = Get-Item $destCheck.ResolvedPath
        
        return Write-JsonOutput -Success $true -Message "Archive created successfully" -Data @{
            archive = $destCheck.ResolvedPath
            file_count = $addedFiles.Count
            files = $addedFiles
            size_mb = [math]::Round($archiveInfo.Length / 1MB, 2)
        }
        
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to create archive" -Error $_.Exception.Message
    }
}

function Invoke-ListArchive {
    $archiveCheck = Test-SafePath -TestPath $ArchivePath
    if (-not $archiveCheck.Valid) {
        return Write-JsonOutput -Success $false -Message "Invalid archive path" -Error $archiveCheck.Reason
    }
    
    if (-not (Test-Path $archiveCheck.ResolvedPath)) {
        return Write-JsonOutput -Success $false -Message "Archive not found" -Error "File does not exist"
    }
    
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        
        $archive = [System.IO.Compression.ZipFile]::OpenRead($archiveCheck.ResolvedPath)
        
        $entries = @()
        $totalSize = 0
        
        foreach ($entry in $archive.Entries) {
            $entries += @{
                name = $entry.FullName
                size_bytes = $entry.Length
                size_mb = [math]::Round($entry.Length / 1MB, 4)
                compressed_size = $entry.CompressedLength
                last_modified = $entry.LastWriteTime.DateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            $totalSize += $entry.Length
        }
        
        $archive.Dispose()
        
        return Write-JsonOutput -Success $true -Message "Archive listed successfully" -Data @{
            archive = $archiveCheck.ResolvedPath
            entry_count = $entries.Count
            total_size_mb = [math]::Round($totalSize / 1MB, 2)
            entries = $entries
        }
        
    } catch {
        return Write-JsonOutput -Success $false -Message "Failed to list archive" -Error $_.Exception.Message
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

try {
    switch ($Action) {
        'extract' { Invoke-ExtractArchive }
        'create'  { Invoke-CreateArchive }
        'list'    { Invoke-ListArchive }
        default   { Write-JsonOutput -Success $false -Message "Invalid action" -Error "Unknown action: $Action" }
    }
} catch {
    Write-JsonOutput -Success $false -Message "Unexpected error" -Error $_.Exception.Message
}
