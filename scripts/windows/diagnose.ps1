. (Join-Path $PSScriptRoot 'common.ps1')
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$root = Get-DeadlineDockRoot
Set-Location $root
Refresh-DeadlineDockPath
$out = Join-Path $root 'deadline-dock-diagnostics.txt'

$lines = New-Object System.Collections.Generic.List[string]
function Add([string]$Text='') { $lines.Add($Text) }
function Capture([string]$Label, [scriptblock]$Command) {
    try { Add ("{0}: {1}" -f $Label, ((& $Command 2>&1 | Out-String).Trim())) } catch { Add ("{0}: ERROR - {1}" -f $Label, $_.Exception.Message) }
}

Add 'Deadline Dock diagnostics'
Add ("Generated: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))
Add ("Project: {0}" -f $root)
Add ("OS: {0}" -f [Environment]::OSVersion.VersionString)
Add ("64-bit OS: {0}" -f [Environment]::Is64BitOperatingSystem)
Capture 'PowerShell' { $PSVersionTable.PSVersion }
Capture 'winget' { winget.exe --version }
Capture 'node' { node.exe --version }
Capture 'npm' { npm.cmd --version }
Capture 'rustup' { rustup.exe --version }
Capture 'rustc' { rustc.exe --version }
Capture 'cargo' { cargo.exe --version }
Add ("Node supported: {0}" -f (Test-SupportedNode))
Add ("VC Build Tools: {0}" -f (Test-VcBuildTools))
Add ("node_modules exists: {0}" -f (Test-Path (Join-Path $root 'node_modules')))
Add ("dist exists: {0}" -f (Test-Path (Join-Path $root 'dist')))
Add ''
Add '--- npm dependency summary ---'
if (Test-CommandExists 'npm.cmd') {
    try { Add ((& npm.cmd list --depth=0 2>&1 | Out-String).Trim()) } catch { Add $_.Exception.Message }
}
Add ''
Add '--- relevant paths ---'
Add ("USERPROFILE={0}" -f $env:USERPROFILE)
Add ("ProgramFiles={0}" -f $env:ProgramFiles)
Add ("CargoHome={0}" -f (Join-Path $env:USERPROFILE '.cargo'))

$lines | Set-Content -Path $out -Encoding UTF8
Write-Host "診断情報を書き出しました: $out" -ForegroundColor Green
Start-Process notepad.exe $out
