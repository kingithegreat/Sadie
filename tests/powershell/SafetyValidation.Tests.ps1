$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\SafetyValidation.ps1"

Describe "HomeBot SafetyValidation.ps1 Tests" {

    Context "Path Allowlist" {
        It "Should allow a path under an allowed directory" {
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = (Join-Path $env:USERPROFILE "Documents\report.txt") }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $true
            $json.violations.Count | Should Be 0
        }

        It "Should reject a path outside allowed directories" {
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = "C:\SomeOtherPlace\file.txt" }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "outside allowed"
        }

        It "Should NOT let a sibling directory inherit an allowed prefix" {
            # "C:\Users\<me>\Desktop" must not prefix-match "C:\Users\<me>\DesktopEvil"
            $sibling = Join-Path $env:USERPROFILE "DesktopEvil\run.txt"
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = $sibling }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
        }
    }

    Context "Path Blocklist" {
        It "Should block a path under C:\Windows" {
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = "C:\Windows\System32\config.txt" }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "blocked system directory"
        }

        It "Should block a path under AppData" {
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = (Join-Path $env:USERPROFILE "AppData\Roaming\secret.txt") }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "blocked system directory"
        }

        It "Should block the Recycle Bin (dollar sign must survive quoting)" {
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = 'C:\$Recycle.Bin\recovered.txt' }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "blocked system directory"
        }

        It "Should block traversal that climbs out of an allowed directory" {
            $climbing = Join-Path $env:USERPROFILE "Documents\..\..\..\Windows\notepad.exe"
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = $climbing }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "blocked system directory"
        }
    }

    Context "Extension Blocking" {
        It "Should block executable extensions" {
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = (Join-Path $env:USERPROFILE "Documents\tool.exe") }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "blocked"
        }

        It "Should allow safe extensions" {
            $result = & $ScriptPath -ToolName file_manager -Action read -Parameters @{ Path = (Join-Path $env:USERPROFILE "Documents\notes.txt") }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $true
        }
    }

    Context "Confirmation Requirements" {
        It "Should require confirmation for file delete" {
            $result = & $ScriptPath -ToolName file_manager -Action delete -Parameters @{ Path = (Join-Path $env:USERPROFILE "Documents\old.txt") }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            $json.requires_confirmation | Should Be $true
        }

        It "Should pass file delete when confirmed" {
            $result = & $ScriptPath -ToolName file_manager -Action delete -Parameters @{ Path = (Join-Path $env:USERPROFILE "Documents\old.txt") } -UserConfirmed $true
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $true
        }

        It "Should require confirmation for email send" {
            $result = & $ScriptPath -ToolName email_manager -Action send -Parameters @{ to = "a@example.com" }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            $json.requires_confirmation | Should Be $true
        }

        It "Should require confirmation for api_tool calls" {
            $result = & $ScriptPath -ToolName api_tool -Action post -Parameters @{ url = "http://localhost:5678/webhook" }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            $json.requires_confirmation | Should Be $true
        }
    }

    Context "Email Validation" {
        It "Should reject more than 10 recipients" {
            $many = (1..11 | ForEach-Object { "user$_@example.com" }) -join ","
            $result = & $ScriptPath -ToolName email_manager -Action send -Parameters @{ to = $many } -UserConfirmed $true
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "Too many recipients"
        }

        It "Should flag attachment paths outside allowed directories" {
            $result = & $ScriptPath -ToolName email_manager -Action send -Parameters @{ to = "a@example.com"; attachments = @("C:\Windows\win.ini") } -UserConfirmed $true
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $false
            ($json.violations -join " ") | Should Match "blocked system directory"
        }
    }

    Context "API Tool Validation" {
        It "Should treat a localhost URL as local when confirmed" {
            $result = & $ScriptPath -ToolName api_tool -Action post -Parameters @{ url = "http://localhost:5678/webhook" } -UserConfirmed $true
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $true
            ($json.warnings -join " ") | Should Not Match "External API call"
        }

        It "Should NOT be fooled by a remote URL that merely mentions localhost" {
            $result = & $ScriptPath -ToolName api_tool -Action post -Parameters @{ url = "http://evil.example.com/?x=localhost" } -UserConfirmed $true
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $true
            ($json.warnings -join " ") | Should Match "External API call"
        }
    }

    Context "Vision and Unknown Tools" {
        It "Should warn about screenshot analysis privacy" {
            $result = & $ScriptPath -ToolName vision_tool -Action analyze_screenshot -Parameters @{ image_path = (Join-Path $env:USERPROFILE "Desktop\shot.png") }
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $true
            ($json.warnings -join " ") | Should Match "sensitive"
        }

        It "Should pass unknown tools through generically" {
            $result = & $ScriptPath -ToolName mystery_tool -Action whatever
            $json = $result | ConvertFrom-Json

            $json.is_valid | Should Be $true
        }
    }
}
