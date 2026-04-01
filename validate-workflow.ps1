# SADIE n8n Workflow Validator
# Usage: .\validate-workflow.ps1 -Path "n8n-workflows\tools\file-manager-hardened.json"

param(
    [Parameter(Mandatory=$true)]
    [string]$Path
)

$errors   = @()
$warnings = @()
$passes   = @()

function Pass($msg)  { $script:passes   += $msg; Write-Host "  PASS  $msg" -ForegroundColor Green }
function Warn($msg)  { $script:warnings += $msg; Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Fail($msg)  { $script:errors   += $msg; Write-Host "  FAIL  $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "Validating: $Path" -ForegroundColor Cyan
Write-Host ("=" * 60)

if (-not (Test-Path $Path)) { Write-Host "File not found: $Path" -ForegroundColor Red; exit 1 }
try {
    $raw = Get-Content $Path -Raw
    $wf  = $raw | ConvertFrom-Json
} catch {
    Write-Host "FATAL: Invalid JSON - $($_.Exception.Message)" -ForegroundColor Red; exit 1
}

$nodes       = $wf.nodes
$connections = $wf.connections
$nodeIds     = $nodes | ForEach-Object { $_.id }

Write-Host ""; Write-Host "CHECK 1: Unique node IDs" -ForegroundColor White
$uniqueIds = $nodeIds | Select-Object -Unique
if ($nodeIds.Count -ne $uniqueIds.Count) {
    $dupes = $nodeIds | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name }
    Fail "Duplicate node IDs: $($dupes -join ', ')"
} else { Pass "All $($nodeIds.Count) node IDs unique" }

Write-Host ""; Write-Host "CHECK 2: UUID v4 format" -ForegroundColor White
$uuidV4 = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$badIds  = $nodeIds | Where-Object { $_ -notmatch $uuidV4 }
if ($badIds) { Fail "Non-v4 UUIDs: $($badIds -join ', ')" }
else { Pass "All node IDs are valid v4 UUIDs" }
$repeatPattern = '-([0-9a-f]{4})-\1-'
$suspectIds = $nodeIds | Where-Object { $_ -match $repeatPattern }
if ($suspectIds) { Warn "Repeating-segment IDs (GPT-4.1 pattern): $($suspectIds -join ', ')" }

Write-Host ""; Write-Host "CHECK 3: Required nodes present" -ForegroundColor White
@("Webhook","Validate Input","Security Check","Execute PowerShell",
  "IF exitCode","Format Output","Envelope","Respond to Webhook","Error Handler") | ForEach-Object {
    $found = $nodes | Where-Object { $_.name -eq $_ }
    if ($found) { Pass "Found: $_" } else { Fail "Missing node: $_" }
}

Write-Host ""; Write-Host "CHECK 4: Schema Validate node type" -ForegroundColor White
$sv = $nodes | Where-Object { $_.name -match "Schema|Validate" -and $_.name -notmatch "Input|Security" }
if ($sv) {
    if     ($sv.type -eq "n8n-nodes-base.validateJson")     { Pass "Schema Validate type correct" }
    elseif ($sv.type -eq "n8n-nodes-base.jsonSchemaValidate") { Fail "OLD type 'jsonSchemaValidate' — change to 'validateJson'" }
    else   { Warn "Schema Validate type '$($sv.type)' — verify in your n8n" }
}

Write-Host ""; Write-Host "CHECK 5: Connection integrity" -ForegroundColor White
$allNodeNames = $nodes | ForEach-Object { $_.name }
$connections.PSObject.Properties | ForEach-Object {
    $srcId   = $_.Name
    $srcNode = $nodes | Where-Object { $_.id -eq $srcId }
    if (-not $srcNode) { Fail "Connection source ID '$srcId' not found in nodes"; return }
    $_.Value.main | ForEach-Object {
        $_ | ForEach-Object {
            if ($_.node -notin $allNodeNames) {
                Fail "'$($srcNode.name)' -> '$($_.node)' target not found"
            }
        }
    }
}
if (-not ($errors | Where-Object { $_ -match "target not found|source ID" })) {
    Pass "All connections reference valid nodes"
}

Write-Host ""; Write-Host "CHECK 6: Envelope reachability" -ForegroundColor White
$reachesEnvelope = @()
$connections.PSObject.Properties | ForEach-Object {
    $srcId = $_.Name
    $_.Value.main | ForEach-Object {
        $_ | ForEach-Object {
            if ($_.node -eq "Envelope") {
                $src = $nodes | Where-Object { $_.id -eq $srcId }
                $reachesEnvelope += $src.name
            }
        }
    }
}
if ($reachesEnvelope.Count -lt 2) {
    Warn "Envelope reached by only $($reachesEnvelope.Count) node(s): $($reachesEnvelope -join ', ')"
} else { Pass "Envelope reached by $($reachesEnvelope.Count) nodes: $($reachesEnvelope -join ', ')" }

Write-Host ""; Write-Host "CHECK 7: PowerShell uses -LiteralPath" -ForegroundColor White
$psNode = $nodes | Where-Object { $_.name -eq "Execute PowerShell" }
if ($psNode) {
    if ($psNode.parameters.command -match '(?<!-Literal)-Path\s') {
        Fail "Still uses '-Path' — change to '-LiteralPath'"
    } else { Pass "Uses -LiteralPath" }
}

Write-Host ""; Write-Host "CHECK 8: startTime captured in Validate Input" -ForegroundColor White
$vi = $nodes | Where-Object { $_.name -eq "Validate Input" }
if ($vi) {
    if ($vi.parameters.functionCode -match 'currentRequestStart') { Pass "currentRequestStart set" }
    else { Fail "currentRequestStart missing — durationMs will be 0" }
}

Write-Host ""; Write-Host "CHECK 9: FILE_SIZE_LIMIT in Format Output" -ForegroundColor White
$fo = $nodes | Where-Object { $_.name -eq "Format Output" }
if ($fo) {
    if ($fo.parameters.functionCode -match 'FILE_SIZE_LIMIT') { Pass "FILE_SIZE_LIMIT guard present" }
    else { Fail "FILE_SIZE_LIMIT guard missing" }
}

Write-Host ""; Write-Host "CHECK 10: Envelope reads currentRequestStart" -ForegroundColor White
$env = $nodes | Where-Object { $_.name -eq "Envelope" }
if ($env) {
    if ($env.parameters.functionCode -match 'currentRequestStart') { Pass "Envelope reads currentRequestStart" }
    else { Fail "Envelope missing currentRequestStart — durationMs wrong" }
}

Write-Host ""; Write-Host "CHECK 11: Respond to Webhook status code" -ForegroundColor White
$rwh = $nodes | Where-Object { $_.name -eq "Respond to Webhook" }
if ($rwh) {
    $rc = $rwh.parameters.options.responseCode
    if ($rc -match '_httpStatus') { Pass "Uses _httpStatus field" }
    else { Warn "Does not use _httpStatus — error HTTP codes may be wrong" }
}

Write-Host ""; Write-Host "CHECK 12: Orphaned nodes" -ForegroundColor White
$allTargets = @()
$connections.PSObject.Properties | ForEach-Object {
    $_.Value.main | ForEach-Object { $_ | ForEach-Object { $allTargets += $_.node } }
}
$orphans = $nodes | Where-Object { $_.name -ne "Webhook" -and $_.name -notin $allTargets }
if ($orphans) { $orphans | ForEach-Object { Warn "Orphaned node: $($_.name)" } }
else { Pass "No orphaned nodes" }

Write-Host ""; Write-Host ("=" * 60)
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "  Passed:   $($passes.Count)"   -ForegroundColor Green
Write-Host "  Warnings: $($warnings.Count)" -ForegroundColor Yellow
Write-Host "  Errors:   $($errors.Count)"   -ForegroundColor Red
Write-Host ""

if ($errors.Count -gt 0) {
    Write-Host "DO NOT IMPORT — fix errors first:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
} elseif ($warnings.Count -gt 0) {
    Write-Host "IMPORT WITH CAUTION — review warnings:" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "READY TO IMPORT" -ForegroundColor Green
    exit 0
}
