$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host 'Comfy Studio - DeepSeek API Key Setup' -ForegroundColor Cyan
Write-Host 'The key is entered locally and will not be displayed.' -ForegroundColor DarkGray
Write-Host ''

$secureKey = Read-Host 'Paste a NEW DeepSeek API key' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer).Trim()
    if ([string]::IsNullOrWhiteSpace($plainKey)) {
        throw 'No API key was entered.'
    }
    if (-not $plainKey.StartsWith('sk-')) {
        throw 'The key format is invalid. A DeepSeek key normally starts with sk-.'
    }

    [Environment]::SetEnvironmentVariable('DEEPSEEK_API_KEY', $plainKey, 'User')
    $env:DEEPSEEK_API_KEY = $plainKey

    $saved = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
    if ([string]::IsNullOrWhiteSpace($saved)) {
        throw 'Windows did not persist the API key.'
    }

    # Mirror the key into the gitignored comfy_studio.yaml so the launcher
    # still finds it even if the environment variable is not propagated.
    # Preserve any custom model/api_base lines if the file already exists.
    $yamlPath = Join-Path $PSScriptRoot '..\comfy_studio.yaml'
    $yamlPath = [System.IO.Path]::GetFullPath($yamlPath)
    try {
        if (Test-Path $yamlPath) {
            $content = Get-Content -Path $yamlPath -Raw -Encoding utf8
            if ($content -match '(?m)^api_key:.*$') {
                $content = $content -replace '(?m)^api_key:.*$', "api_key: $plainKey"
            } else {
                $content = $content.TrimEnd() + "`napi_key: $plainKey`n"
            }
            Set-Content -Path $yamlPath -Value $content -Encoding utf8
        } else {
            $template = "api_key: $plainKey`nmodel: deepseek-v4-pro`napi_base: https://api.deepseek.com`n"
            Set-Content -Path $yamlPath -Value $template -Encoding utf8
        }
    }
    catch {
        Write-Host "[WARN] Could not write $yamlPath" -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '[OK] DeepSeek API key saved for the current Windows user.' -ForegroundColor Green
    Write-Host 'Close the running launcher and start it again to enable the AI assistant.' -ForegroundColor Yellow
}
catch {
    Write-Host ''
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    $plainKey = $null
    $secureKey = $null
}
