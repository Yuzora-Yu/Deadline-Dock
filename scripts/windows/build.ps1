. (Join-Path $PSScriptRoot 'common.ps1')
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$root = Get-DeadlineDockRoot
Assert-ProjectRoot $root
Set-Location $root
Refresh-DeadlineDockPath

try {
    Write-Host 'Deadline Dock のWindows版をビルドします。' -ForegroundColor Green
    if (-not (Test-SupportedNode) -or -not (Test-CommandExists 'cargo.exe') -or -not (Test-VcBuildTools)) {
        throw 'ビルド環境が不足しています。先に 01_初回セットアップ.cmd を実行してください。'
    }
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        & npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install に失敗しました。' }
    }

    & npm.cmd run tauri -- build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "Windowsビルドに失敗しました (exit=$LASTEXITCODE)。" }

    $outDir = Join-Path $root 'windows-build'
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    $portable = Join-Path $root 'src-tauri\target\release\deadline-dock.exe'
    if (Test-Path $portable) {
        Copy-Item $portable (Join-Path $outDir 'Deadline-Dock.exe') -Force
    }

    $nsisDir = Join-Path $root 'src-tauri\target\release\bundle\nsis'
    $installer = Get-ChildItem $nsisDir -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) {
        Copy-Item $installer.FullName (Join-Path $outDir $installer.Name) -Force
    }

    Write-Host ''
    Write-Host 'ビルド完了です。' -ForegroundColor Green
    Write-Host "出力先: $outDir" -ForegroundColor Cyan
    Write-Host 'Deadline-Dock.exe はコンソール非表示の直接実行版、もう一つの .exe はインストーラーです。'
    Write-Host '日常利用では 02_DeadlineDockを起動.cmd を使わず、インストール後の Deadline Dock を直接起動してください。' -ForegroundColor Cyan
    Start-Process explorer.exe $outDir
} catch {
    Write-Host ''
    Write-Host 'ビルドに失敗しました。' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host '「05_診断情報を作成.cmd」を実行して、生成されたtxtをこちらに貼ってください。' -ForegroundColor Yellow
    exit 1
}
