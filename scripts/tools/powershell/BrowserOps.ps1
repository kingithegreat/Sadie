param(
    [Parameter(Mandatory=$true)][string]$Action,
    [string]$Url
)

function Write-Json($obj) {
    $obj | ConvertTo-Json -Compress
    exit 0
}

$actionNorm = ($Action -as [string]).ToLowerInvariant()

switch ($actionNorm) {
    'open_url' {
        if ([string]::IsNullOrWhiteSpace($Url)) {
            Write-Json @{ success = $false; error = 'Missing Url parameter' }
        }

        if ($Url -notmatch '^https?://') {
            Write-Json @{ success = $false; error = 'URL must begin with http:// or https://' }
        }

        try {
            Start-Process -FilePath $Url | Out-Null
            Write-Json @{ success = $true; action = 'open_url'; url = $Url }
        } catch {
            Write-Json @{ success = $false; error = $_.Exception.Message }
        }
    }

    'close_browser' {
        try {
            Get-Process -Name 'msedge','chrome','firefox' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Write-Json @{ success = $true; action = 'close_browser' }
        } catch {
            Write-Json @{ success = $false; error = $_.Exception.Message }
        }
    }

    default {
        Write-Json @{ success = $false; error = "Action '$Action' not supported" }
    }
}
