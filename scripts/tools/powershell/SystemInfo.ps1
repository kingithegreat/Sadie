# ============================================================================
# SADIE System Information Script
# ============================================================================
# Purpose: Retrieve safe system information (disk, memory, processes, OS)
# Safety: No system modifications, read-only operations
# Returns: JSON output for n8n workflow consumption
# ============================================================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('system', 'disk', 'memory', 'processes', 'network', 'all')]
    [string]$InfoType,
    
    [Parameter(Mandatory=$false)]
    [int]$TopProcesses = 10
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-JsonOutput {
    param(
        [bool]$Success,
        [string]$Message,
        [object]$Data = $null,
        [string]$Error = $null
    )
    
    $output = @{
        success = $Success
        message = $Message
        info_type = $InfoType
        timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
    }
    
    if ($Data) { $output.data = $Data }
    if ($Error) { $output.error = $Error }
    
    return ($output | ConvertTo-Json -Depth 10 -Compress)
}

# ============================================================================
# INFORMATION GATHERING FUNCTIONS
# ============================================================================

function Get-SystemInformation {
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem
        $computer = Get-CimInstance -ClassName Win32_ComputerSystem
        $bios = Get-CimInstance -ClassName Win32_BIOS
        
        return @{
            computer_name = $env:COMPUTERNAME
            username = $env:USERNAME
            os_name = $os.Caption
            os_version = $os.Version
            os_architecture = $os.OSArchitecture
            os_build = $os.BuildNumber
            manufacturer = $computer.Manufacturer
            model = $computer.Model
            total_memory_gb = [math]::Round($computer.TotalPhysicalMemory / 1GB, 2)
            processors = $computer.NumberOfProcessors
            logical_processors = $computer.NumberOfLogicalProcessors
            bios_version = $bios.SMBIOSBIOSVersion
            boot_time = $os.LastBootUpTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            uptime_hours = [math]::Round((New-TimeSpan -Start $os.LastBootUpTime -End (Get-Date)).TotalHours, 2)
        }
    } catch {
        throw "Failed to gather system information: $($_.Exception.Message)"
    }
}

function Get-DiskInformation {
    try {
        $disks = Get-PSDrive -PSProvider FileSystem | Where-Object { 
            $_.Used -ne $null -and $_.Name.Length -eq 1 
        } | ForEach-Object {
            $usedGB = [math]::Round($_.Used / 1GB, 2)
            $freeGB = [math]::Round($_.Free / 1GB, 2)
            $totalGB = $usedGB + $freeGB
            $usedPercent = if ($totalGB -gt 0) { [math]::Round(($usedGB / $totalGB) * 100, 1) } else { 0 }
            
            @{
                drive = "$($_.Name):"
                used_gb = $usedGB
                free_gb = $freeGB
                total_gb = $totalGB
                used_percent = $usedPercent
                root = $_.Root
            }
        }
        
        return @{
            drives = @($disks)
            drive_count = $disks.Count
        }
    } catch {
        throw "Failed to gather disk information: $($_.Exception.Message)"
    }
}

function Get-MemoryInformation {
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem
        
        $totalMemoryGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
        $freeMemoryGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
        $usedMemoryGB = [math]::Round($totalMemoryGB - $freeMemoryGB, 2)
        $usedPercent = [math]::Round(($usedMemoryGB / $totalMemoryGB) * 100, 1)
        
        return @{
            total_gb = $totalMemoryGB
            used_gb = $usedMemoryGB
            free_gb = $freeMemoryGB
            used_percent = $usedPercent
            available_mb = [math]::Round($os.FreePhysicalMemory / 1KB, 0)
        }
    } catch {
        throw "Failed to gather memory information: $($_.Exception.Message)"
    }
}

function Get-ProcessInformation {
    try {
        $processes = Get-Process | Sort-Object -Property CPU -Descending | Select-Object -First $TopProcesses | ForEach-Object {
            @{
                name = $_.ProcessName
                id = $_.Id
                cpu_seconds = [math]::Round($_.CPU, 2)
                memory_mb = [math]::Round($_.WorkingSet64 / 1MB, 2)
                threads = $_.Threads.Count
                start_time = if ($_.StartTime) { $_.StartTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") } else { $null }
            }
        }
        
        $totalProcesses = (Get-Process).Count
        
        return @{
            top_processes = @($processes)
            total_process_count = $totalProcesses
            top_count = $TopProcesses
        }
    } catch {
        throw "Failed to gather process information: $($_.Exception.Message)"
    }
}

function Get-NetworkInformation {
    try {
        $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
            $ipConfig = Get-NetIPAddress -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue | 
                        Where-Object { $_.AddressFamily -eq 'IPv4' } | 
                        Select-Object -First 1
            
            @{
                name = $_.Name
                description = $_.InterfaceDescription
                status = $_.Status
                speed_mbps = [math]::Round($_.LinkSpeed / 1MB, 0)
                mac_address = $_.MacAddress
                ip_address = if ($ipConfig) { $ipConfig.IPAddress } else { $null }
            }
        }
        
        return @{
            active_adapters = @($adapters)
            adapter_count = $adapters.Count
        }
    } catch {
        throw "Failed to gather network information: $($_.Exception.Message)"
    }
}

function Get-AllInformation {
    try {
        return @{
            system = Get-SystemInformation
            disk = Get-DiskInformation
            memory = Get-MemoryInformation
            processes = Get-ProcessInformation
            network = Get-NetworkInformation
        }
    } catch {
        throw "Failed to gather all information: $($_.Exception.Message)"
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

try {
    $data = switch ($InfoType) {
        'system'    { Get-SystemInformation }
        'disk'      { Get-DiskInformation }
        'memory'    { Get-MemoryInformation }
        'processes' { Get-ProcessInformation }
        'network'   { Get-NetworkInformation }
        'all'       { Get-AllInformation }
        default     { throw "Invalid info type: $InfoType" }
    }
    
    Write-JsonOutput -Success $true -Message "System information retrieved successfully" -Data $data
    
} catch {
    Write-JsonOutput -Success $false -Message "Failed to retrieve system information" -Error $_.Exception.Message
}
