$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\SystemInfo.ps1"

Describe "HomeBot SystemInfo.ps1 Tests" {

    Context "System Information" {
        It "Should return valid system details for -InfoType system" {
            $result = & $ScriptPath -InfoType system
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.info_type | Should Be "system"
            $json.data.computer_name | Should Not BeNullOrEmpty
            $json.data.username | Should Not BeNullOrEmpty
            $json.data.os_name | Should Not BeNullOrEmpty
        }
    }

    Context "Disk Information" {
        It "Should return valid disk drives for -InfoType disk" {
            $result = & $ScriptPath -InfoType disk
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.info_type | Should Be "disk"
            $json.data.drives | Should Not BeNullOrEmpty
            $json.data.drive_count | Should BeGreaterThan 0
        }
    }

    Context "Memory Information" {
        It "Should return memory statistics for -InfoType memory" {
            $result = & $ScriptPath -InfoType memory
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.info_type | Should Be "memory"
            $json.data.total_gb | Should BeGreaterThan 0
            $json.data.used_percent | Should BeGreaterThan 0
        }
    }

    Context "Process Information" {
        It "Should return top running processes for -InfoType processes" {
            $result = & $ScriptPath -InfoType processes -TopProcesses 5
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.info_type | Should Be "processes"
            $json.data.top_processes | Should Not BeNullOrEmpty
            $json.data.total_process_count | Should BeGreaterThan 0
        }
    }

    Context "All Information" {
        It "Should aggregate all sections for -InfoType all" {
            $result = & $ScriptPath -InfoType all -TopProcesses 3
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $true
            $json.info_type | Should Be "all"
            $json.data.system | Should Not BeNullOrEmpty
            $json.data.disk | Should Not BeNullOrEmpty
            $json.data.memory | Should Not BeNullOrEmpty
            $json.data.processes | Should Not BeNullOrEmpty
        }
    }
}
