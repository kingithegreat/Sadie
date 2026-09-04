$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\CalendarOps.ps1"

Describe "HomeBot CalendarOps.ps1 Tests" {

    Context "Read Operations" {
        It "Should return today's date for get_today" {
            $result = & $ScriptPath -Action get_today
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.action | Should Be "get_today"
            $json.data.date | Should Be (Get-Date -Format "yyyy-MM-dd")
            # A real calendar can legitimately have zero events today; the
            # property must exist either way (array or fallback note).
            $json.data.PSObject.Properties['events'] | Should Not BeNullOrEmpty
            $json.data.count | Should BeOfType [int]
        }

        It "Should return a look-ahead window for list_events" {
            $result = & $ScriptPath -Action list_events -Days 3
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.action | Should Be "list_events"
            $json.data.from | Should Not BeNullOrEmpty
            $json.data.to | Should Be (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
        }
    }

    Context "Add Event Safety" {
        It "Should refuse to add an event without confirmation" {
            $result = & $ScriptPath -Action add_event -Subject "Test event" -StartTime "2026-03-02T14:00:00" -EndTime "2026-03-02T15:00:00"
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "confirmation required"
        }

        It "Should not reach Outlook when subject is missing" {
            $result = & $ScriptPath -Action add_event -Confirmed $true
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Not BeNullOrEmpty
        }
    }
}
