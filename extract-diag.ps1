$testResultsPath = "C:\Users\adenk\Desktop\sadie\test-results"
$widgetPath = "C:\Users\adenk\Desktop\sadie\widget"
$scriptPath = "$widgetPath\scripts\extract-diag.js"

$traceFiles = Get-ChildItem -Path $testResultsPath -Recurse -Filter "trace.zip" | Select-Object -ExpandProperty FullName

$results = @{}

foreach ($zipPath in $traceFiles) {
    $dirName = [System.IO.Path]::GetFileName([System.IO.Path]::GetDirectoryName($zipPath))
    $tempDir = "$widgetPath\temp-trace-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $tempDir
    $tracePath = "$tempDir\test.trace"
    if (Test-Path $tracePath) {
        $output = & node $scriptPath $tracePath 2>&1
        $json = $output | Where-Object { $_ -match '^\[' } | Select-Object -Last 1
        if ($json) {
            $logs = $json | ConvertFrom-Json
            if ($logs.Count -gt 0) {
                $results[$dirName] = $logs
            }
        }
    }
    Remove-Item -Recurse -Force $tempDir
}

$results | ConvertTo-Json -Depth 10