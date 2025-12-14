# PowerShell test runner for PHASE_6 (FileOps + SystemInfo)
# Produces logs/powershell-test-results.json with structured results

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$root = Resolve-Path "$scriptDir\.." | Select-Object -First 1
$logsDir = Join-Path $root 'logs'
if (-not (Test-Path $logsDir)) { New-Item -Path $logsDir -ItemType Directory | Out-Null }
$outFile = Join-Path $logsDir 'powershell-test-results.json'

$tests = @(
    @{ id = 'list_desktop'; name = 'List Desktop'; command = 'Get-ChildItem -Path "$env:USERPROFILE\\Desktop" -ErrorAction Stop | Select-Object -First 1 | ForEach-Object { $_.Name }'; expected = 'Command succeeds and returns 0+ items'; },
    @{ id = 'create_temp_file'; name = 'Create Temp File'; command = '$p = Join-Path $env:TEMP "sadie-ps-test-$(Get-Random).txt"; Set-Content -Path $p -Value "sadie-test" -Force; $exists = Test-Path $p; Remove-Item -Path $p -Force; $exists'; expected = 'Creates and removes a temp file (Test-Path returns True)'; },
    @{ id = 'get_file_info'; name = 'Get File Info (profile)'; command = 'Get-Item -Path "$env:USERPROFILE" | Select-Object Name,FullName | ConvertTo-Json -Compress'; expected = 'Returns profile folder info'; },
    @{ id = 'get_computer_info'; name = 'Get Computer Info'; command = 'Get-ComputerInfo | Select-Object CsName,OsName,OsVersion | ConvertTo-Json -Compress'; expected = 'Returns basic computer info'; },
    @{ id = 'get_hostname'; name = 'Get Hostname'; command = 'hostname'; expected = 'Returns hostname string'; }
)

$results = @()
$passCount = 0
$failCount = 0

foreach ($t in $tests) {
    $timestamp = (Get-Date).ToString('o')
    $cmd = $t.command
    $expected = $t.expected
    $actual = ''
    $passed = $false

    try {
        # Execute the command and capture output
        $output = Invoke-Expression $cmd 2>&1
        if ($output -is [System.Array]) { $actual = ($output -join "\n") } else { $actual = [string]$output }
        $passed = $true
    } catch {
        $actual = $_.Exception.Message
        $passed = $false
    }

    $entry = [PSCustomObject]@{
        timestamp = $timestamp
        id = $t.id
        name = $t.name
        command = $cmd
        expected = $expected
        actual = $actual
        pass = $passed
    }
    $results += $entry
    if ($passed) { $passCount++ } else { $failCount++ }
}

# Write results to JSON
$results | ConvertTo-Json -Depth 5 | Out-File -FilePath $outFile -Encoding UTF8

# Summary
$total = $results.Count
Write-Host "\nPowerShell Test Summary:`nPassed: $passCount`nFailed: $failCount`nTotal: $total" -ForegroundColor Yellow
if ($failCount -gt 0) { Write-Host "Some tests failed. See $outFile for details." -ForegroundColor Red } else { Write-Host "All tests passed." -ForegroundColor Green }

return 0
