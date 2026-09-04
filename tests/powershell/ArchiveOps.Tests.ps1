$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\ArchiveOps.ps1"
$TestSandbox = Join-Path $env:TEMP "homebot-archive-sandbox-$([guid]::NewGuid().ToString('N'))"

Describe "HomeBot ArchiveOps.ps1 Tests" {

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

    Context "Safety Validation" {
        It "Should block creating archive in blocked directory" {
            $file1 = Join-Path $TestSandbox "source.txt"
            Set-Content -LiteralPath $file1 -Value "data" -Force

            $result = & $ScriptPath -Action create -Destination "C:\Windows\System32\blocked.zip" -Files @($file1) -Confirmed $true
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "blocked directory"
        }
    }

    Context "Create, List, and Extract Cycle" {
        It "Should create a zip archive from source files" {
            $file1 = Join-Path $TestSandbox "doc1.txt"
            $file2 = Join-Path $TestSandbox "doc2.txt"
            Set-Content -LiteralPath $file1 -Value "Content 1" -Force
            Set-Content -LiteralPath $file2 -Value "Content 2" -Force

            $zipPath = Join-Path $TestSandbox "bundle.zip"
            $result = & $ScriptPath -Action create -Destination $zipPath -Files @($file1, $file2) -Confirmed $true
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            Test-Path $zipPath | Should Be $true
        }

        It "Should list files inside the archive" {
            $zipPath = Join-Path $TestSandbox "bundle.zip"
            $result = & $ScriptPath -Action list -ArchivePath $zipPath
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.data.entry_count | Should Be 2
        }

        It "Should extract the archive to a destination directory" {
            $zipPath = Join-Path $TestSandbox "bundle.zip"
            $extractDir = Join-Path $TestSandbox "extracted"

            $result = & $ScriptPath -Action extract -ArchivePath $zipPath -Destination $extractDir -Confirmed $true
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            Test-Path (Join-Path $extractDir "doc1.txt") | Should Be $true
            Test-Path (Join-Path $extractDir "doc2.txt") | Should Be $true
        }
    }
}
