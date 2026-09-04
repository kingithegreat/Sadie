$ScriptPath = Resolve-Path "$PSScriptRoot\..\..\scripts\tools\powershell\BrowserOps.ps1"

Describe "HomeBot BrowserOps.ps1 Tests" {

    Context "URL Validation" {
        It "Should reject empty URL on open_url" {
            $result = & $ScriptPath -Action open_url
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "Missing Url"
        }

        It "Should reject invalid protocol on open_url" {
            $result = & $ScriptPath -Action open_url -Url "ftp://example.com"
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "must begin with http"
        }
    }

    Context "Unsupported Actions" {
        It "Should return error for unsupported action" {
            $result = & $ScriptPath -Action invalid_browser_action
            $json = $result | ConvertFrom-Json

            $json.success | Should Be $false
            $json.error | Should Match "not supported"
        }
    }
}
