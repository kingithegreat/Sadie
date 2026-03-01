<#
.SYNOPSIS
    SADIE Email Operations PowerShell Tool
.DESCRIPTION
    Draft and send emails via Windows Outlook COM or SMTP.
    Actions: draft | send | list_inbox
.PARAMETER Action
    The email operation: draft | send | list_inbox
.PARAMETER To
    Recipient email address(es), comma-separated for send/draft
.PARAMETER Subject
    Email subject
.PARAMETER Body
    Email body (plain text)
.PARAMETER Cc
    CC email addresses, comma-separated (optional)
.PARAMETER Count
    (list_inbox) Number of recent messages to return (default: 10)
.PARAMETER Confirmed
    Whether the user has confirmed the send action
#>
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("draft","send","list_inbox")]
    [string]$Action,

    [string]$To        = "",
    [string]$Subject   = "",
    [string]$Body      = "",
    [string]$Cc        = "",
    [int]$Count        = 10,
    [bool]$Confirmed   = $false
)

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

function Send-Result {
    param([bool]$Success, [string]$ActionDone, $Data = $null, [string]$ErrorMsg = "")
    @{ success = $Success; action = $ActionDone; timestamp = $timestamp; data = $Data; error = $ErrorMsg } |
        ConvertTo-Json -Depth 10 -Compress | Write-Output
}

function Get-OutlookApp {
    try { return New-Object -ComObject Outlook.Application }
    catch { return $null }
}

try {
    switch ($Action) {
        "list_inbox" {
            $outlook = Get-OutlookApp
            if (-not $outlook) {
                Send-Result -Success $false -ActionDone "list_inbox" -ErrorMsg "Microsoft Outlook is not installed or accessible."
                exit 1
            }
            $ns     = $outlook.GetNamespace("MAPI")
            $inbox  = $ns.GetDefaultFolder(6)   # 6 = olFolderInbox
            $items  = $inbox.Items
            $items.Sort("[ReceivedTime]", $true) # Descending
            $messages = @()
            $i = 1
            foreach ($msg in $items) {
                if ($i -gt $Count) { break }
                if ($msg.Class -eq 43) {   # 43 = olMail
                    $messages += @{
                        subject  = $msg.Subject
                        from     = $msg.SenderEmailAddress
                        received = $msg.ReceivedTime.ToString("yyyy-MM-ddTHH:mm:ss")
                        unread   = $msg.UnRead
                        preview  = $msg.Body.Substring(0, [Math]::Min(150, $msg.Body.Length)) -replace '\s+', ' '
                    }
                    $i++
                }
            }
            Send-Result -Success $true -ActionDone "list_inbox" -Data @{ count = $messages.Count; messages = $messages }
        }

        "draft" {
            $outlook = Get-OutlookApp
            if (-not $outlook) {
                Send-Result -Success $false -ActionDone "draft" -ErrorMsg "Microsoft Outlook is not installed or accessible."
                exit 1
            }
            $mail         = $outlook.CreateItem(0)  # 0 = olMailItem
            $mail.To      = $To
            $mail.CC      = $Cc
            $mail.Subject = $Subject
            $mail.Body    = $Body
            $mail.Save()
            Send-Result -Success $true -ActionDone "draft" -Data @{ to = $To; subject = $Subject; saved = $true }
        }

        "send" {
            if (-not $Confirmed) {
                Send-Result -Success $false -ActionDone "send" -ErrorMsg "User confirmation required to send email."
                exit 1
            }
            if (-not $To) {
                Send-Result -Success $false -ActionDone "send" -ErrorMsg "Recipient (To) is required."
                exit 1
            }
            if (-not $Subject) {
                Send-Result -Success $false -ActionDone "send" -ErrorMsg "Subject is required."
                exit 1
            }
            $outlook = Get-OutlookApp
            if (-not $outlook) {
                Send-Result -Success $false -ActionDone "send" -ErrorMsg "Microsoft Outlook is not installed or accessible."
                exit 1
            }
            $mail         = $outlook.CreateItem(0)
            $mail.To      = $To
            $mail.CC      = $Cc
            $mail.Subject = $Subject
            $mail.Body    = $Body
            $mail.Send()
            Send-Result -Success $true -ActionDone "send" -Data @{ to = $To; subject = $Subject; sent = $true; sentAt = $timestamp }
        }
    }
} catch {
    Send-Result -Success $false -ActionDone $Action -ErrorMsg $_.Exception.Message
    exit 1
}
