. (Join-Path $PSScriptRoot 'common.ps1')
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$root = Get-DeadlineDockRoot
Assert-ProjectRoot $root
Set-Location $root
Refresh-DeadlineDockPath

try {
    if (-not (Test-SupportedNode)) { throw 'Node.jsがありません。先に 01_初回セットアップ.cmd を実行してください。' }
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        & npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install に失敗しました。' }
    }
    Write-Host 'ブラウザ確認版を起動します。デスクトップ固有機能（トレイ・常駐・ローカルパス起動）は使えません。' -ForegroundColor Yellow
    Start-Process 'http://127.0.0.1:1420'
    & npm.cmd run dev -- --host 127.0.0.1
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
