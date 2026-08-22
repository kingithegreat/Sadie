$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\FileOps.ps1"
$TestSandbox = Join-Path $env:TEMP "homebot-pester-sandbox-$([guid]::NewGuid().ToString('N'))"

Describe "HomeBot FileOps.ps1 Tests" {

    BeforeAll {
        if (-not (Test-Path $TestSandbox)) {
            New-Item -ItemType Directory -Path $TestSandbox -Force | Out-Null
        }
    }

    AfterAll {
        if (Test-Path $TestSandbox) {
            Remove-Item $TestSandbox -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Context "Write Operations" {
        It "Should write a text file to a specified LiteralPath" {
            $testFile = Join-Path $TestSandbox "test_write.txt"
            $content = "Hello HomeBot"

            $result = & $ScriptPath -Action write -LiteralPath $testFile -Content $content
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            Test-Path $testFile | Should Be $true
            (Get-Content -LiteralPath $testFile -Raw).TrimEnd("`r", "`n") | Should Be $content
        }
    }

    Context "Read Operations" {
        It "Should read an existing file" {
            $testFile = Join-Path $TestSandbox "test_read.txt"
            $content = "Read test content"
            Set-Content -LiteralPath $testFile -Value $content -Force

            $result = & $ScriptPath -Action read -LiteralPath $testFile
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.data.TrimEnd("`r", "`n") | Should Be $content
            $json._fileSize | Should BeGreaterThan 0
        }

        It "Should return error when reading a non-existent file" {
            $missingFile = Join-Path $TestSandbox "does_not_exist.txt"

            $result = & $ScriptPath -Action read -LiteralPath $missingFile
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "File not found"
        }
    }

    Context "Delete Operations" {
        It "Should delete an existing file" {
            $testFile = Join-Path $TestSandbox "test_delete.txt"
            Set-Content -LiteralPath $testFile -Value "Delete me" -Force

            $result = & $ScriptPath -Action delete -LiteralPath $testFile
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            Test-Path $testFile | Should Be $false
        }

        It "Should return error when deleting a non-existent file" {
            $missingFile = Join-Path $TestSandbox "never_existed.txt"

            $result = & $ScriptPath -Action delete -LiteralPath $missingFile
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "File not found"
        }
    }

    Context "Error Handling" {
        It "Should return error for an unknown action" {
            $testFile = Join-Path $TestSandbox "dummy.txt"

            $result = & $ScriptPath -Action invalid_action -LiteralPath $testFile
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "Unknown action"
        }
    }
}

