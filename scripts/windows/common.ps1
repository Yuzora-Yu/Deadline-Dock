$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-DeadlineDockRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Refresh-DeadlineDockPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extra = @(
        (Join-Path $env:USERPROFILE '.cargo\bin'),
        (Join-Path $env:ProgramFiles 'nodejs')
    )
    $env:Path = (@($machine, $user) + $extra | Where-Object { $_ }) -join ';'
}

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-NodeVersion {
    if (-not (Test-CommandExists 'node.exe')) { return $null }
    try {
        $raw = (& node.exe --version).Trim().TrimStart('v')
        return [Version]$raw
    } catch { return $null }
}

function Test-SupportedNode {
    $v = Get-NodeVersion
    if (-not $v) { return $false }
    if ($v.Major -eq 20) { return $v -ge [Version]'20.19.0' }
    if ($v.Major -ge 22) { return $v -ge [Version]'22.12.0' }
    return $false
}

function Get-VsWherePath {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    return $null
}

function Test-VcBuildTools {
    $vswhere = Get-VsWherePath
    if (-not $vswhere) { return $false }
    try {
        $install = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        return -not [string]::IsNullOrWhiteSpace(($install | Out-String).Trim())
    } catch { return $false }
}

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host ('=' * 68) -ForegroundColor DarkGray
    Write-Host $Message -ForegroundColor Cyan
    Write-Host ('=' * 68) -ForegroundColor DarkGray
}

function Assert-ProjectRoot([string]$Root) {
    if (-not (Test-Path (Join-Path $Root 'package.json'))) {
        throw "package.json が見つかりません。解凍した deadline-dock フォルダ内から実行してください。`n想定: C:\Users\ship2\Documents\06-Yu-zora\deadline-dock"
    }
}

function Import-DeadlineDockGoogleOAuth {
    # Explicit build environment wins; never combine values from different clients.
    if ($env:DEADLINE_DOCK_GOOGLE_CLIENT_ID -or $env:DEADLINE_DOCK_GOOGLE_CLIENT_SECRET) {
        if (-not $env:DEADLINE_DOCK_GOOGLE_CLIENT_ID -or -not $env:DEADLINE_DOCK_GOOGLE_CLIENT_SECRET) {
            throw 'Set both DEADLINE_DOCK_GOOGLE_CLIENT_ID and DEADLINE_DOCK_GOOGLE_CLIENT_SECRET.'
        }
        return
    }
    $configPath = Join-Path (Get-DeadlineDockRoot) 'client_secret.desktop.json'
    if (-not (Test-Path -LiteralPath $configPath)) { return }
    try { $desktop = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).installed }
    catch { throw 'Cannot read client_secret.desktop.json as Google Desktop OAuth JSON.' }
    if (-not $desktop -or [string]::IsNullOrWhiteSpace($desktop.client_secret) -or
        $desktop.client_id -notmatch '^[^\s]+\.apps\.googleusercontent\.com$') {
        throw 'client_secret.desktop.json must contain a complete Desktop OAuth client.'
    }
    $env:DEADLINE_DOCK_GOOGLE_CLIENT_ID = $desktop.client_id
    $env:DEADLINE_DOCK_GOOGLE_CLIENT_SECRET = $desktop.client_secret
}