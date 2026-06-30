$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\FileOps.ps1"
$TestSandbox = "C:\Users\adenk\Desktop\homebot\tests\sandbox"

Describe "HomeBot FileOps.ps1 Tests" {

    BeforeAll {
        if (-not (Test-Path $TestSandbox)) {
            New-Item -ItemType Directory -Path $TestSandbox -Force | Out-Null
        }
    }

    AfterAll {
        if (Test-Path $TestSandbox) {
            Remove-Item $TestSandbox -Recurse -Force
        }
    }

    Context "Safety Validation" {
        It "Should block access to C:\Windows" {
            $result = & $ScriptPath -Action list -Path "C:\Windows"
            $json = $result | ConvertFrom-Json
            $json.success | Should -Be $false
            $json.error_code | Should -Be "ACCESS_DENIED"
        }

        It "Should block dangerous file extensions (.exe)" {
            $path = Join-Path $TestSandbox "malware.exe"
            $result = & $ScriptPath -Action write -Path $path -Content "malware"
            $json = $result | ConvertFrom-Json
            $json.success | Should -Be $false
            $json.error | Should -Match "Blocked extension"
        }

        It "Should block dangerous file extensions (.ps1)" {
            $path = Join-Path $TestSandbox "script.ps1"
            $result = & $ScriptPath -Action write -Path $path -Content "script"
            $json = $result | ConvertFrom-Json
            $json.success | Should -Be $false
            $json.error | Should -Match "Blocked extension"
        }
    }

    Context "File Operations" {
        It "Should allow writing a text file in a safe path" {
            $path = Join-Path $TestSandbox "test_write.txt"
            $content = "Hello HomeBot"
            
            $result = & $ScriptPath -Action write -Path $path -Content $content
            $json = $result | ConvertFrom-Json
            
            $json.success | Should -Be $true
            $json.action | Should -Be "write"
            Test-Path $path | Should -Be $true
            Get-Content $path | Should -Be $content
        }

        It "Should read the written file" {
            $path = Join-Path $TestSandbox "test_write.txt"
            $content = "Hello HomeBot" # Matches previous test
            
            $result = & $ScriptPath -Action read -Path $path
            $json = $result | ConvertFrom-Json
            
            $json.success | Should -Be $true
            $json.data.content | Should -Be $content
        }

        It "Should list directory contents" {
            $result = & $ScriptPath -Action list -Path $TestSandbox
            $json = $result | ConvertFrom-Json
            
            $json.success | Should -Be $true
            $json.data.files | Should -Not -BeNullOrEmpty
            $fileNames = $json.data.files | ForEach-Object { $_.name }
            $fileNames | Should -Contain "test_write.txt"
        }

        It "Should search for files" {
            $result = & $ScriptPath -Action search -Path $TestSandbox -Pattern "*.txt"
            $json = $result | ConvertFrom-Json
            
            $json.success | Should -Be $true
            $json.data.matches | Should -Not -BeNullOrEmpty
        }
    }

    Context "Dangerous Operations & Confirmation" {
        It "Should require confirmation for delete" {
            $path = Join-Path $TestSandbox "test_delete_unconfirmed.txt"
            Set-Content -Path $path -Value "Delete me"
            
            $result = & $ScriptPath -Action delete -Path $path -Confirmed $false
            $json = $result | ConvertFrom-Json
            
            $json.success | Should -Be $false
            $json.error | Should -Match "confirmation"
            Test-Path $path | Should -Be $true
        }

        It "Should delete file when confirmed" {
            $path = Join-Path $TestSandbox "test_delete_confirmed.txt"
            Set-Content -Path $path -Value "Delete me"
            
            $result = & $ScriptPath -Action delete -Path $path -Confirmed $true
            $json = $result | ConvertFrom-Json
            
            $json.success | Should -Be $true
            Test-Path $path | Should -Be $false
        }
    }
}
