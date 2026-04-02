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
            Output-Json @{ success = $true; data = $content; _fileSize = $size }
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
