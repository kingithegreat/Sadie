# ============================================================================
# HomeBot Safety Validation Script
# ============================================================================
# Purpose: Pre-execution validation for all tool operations
# Safety: Enforces whitelist/blacklist rules before any action
# Returns: JSON with validation result and safety warnings
#
# Callers reach this script through `powershell.exe -File`, which passes EVERY
# argument as a string.  The parameters below are therefore typed [object] and
# normalised by hand — a [hashtable] or [bool] parameter cannot bind a string
# and makes the whole script throw before it validates anything.
# ============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ToolName,

    [Parameter(Mandatory=$true)]
    [string]$Action,

    # Hashtable, PSCustomObject, or a JSON string (optionally prefixed with '@',
    # which is how the n8n expression templates render it).
    [Parameter(Mandatory=$false)]
    [object]$Parameters = @{},

    # $true/$false, "true"/"false", '$true'/'$false', 1/0. Anything else is
    # treated as NOT confirmed — this gate fails closed.
    [Parameter(Mandatory=$false)]
    [object]$UserConfirmed = $false,

    # Path to config/safety-rules.json. Defaults to the copy in this repo.
    [Parameter(Mandatory=$false)]
    [string]$RulesPath
)

$script:ConfigViolations = @()
$script:ConfigWarnings = @()

# ============================================================================
# INPUT NORMALISATION
# ============================================================================

function ConvertTo-SafetyHashtable {
    <#
      Recursively converts a PSCustomObject (as produced by ConvertFrom-Json on
      PowerShell 5.1, which has no -AsHashtable) into a case-insensitive
      hashtable so ContainsKey() works the same for JSON and native callers.
    #>
    param([object]$InputObject)

    if ($null -eq $InputObject) { return @{} }
    if ($InputObject -is [hashtable]) { return $InputObject }

    $result = @{}
    if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
        foreach ($property in $InputObject.PSObject.Properties) {
            $value = $property.Value
            if ($value -is [System.Management.Automation.PSCustomObject]) {
                $value = ConvertTo-SafetyHashtable -InputObject $value
            }
            $result[$property.Name] = $value
        }
    }
    return $result
}

function Resolve-SafetyParameters {
    <#
      Returns a hashtable, or $null when the input was supplied but could not be
      understood. A $null result must fail the validation closed: parameters we
      cannot read are paths we cannot check.
    #>
    param([object]$Raw)

    if ($null -eq $Raw) { return @{} }
    if ($Raw -is [hashtable]) { return $Raw }
    if ($Raw -is [System.Management.Automation.PSCustomObject]) {
        return (ConvertTo-SafetyHashtable -InputObject $Raw)
    }

    if ($Raw -is [string]) {
        $text = $Raw.Trim()
        if ([string]::IsNullOrWhiteSpace($text)) { return @{} }
        # n8n renders `-Parameters @{{ ... | ConvertTo-Json }}` as '@' + JSON.
        if ($text.StartsWith('@')) { $text = $text.Substring(1).Trim() }
        if ([string]::IsNullOrWhiteSpace($text)) { return @{} }

        try {
            return (ConvertTo-SafetyHashtable -InputObject ($text | ConvertFrom-Json -ErrorAction Stop))
        } catch {
            # The Windows command-line parser collapses JSON's \\ escapes, so a
            # payload carrying "C:\\Users\\..." arrives as "C:\Users\..." and is
            # no longer valid JSON. Reaching here means the text did not parse
            # strictly, so every backslash in it is a literal one — re-escape and
            # retry. Well-formed JSON never gets this far.
            try {
                $repaired = $text.Replace('\', '\\')
                return (ConvertTo-SafetyHashtable -InputObject ($repaired | ConvertFrom-Json -ErrorAction Stop))
            } catch {
                return $null
            }
        }
    }

    return $null
}

function Resolve-SafetyBool {
    <# Fail-closed boolean parse: anything unrecognised is $false. #>
    param([object]$Raw)

    if ($null -eq $Raw) { return $false }
    if ($Raw -is [bool]) { return $Raw }
    if ($Raw -is [int]) { return ($Raw -ne 0) }

    $text = ([string]$Raw).Trim().TrimStart('$')
    switch -Regex ($text) {
        '^(?i:true)$'  { return $true }
        '^1$'          { return $true }
        default        { return $false }
    }
}

function Join-UserPath {
    <#
      Pure string join. Join-Path resolves the drive and throws
      "Cannot find drive" when the profile lives somewhere this session has no
      PSDrive for — which is exactly the portability case this gate must survive.
    #>
    param([string]$Base, [string]$Child)
    return [System.IO.Path]::Combine($Base, $Child)
}

function Expand-SafetyPathToken {
    <#
      Expands %USERPROFILE%-style tokens and a leading '~' so safety-rules.json
      stays portable across machines and Windows user profiles.
    #>
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
    $expanded = [System.Environment]::ExpandEnvironmentVariables($Value)
    if ($expanded -eq '~' -or $expanded.StartsWith('~\') -or $expanded.StartsWith('~/')) {
        $expanded = Join-UserPath $script:UserProfile $expanded.Substring(1).TrimStart('\', '/')
    }
    return $expanded
}

# ============================================================================
# SAFETY CONFIGURATION
# ============================================================================

# Resolve the current Windows profile at run time. Never a static username:
# the repo is cloned onto machines whose profile is not the developer's.
$script:UserProfile = $env:USERPROFILE
if ([string]::IsNullOrWhiteSpace($script:UserProfile)) { $script:UserProfile = $env:HOME }
if ([string]::IsNullOrWhiteSpace($script:UserProfile)) { $script:UserProfile = [Environment]::GetFolderPath('UserProfile') }

# Built-in defaults, used when safety-rules.json is unavailable. These are the
# restrictive set — falling back here can only ever narrow what is permitted.
$ALLOWED_DIRECTORIES = @(
    (Join-UserPath $script:UserProfile 'Documents'),
    (Join-UserPath $script:UserProfile 'Desktop'),
    (Join-UserPath $script:UserProfile 'Downloads')
)

$BLOCKED_DIRECTORIES = @(
    'C:\Windows',
    'C:\Program Files',
    'C:\Program Files (x86)',
    'C:\ProgramData',
    (Join-UserPath $script:UserProfile 'AppData'),
    'C:\System Volume Information',
    'C:\$Recycle.Bin'          # single-quoted: $Recycle must not interpolate
)

$BLOCKED_EXTENSIONS = @(
    ".exe", ".dll", ".sys", ".bat", ".cmd", ".ps1",
    ".vbs", ".com", ".scr", ".msi", ".reg", ".lnk"
)

$MAX_RECIPIENTS = 10

$CONFIRMATION_REQUIRED = @{
    'file_manager' = @('delete', 'move')
    'email_manager' = @('send')
    'api_tool' = @('post', 'put', 'delete')
}

# Destructive actions must name their target. A delete with no path parameter
# has nothing to whitelist-check, so it must not pass as "validated".
$PATH_REQUIRED_ACTIONS = @('delete', 'move')

# --- Load config/safety-rules.json ------------------------------------------

$script:RulesFileUsed = $null
$rulesPathExplicit = -not [string]::IsNullOrWhiteSpace($RulesPath)
$resolvedRulesPath = if ($rulesPathExplicit) {
    $RulesPath
} else {
    Join-Path $PSScriptRoot '..\..\..\config\safety-rules.json'
}

try {
    if (Test-Path -LiteralPath $resolvedRulesPath) {
        $rules = Get-Content -LiteralPath $resolvedRulesPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        $script:RulesFileUsed = (Resolve-Path -LiteralPath $resolvedRulesPath).Path

        $fileOps = $rules.file_operations
        if ($fileOps) {
            if ($fileOps.allowed_directories) {
                $ALLOWED_DIRECTORIES = @($fileOps.allowed_directories | ForEach-Object { Expand-SafetyPathToken $_ })
            }
            if ($fileOps.blocked_directories) {
                $BLOCKED_DIRECTORIES = @($fileOps.blocked_directories | ForEach-Object { Expand-SafetyPathToken $_ })
            }
            if ($fileOps.blocked_extensions) {
                $BLOCKED_EXTENSIONS = @($fileOps.blocked_extensions)
            }
            if ($fileOps.require_confirmation) {
                $fileConfirm = @()
                foreach ($property in $fileOps.require_confirmation.PSObject.Properties) {
                    if (Resolve-SafetyBool $property.Value) { $fileConfirm += $property.Name }
                }
                $CONFIRMATION_REQUIRED['file_manager'] = $fileConfirm
            }
        }
        if ($rules.email_operations -and $rules.email_operations.max_recipients) {
            $MAX_RECIPIENTS = [int]$rules.email_operations.max_recipients
        }
    } elseif ($rulesPathExplicit) {
        # The caller asserted a rules file. If it is not there, that is a
        # misconfiguration, not a reason to proceed.
        $script:ConfigViolations += "Safety rules file not found: $resolvedRulesPath"
    } else {
        $script:ConfigWarnings += "safety-rules.json not found; using built-in restrictive defaults"
    }
} catch {
    if ($rulesPathExplicit) {
        $script:ConfigViolations += "Safety rules file could not be read: $($_.Exception.Message)"
    } else {
        $script:ConfigWarnings += "safety-rules.json could not be read ($($_.Exception.Message)); using built-in restrictive defaults"
    }
}

# --- Normalise the caller's arguments ---------------------------------------

$script:ResolvedParameters = Resolve-SafetyParameters -Raw $Parameters
if ($null -eq $script:ResolvedParameters) {
    $script:ConfigViolations += "Tool parameters could not be parsed; cannot validate paths"
    $script:ResolvedParameters = @{}
}
$Parameters = $script:ResolvedParameters
$UserConfirmed = Resolve-SafetyBool -Raw $UserConfirmed

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
        rules_file = $script:RulesFileUsed
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
        $resolvedPath = [System.IO.Path]::GetFullPath((Expand-SafetyPathToken $TestPath))
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
        if ([string]::IsNullOrWhiteSpace($blockedDir)) { continue }
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
        if ([string]::IsNullOrWhiteSpace($allowedDir)) { continue }
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
    $sawPath = $false

    # Check primary path
    if ($Parameters.ContainsKey('Path') -or $Parameters.ContainsKey('file_path')) {
        $path = if ($Parameters.Path) { $Parameters.Path } else { $Parameters.file_path }
        $sawPath = $true
        $pathCheck = Test-PathSafety -TestPath $path
        $violations += $pathCheck.Violations
        $warnings += $pathCheck.Warnings
    }

    if ($Parameters.ContainsKey('directory_path')) {
        $sawPath = $true
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

    # A destructive action with no target path cannot be whitelist-checked.
    if (-not $sawPath -and ($PATH_REQUIRED_ACTIONS -contains $Action)) {
        $violations += "Action '$Action' requires a path parameter to validate"
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
        if ($recipients.Count -gt $MAX_RECIPIENTS) {
            $violations += "Too many recipients: $($recipients.Count) (max $MAX_RECIPIENTS)"
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

    # Configuration problems override any handler verdict — a gate that could
    # not load its rules has not validated anything.
    $violations = @($script:ConfigViolations) + @($result.Violations)
    $warnings = @($script:ConfigWarnings) + @($result.Warnings)
    $isValid = $result.Valid -and ($script:ConfigViolations.Count -eq 0)

    if ($isValid) {
        $message = "Safety validation passed"
        if ($warnings.Count -gt 0) {
            $message += " with $($warnings.Count) warning(s)"
        }
    } else {
        $message = "Safety validation failed with $($violations.Count) violation(s)"
    }

    Write-JsonOutput `
        -IsValid $isValid `
        -Message $message `
        -Violations $violations `
        -Warnings $warnings `
        -RequiresConfirmation $result.RequiresConfirmation

} catch {
    Write-JsonOutput `
        -IsValid $false `
        -Message "Safety validation error" `
        -Violations @("Unexpected error: $($_.Exception.Message)")
}
