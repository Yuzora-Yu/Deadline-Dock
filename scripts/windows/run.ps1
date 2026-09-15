. (Join-Path $PSScriptRoot 'common.ps1')
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$root = Get-DeadlineDockRoot
Assert-ProjectRoot $root
Set-Location $root
Refresh-DeadlineDockPath

try {
    Write-Host 'Deadline Dock を開発モードで起動します。' -ForegroundColor Green
    Write-Host 'この黒い画面はアプリ実行中は閉じないでください。'
    Write-Host 'アプリを終えるときは、タスクトレイの Deadline Dock →「終了」を使ってください。' -ForegroundColor Cyan
    Write-Host ''

    if (-not (Test-SupportedNode) -or -not (Test-CommandExists 'cargo.exe')) {
        throw '必要な開発ツールがありません。先に 01_初回セットアップ.cmd を実行してください。'
    }
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        Write-Host 'node_modules がないため npm install を実行します。' -ForegroundColor Yellow
        & npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install に失敗しました。' }
    }

    & npm.cmd run tauri -- dev
    if ($LASTEXITCODE -ne 0) { throw "Tauriの起動に失敗しました (exit=$LASTEXITCODE)。" }
} catch {
    Write-Host ''
    Write-Host '起動に失敗しました。' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host '「05_診断情報を作成.cmd」を実行して、生成されたtxtをこちらに貼ってください。' -ForegroundColor Yellow
    exit 1
}
