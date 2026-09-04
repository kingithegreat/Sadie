$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\ClipboardOps.ps1"

Describe "HomeBot ClipboardOps.ps1 Tests" {

    Context "Clipboard Read Operations" {
        It "Should return clipboard content without error" {
            $result = & $ScriptPath -Action read
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.action | Should Be "read"
            $json.data | Should Not BeNullOrEmpty
        }
    }

    Context "Clipboard Write Operations" {
        It "Should require user confirmation for write" {
            $result = & $ScriptPath -Action write -Content "Test clipboard content" -Confirmed $false
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "confirmation required"
        }

        It "Should write and read back text when confirmed" {
            $testText = "HomeBot Test Clipboard $([guid]::NewGuid().ToString('N'))"
            $writeResult = & $ScriptPath -Action write -Content $testText -Confirmed $true
            $writeJson = $writeResult | ConvertFrom-Json

            $writeJson.success | Should Be $true

            $readResult = & $ScriptPath -Action read
            $readJson = $readResult | ConvertFrom-Json

            $readJson.success | Should Be $true
            $readJson.data.content | Should Be $testText
        }
    }

    Context "Clipboard Clear Operations" {
        It "Should clear clipboard content" {
            $clearResult = & $ScriptPath -Action clear
            $clearJson = $clearResult | ConvertFrom-Json

            $clearJson.success | Should Be $true
            $clearJson.action | Should Be "clear"
        }
    }
}
