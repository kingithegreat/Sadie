<#
.SYNOPSIS
    SADIE Clipboard Operations PowerShell Tool
.DESCRIPTION
    Reads from and writes to the Windows clipboard securely.
    Actions: read, write, clear
.PARAMETER Action
    The clipboard operation: read | write | clear
.PARAMETER Content
    (write) The text content to place on the clipboard
.PARAMETER Confirmed
    Whether the user has confirmed a potentially sensitive write
#>
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("read","write","clear")]
    [string]$Action,

    [string]$Content = "",
    [bool]$Confirmed = $false
)

Add-Type -AssemblyName System.Windows.Forms

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

function Send-Result {
    param([bool]$Success, [string]$ActionDone, $Data = $null, [string]$ErrorMsg = "")
    $result = @{
        success   = $Success
        action    = $ActionDone
        timestamp = $timestamp
        data      = $Data
        error     = $ErrorMsg
    }
    Write-Output ($result | ConvertTo-Json -Depth 5 -Compress)
}

try {
    switch ($Action) {
        "read" {
            $text = [System.Windows.Forms.Clipboard]::GetText()
            if ($null -eq $text) { $text = "" }
            Send-Result -Success $true -ActionDone "read" -Data @{ content = $text; length = $text.Length }
        }
        "write" {
            if (-not $Confirmed) {
                Send-Result -Success $false -ActionDone "write" -ErrorMsg "User confirmation required to write to clipboard."
                exit 1
            }
            if ($Content.Length -gt 1048576) {
                Send-Result -Success $false -ActionDone "write" -ErrorMsg "Content exceeds 1 MB clipboard limit."
                exit 1
            }
            [System.Windows.Forms.Clipboard]::SetText($Content)
            Send-Result -Success $true -ActionDone "write" -Data @{ length = $Content.Length }
        }
        "clear" {
            [System.Windows.Forms.Clipboard]::Clear()
            Send-Result -Success $true -ActionDone "clear"
        }
    }
} catch {
    Send-Result -Success $false -ActionDone $Action -ErrorMsg $_.Exception.Message
    exit 1
}
