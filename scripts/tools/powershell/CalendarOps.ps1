<#
.SYNOPSIS
    SADIE Calendar Operations PowerShell Tool
.DESCRIPTION
    Reads and creates Windows calendar events via COM/Shell objects.
    Actions: list_events | add_event | get_today
.PARAMETER Action
    The calendar operation: list_events | add_event | get_today
.PARAMETER Subject
    (add_event) Event title/subject
.PARAMETER StartTime
    (add_event) Event start time in ISO-8601 format (e.g. "2026-03-02T14:00:00")
.PARAMETER EndTime
    (add_event) Event end time in ISO-8601 format
.PARAMETER Body
    (add_event) Optional event description
.PARAMETER Days
    (list_events) Look-ahead window in days (default: 7)
.PARAMETER Confirmed
    Whether the user has confirmed adding an event
#>
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("list_events","add_event","get_today")]
    [string]$Action,

    [string]$Subject    = "",
    [string]$StartTime  = "",
    [string]$EndTime    = "",
    [string]$Body       = "",
    [int]$Days          = 7,
    [bool]$Confirmed    = $false
)

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

function Send-Result {
    param([bool]$Success, [string]$ActionDone, $Data = $null, [string]$ErrorMsg = "")
    @{ success = $Success; action = $ActionDone; timestamp = $timestamp; data = $Data; error = $ErrorMsg } |
        ConvertTo-Json -Depth 10 -Compress | Write-Output
}

# Helper: get Outlook MAPI namespace (requires Outlook installed)
function Get-OutlookNamespace {
    try {
        $outlook = New-Object -ComObject Outlook.Application
        return $outlook.GetNamespace("MAPI")
    } catch {
        return $null
    }
}

try {
    switch ($Action) {
        "get_today" {
            $today = Get-Date
            $events = @()
            $ns = Get-OutlookNamespace
            if ($ns) {
                $cal = $ns.GetDefaultFolder(9)  # 9 = olFolderCalendar
                $items = $cal.Items
                $items.IncludeRecurrences = $true
                $items.Sort("[Start]")
                $filter = "[Start] >= '$($today.ToString('MM/dd/yyyy 00:00'))' AND [Start] <= '$($today.ToString('MM/dd/yyyy 23:59'))'"
                $restricted = $items.Restrict($filter)
                foreach ($item in $restricted) {
                    $events += @{
                        subject   = $item.Subject
                        start     = $item.Start.ToString("yyyy-MM-ddTHH:mm:ss")
                        end       = $item.End.ToString("yyyy-MM-ddTHH:mm:ss")
                        location  = $item.Location
                        body      = $item.Body.Substring(0, [Math]::Min(200, $item.Body.Length))
                    }
                }
            } else {
                # Fallback: No Outlook — return system datetime info
                $events += @{ note = "Outlook not available. Today is $($today.ToString('dddd, MMMM d yyyy'))." }
            }
            Send-Result -Success $true -ActionDone "get_today" -Data @{ date = $today.ToString("yyyy-MM-dd"); events = $events; count = $events.Count }
        }

        "list_events" {
            $start = Get-Date
            $end   = $start.AddDays($Days)
            $events = @()
            $ns = Get-OutlookNamespace
            if ($ns) {
                $cal = $ns.GetDefaultFolder(9)
                $items = $cal.Items
                $items.IncludeRecurrences = $true
                $items.Sort("[Start]")
                $filter = "[Start] >= '$($start.ToString('MM/dd/yyyy HH:mm'))' AND [Start] <= '$($end.ToString('MM/dd/yyyy HH:mm'))'"
                $restricted = $items.Restrict($filter)
                foreach ($item in $restricted) {
                    $events += @{
                        subject   = $item.Subject
                        start     = $item.Start.ToString("yyyy-MM-ddTHH:mm:ss")
                        end       = $item.End.ToString("yyyy-MM-ddTHH:mm:ss")
                        location  = $item.Location
                    }
                }
            } else {
                $events += @{ note = "Outlook not available. Calendar operations require Microsoft Outlook." }
            }
            Send-Result -Success $true -ActionDone "list_events" -Data @{ from = $start.ToString("yyyy-MM-dd"); to = $end.ToString("yyyy-MM-dd"); events = $events; count = $events.Count }
        }

        "add_event" {
            if (-not $Confirmed) {
                Send-Result -Success $false -ActionDone "add_event" -ErrorMsg "User confirmation required to add a calendar event."
                exit 1
            }
            if (-not $Subject) {
                Send-Result -Success $false -ActionDone "add_event" -ErrorMsg "Subject is required."
                exit 1
            }
            $ns = Get-OutlookNamespace
            if (-not $ns) {
                Send-Result -Success $false -ActionDone "add_event" -ErrorMsg "Microsoft Outlook is not installed or accessible."
                exit 1
            }
            $outlook = New-Object -ComObject Outlook.Application
            $appt = $outlook.CreateItem(1)  # 1 = olAppointmentItem
            $appt.Subject  = $Subject
            $appt.Body     = $Body
            if ($StartTime) { $appt.Start = [datetime]::Parse($StartTime) }
            if ($EndTime)   { $appt.End   = [datetime]::Parse($EndTime) }
            $appt.Save()
            Send-Result -Success $true -ActionDone "add_event" -Data @{ subject = $Subject; start = $StartTime; end = $EndTime }
        }
    }
} catch {
    Send-Result -Success $false -ActionDone $Action -ErrorMsg $_.Exception.Message
    exit 1
}
