$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\EmailOps.ps1"

Describe "HomeBot EmailOps.ps1 Tests" {

    Context "Send Safety" {
        It "Should refuse to send without confirmation" {
            $result = & $ScriptPath -Action send -To "test@example.com" -Subject "Hi" -Body "Test body"
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "confirmation required"
        }

        It "Should refuse to send without a recipient even when confirmed" {
            $result = & $ScriptPath -Action send -Confirmed $true -Subject "Hi" -Body "Test body"
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "Recipient"
        }

        It "Should refuse to send without a subject even when confirmed" {
            $result = & $ScriptPath -Action send -Confirmed $true -To "test@example.com" -Body "Test body"
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "Subject is required"
        }
    }

    Context "Inbox Listing" {
        It "Should list inbox or fail closed when Outlook is unavailable" {
            $result = & $ScriptPath -Action list_inbox -Count 3
            $json = $result | ConvertFrom-Json

            if ($json.success) {
                $json.data.count | Should BeOfType [int]
                $json.data.count | Should BeLessThan 4
            } else {
                $json.error | Should Match "Outlook"
            }
        }
    }
}
