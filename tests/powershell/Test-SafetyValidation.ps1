# ============================================================================
# SafetyValidation.ps1 — standalone test runner
# ============================================================================
# Deliberately Pester-free: it needs nothing but Windows PowerShell, so it runs
# on a fresh clone and on a CI runner without an Install-Module step. The box it
# was written on has Pester 3.4.0, whose assertion syntax differs from Pester 5;
# depending on neither keeps this gate runnable whichever is present.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tests\powershell\Test-SafetyValidation.ps1
# Exits non-zero on the first failing expectation, so it is CI-wirable.
# ============================================================================

$ErrorActionPreference = 'Stop'

$ScriptPath = (Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\SafetyValidation.ps1").Path
$RulesPath  = (Resolve-Path "$PSScriptRoot\..\..\config\safety-rules.json").Path

$script:Passed = 0
$script:Failed = 0

function Assert-That {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')

    if ($Condition) {
        $script:Passed++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:Failed++
        Write-Host "  FAIL  $Name" -ForegroundColor Red
        if ($Detail) { Write-Host "        $Detail" -ForegroundColor DarkGray }
    }
}

# In-session invocation: binds native objects, exercises the validation logic.
function Invoke-Gate {
    param([hashtable]$Splat)
    return (& $ScriptPath @Splat | ConvertFrom-Json)
}

# Child-process invocation through -File: every argument arrives as a STRING.
# This is how n8n calls the script, and it is the binding that used to throw.
function Invoke-GateAsFile {
    param([string[]]$Arguments)
    $raw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1
    $text = ($raw | Out-String).Trim()
    try   { return ($text | ConvertFrom-Json) }
    catch { return [pscustomobject]@{ is_valid = $null; parse_error = $text } }
}

Write-Host "`nSafetyValidation.ps1" -ForegroundColor Cyan
Write-Host "  script: $ScriptPath`n" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
Write-Host "Path whitelist / blacklist" -ForegroundColor Yellow

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = 'C:\Windows\System32\hosts' } }
Assert-That "blocks a path under C:\Windows" (-not $r.is_valid) "violations: $($r.violations -join '; ')"

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = (Join-Path $env:USERPROFILE 'Desktop\notes.txt') } }
Assert-That "allows a path under the profile Desktop" ($r.is_valid) "violations: $($r.violations -join '; ')"

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = (Join-Path $env:USERPROFILE 'Desktop\evil.exe') } }
Assert-That "blocks a blocked extension (.exe)" (-not $r.is_valid) "violations: $($r.violations -join '; ')"

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = 'C:\SomewhereElse\x.txt' } }
Assert-That "blocks a path outside the allowed directories" (-not $r.is_valid)

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = (Join-Path $env:USERPROFILE 'AppData\Roaming\x.txt') } }
Assert-That "blocks the profile AppData directory" (-not $r.is_valid)

# ---------------------------------------------------------------------------
Write-Host "`nFail-closed behaviour" -ForegroundColor Yellow

$r = Invoke-Gate @{ ToolName='file_manager'; Action='delete'; Parameters=@{}; UserConfirmed=$true }
Assert-That "a delete naming no path does not pass" (-not $r.is_valid) "violations: $($r.violations -join '; ')"

$r = Invoke-Gate @{ ToolName='file_manager'; Action='delete'; Parameters=@{ path = (Join-Path $env:USERPROFILE 'Desktop\a.txt') }; UserConfirmed=$false }
Assert-That "an unconfirmed delete does not pass" (-not $r.is_valid)
Assert-That "an unconfirmed delete asks for confirmation" ($r.requires_confirmation -eq $true)

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters='not json at all {{{' }
Assert-That "unparseable parameters fail closed" (-not $r.is_valid) "violations: $($r.violations -join '; ')"

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; RulesPath='Z:\nope\missing-rules.json' }
Assert-That "an explicit but missing rules file fails closed" (-not $r.is_valid) "violations: $($r.violations -join '; ')"

# ---------------------------------------------------------------------------
Write-Host "`nString binding through -File (the n8n call path)" -ForegroundColor Yellow

# Regression: -RulesPath did not exist as a parameter, so browser-automation.json
# made the script throw "A parameter cannot be found" instead of validating.
$r = Invoke-GateAsFile @('-ToolName','browser','-Action','open_url','-RulesPath',$RulesPath)
Assert-That "-RulesPath binds instead of throwing" ($null -ne $r.is_valid) "got: $($r.parse_error)"

# Regression: -Parameters was typed [hashtable], so a JSON string could not bind.
$blocked = '@{"path":"C:\\Windows\\System32\\hosts"}'
$r = Invoke-GateAsFile @('-ToolName','file_manager','-Action','read','-Parameters',$blocked)
Assert-That "JSON parameters with the n8n '@' prefix parse" ($null -ne $r.is_valid) "got: $($r.parse_error)"
Assert-That "and the blocked path is still rejected" ($r.is_valid -eq $false) "violations: $($r.violations -join '; ')"

# Regression: the command line collapses JSON's \\ escapes, leaving invalid JSON.
$collapsed = '{"path":"C:\Windows\System32\hosts"}'
$r = Invoke-GateAsFile @('-ToolName','file_manager','-Action','read','-Parameters',$collapsed)
Assert-That "backslash-collapsed JSON is recovered, not silently passed" ($r.is_valid -eq $false) "violations: $($r.violations -join '; ')"

# Regression: -UserConfirmed was typed [bool]; n8n renders the literal text '$false'.
$r = Invoke-GateAsFile @('-ToolName','file_manager','-Action','delete','-Parameters','{"path":"x.txt"}','-UserConfirmed','$false')
Assert-That "-UserConfirmed '`$false' binds instead of throwing" ($null -ne $r.is_valid) "got: $($r.parse_error)"
Assert-That "and is read as NOT confirmed" ($r.user_confirmed -eq $false)

$r = Invoke-GateAsFile @('-ToolName','file_manager','-Action','read','-Parameters','{}','-UserConfirmed','true')
Assert-That "-UserConfirmed 'true' is read as confirmed" ($r.user_confirmed -eq $true)

$r = Invoke-GateAsFile @('-ToolName','file_manager','-Action','read','-Parameters','{}','-UserConfirmed','banana')
Assert-That "an unrecognised -UserConfirmed value is read as NOT confirmed" ($r.user_confirmed -eq $false)

# ---------------------------------------------------------------------------
Write-Host "`nPortability across Windows user profiles" -ForegroundColor Yellow

$originalProfile = $env:USERPROFILE
try {
    # A profile on a drive this session has no PSDrive for — Join-Path would throw here.
    $env:USERPROFILE = 'D:\Profiles\testuser'

    $r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = 'D:\Profiles\testuser\Desktop\a.txt' } }
    Assert-That "a foreign profile's Desktop is allowed" ($r.is_valid) "violations: $($r.violations -join '; ')"

    $r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = 'D:\Profiles\testuser\Documents\a.txt' } }
    Assert-That "a foreign profile's Documents is allowed" ($r.is_valid) "violations: $($r.violations -join '; ')"

    $r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = 'C:\Users\adenk\Desktop\a.txt' } }
    Assert-That "the developer's own path is NOT special-cased" (-not $r.is_valid) "violations: $($r.violations -join '; ')"

    $r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = 'D:\Profiles\testuser\AppData\x.txt' } }
    Assert-That "the foreign profile's AppData is blocked" (-not $r.is_valid)
}
finally {
    $env:USERPROFILE = $originalProfile
}

# ---------------------------------------------------------------------------
Write-Host "`nRules file" -ForegroundColor Yellow

$r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = (Join-Path $env:USERPROFILE 'Desktop\a.txt') }; RulesPath=$RulesPath }
Assert-That "config/safety-rules.json loads and is reported" ($r.rules_file -eq $RulesPath) "rules_file: $($r.rules_file)"

$tempRules = Join-Path ([System.IO.Path]::GetTempPath()) "homebot-rules-$PID.json"
try {
    @{ file_operations = @{ allowed_directories = @('%USERPROFILE%\OnlyHere') } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tempRules -Encoding utf8

    $r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = (Join-Path $env:USERPROFILE 'OnlyHere\a.txt') }; RulesPath=$tempRules }
    Assert-That "%USERPROFILE% in the rules file expands" ($r.is_valid) "violations: $($r.violations -join '; ')"

    $r = Invoke-Gate @{ ToolName='file_manager'; Action='read'; Parameters=@{ path = (Join-Path $env:USERPROFILE 'Desktop\a.txt') }; RulesPath=$tempRules }
    Assert-That "a narrowed rules file actually narrows the whitelist" (-not $r.is_valid)
}
finally {
    if (Test-Path -LiteralPath $tempRules) { Remove-Item -LiteralPath $tempRules -Force }
}

# ---------------------------------------------------------------------------
Write-Host "`n$($script:Passed) passed, $($script:Failed) failed`n" -ForegroundColor $(if ($script:Failed -gt 0) { 'Red' } else { 'Green' })
if ($script:Failed -gt 0) { exit 1 }
exit 0
