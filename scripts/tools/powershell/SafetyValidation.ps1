# ============================================================================
# SADIE Safety Validation Script
# ============================================================================
# Purpose: Pre-execution validation for all tool operations
# Safety: Enforces whitelist/blacklist rules before any action
# Returns: JSON with validation result and safety warnings
# ============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ToolName,
    
    [Parameter(Mandatory=$true)]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [hashtable]$Parameters = @{},
    
    [Parameter(Mandatory=$false)]
    [bool]$UserConfirmed = $false
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
    "C:\Users\adenk\AppData",
    "C:\System Volume Information",
    "C:\$Recycle.Bin"
)

$BLOCKED_EXTENSIONS = @(
    ".exe", ".dll", ".sys", ".bat", ".cmd", ".ps1", 
    ".vbs", ".com", ".scr", ".msi", ".reg", ".lnk"
)

$CONFIRMATION_REQUIRED = @{
    'file_manager' = @('delete', 'move')
    'email_manager' = @('send')
    'api_tool' = @('post', 'put', 'delete')
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-JsonOutput {
    param(
        [bool]$IsValid,
        [string]$Message,
        [array]$Violations = @(),
        [array]$Warnings = @(),
        [bool]$RequiresConfirmation = $false
    )
    
    $output = @{
        is_valid = $IsValid
        message = $Message
        tool_name = $ToolName
        action = $Action
        violations = @($Violations)
        warnings = @($Warnings)
        requires_confirmation = $RequiresConfirmation
        user_confirmed = $UserConfirmed
        timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
    }
    
    return ($output | ConvertTo-Json -Depth 10 -Compress)
}

function Test-PathSafety {
    param([string]$TestPath)
    
    $violations = @()
    $warnings = @()
    
    if ([string]::IsNullOrWhiteSpace($TestPath)) {
        return @{
            Valid = $true
            Violations = @()
            Warnings = @()
        }
    }
    
    try {
        $resolvedPath = [System.IO.Path]::GetFullPath($TestPath)
    } catch {
        $violations += "Invalid path format: $TestPath"
        return @{
            Valid = $false
            Violations = $violations
            Warnings = $warnings
        }
    }
    
    # Check blocked directories first (highest priority)
    foreach ($blockedDir in $BLOCKED_DIRECTORIES) {
        if ($resolvedPath.StartsWith($blockedDir, [StringComparison]::OrdinalIgnoreCase)) {
            $violations += "Path '$resolvedPath' targets blocked system directory: $blockedDir"
            return @{
                Valid = $false
                Violations = $violations
                Warnings = $warnings
            }
        }
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
        $violations += "Path '$resolvedPath' is outside allowed directories"
        return @{
            Valid = $false
            Violations = $violations
            Warnings = $warnings
        }
    }
    
    # Check file extension
    $extension = [System.IO.Path]::GetExtension($resolvedPath)
    if ($BLOCKED_EXTENSIONS -contains $extension) {
        $violations += "File extension '$extension' is blocked for safety"
        return @{
            Valid = $false
            Violations = $violations
            Warnings = $warnings
        }
    }
    
    # Warn if file doesn't exist (not a violation, just informational)
    if (-not (Test-Path $resolvedPath) -and -not $resolvedPath.EndsWith('\')) {
        $warnings += "Path does not currently exist: $resolvedPath"
    }
    
    return @{
        Valid = $true
        Violations = $violations
        Warnings = $warnings
    }
}

# ============================================================================
# VALIDATION HANDLERS
# ============================================================================

function Test-FileManagerSafety {
    $violations = @()
    $warnings = @()
    
    # Check primary path
    if ($Parameters.ContainsKey('Path') -or $Parameters.ContainsKey('file_path')) {
        $path = if ($Parameters.Path) { $Parameters.Path } else { $Parameters.file_path }
        $pathCheck = Test-PathSafety -TestPath $path
        $violations += $pathCheck.Violations
        $warnings += $pathCheck.Warnings
    }
    
    if ($Parameters.ContainsKey('directory_path')) {
        $pathCheck = Test-PathSafety -TestPath $Parameters.directory_path
        $violations += $pathCheck.Violations
        $warnings += $pathCheck.Warnings
    }
    
    # Check destination path for move operations
    if ($Parameters.ContainsKey('Destination') -or $Parameters.ContainsKey('destination')) {
        $dest = if ($Parameters.Destination) { $Parameters.Destination } else { $Parameters.destination }
        $destCheck = Test-PathSafety -TestPath $dest
        $violations += $destCheck.Violations
        $warnings += $destCheck.Warnings
    }
    
    # Check confirmation requirement
    $needsConfirmation = $CONFIRMATION_REQUIRED['file_manager'] -contains $Action
    if ($needsConfirmation -and -not $UserConfirmed) {
        $warnings += "Action '$Action' requires user confirmation"
        return @{
            Valid = $false
            Violations = $violations
            Warnings = $warnings
            RequiresConfirmation = $true
        }
    }
    
    return @{
        Valid = ($violations.Count -eq 0)
        Violations = $violations
        Warnings = $warnings
        RequiresConfirmation = $needsConfirmation
    }
}

function Test-EmailManagerSafety {
    $violations = @()
    $warnings = @()
    
    # Email sending always requires confirmation
    if ($Action -eq 'send' -and -not $UserConfirmed) {
        $warnings += "Email sending requires user confirmation"
        return @{
            Valid = $false
            Violations = $violations
            Warnings = $warnings
            RequiresConfirmation = $true
        }
    }
    
    # Check attachment paths if present
    if ($Parameters.ContainsKey('attachments')) {
        foreach ($attachment in $Parameters.attachments) {
            $pathCheck = Test-PathSafety -TestPath $attachment
            $violations += $pathCheck.Violations
            $warnings += $pathCheck.Warnings
        }
    }
    
    # Validate recipient count
    if ($Parameters.ContainsKey('to')) {
        $recipients = $Parameters.to -split ';|,'
        if ($recipients.Count -gt 10) {
            $violations += "Too many recipients: $($recipients.Count) (max 10)"
        }
    }
    
    return @{
        Valid = ($violations.Count -eq 0)
        Violations = $violations
        Warnings = $warnings
        RequiresConfirmation = ($Action -eq 'send')
    }
}

function Test-ApiToolSafety {
    $violations = @()
    $warnings = @()
    
    # API calls require confirmation by default
    if (-not $UserConfirmed) {
        $warnings += "External API calls require user confirmation"
        return @{
            Valid = $false
            Violations = $violations
            Warnings = $warnings
            RequiresConfirmation = $true
        }
    }
    
    # Check if URL is local or approved
    if ($Parameters.ContainsKey('url')) {
        $url = $Parameters.url
        $isLocal = $url -match 'localhost|127\.0\.0\.1|::1'
        
        if (-not $isLocal) {
            $warnings += "External API call to: $url"
        }
    }
    
    return @{
        Valid = ($violations.Count -eq 0)
        Violations = $violations
        Warnings = $warnings
        RequiresConfirmation = $true
    }
}

function Test-VisionToolSafety {
    $violations = @()
    $warnings = @()
    
    # Check image paths
    if ($Parameters.ContainsKey('image_path')) {
        $pathCheck = Test-PathSafety -TestPath $Parameters.image_path
        $violations += $pathCheck.Violations
        $warnings += $pathCheck.Warnings
    }
    
    # Warn about privacy considerations
    if ($Action -eq 'analyze_screenshot') {
        $warnings += "Screenshot analysis may capture sensitive information"
    }
    
    return @{
        Valid = ($violations.Count -eq 0)
        Violations = $violations
        Warnings = $warnings
        RequiresConfirmation = $false
    }
}

function Test-GenericSafety {
    return @{
        Valid = $true
        Violations = @()
        Warnings = @()
        RequiresConfirmation = $false
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

try {
    $result = switch ($ToolName) {
        'file_manager'  { Test-FileManagerSafety }
        'email_manager' { Test-EmailManagerSafety }
        'api_tool'      { Test-ApiToolSafety }
        'vision_tool'   { Test-VisionToolSafety }
        default         { Test-GenericSafety }
    }
    
    if ($result.Valid) {
        $message = "Safety validation passed"
        if ($result.Warnings.Count -gt 0) {
            $message += " with $($result.Warnings.Count) warning(s)"
        }
    } else {
        $message = "Safety validation failed with $($result.Violations.Count) violation(s)"
    }
    
    Write-JsonOutput `
        -IsValid $result.Valid `
        -Message $message `
        -Violations $result.Violations `
        -Warnings $result.Warnings `
        -RequiresConfirmation $result.RequiresConfirmation
    
} catch {
    Write-JsonOutput `
        -IsValid $false `
        -Message "Safety validation error" `
        -Violations @("Unexpected error: $($_.Exception.Message)")
}
