. (Join-Path $PSScriptRoot 'common.ps1')

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$root = Get-DeadlineDockRoot
Assert-ProjectRoot $root
Set-Location $root
$log = Join-Path $root 'deadline-dock-setup.log'

try { Start-Transcript -Path $log -Append | Out-Null } catch {}

try {
    Write-Host 'Deadline Dock 初回セットアップ' -ForegroundColor Green
    Write-Host "プロジェクト: $root"
    Write-Host '不足している開発ツールだけをインストールします。'
    Write-Host 'Visual Studio Build Tools 等のインストール時に Windows の確認画面が出る場合があります。'

    Refresh-DeadlineDockPath

    if (-not (Test-CommandExists 'winget.exe')) {
        throw 'winget が見つかりません。Microsoft Store の「アプリ インストーラー (App Installer)」を更新してから、もう一度 01_初回セットアップ.cmd を実行してください。'
    }

    Write-Step '1/5 Node.js LTS を確認'
    if (-not (Test-SupportedNode)) {
        Write-Host '対応Node.jsがないため、Node.js LTSをインストールします。' -ForegroundColor Yellow
        & winget.exe install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "Node.js のインストールに失敗しました (exit=$LASTEXITCODE)。" }
        Refresh-DeadlineDockPath
    }
    if (-not (Test-SupportedNode)) {
        throw 'Node.js を認識できません。Windowsを一度再起動してから 01_初回セットアップ.cmd を再実行してください。'
    }
    Write-Host "Node.js: $(& node.exe --version)" -ForegroundColor Green
    Write-Host "npm: $(& npm.cmd --version)" -ForegroundColor Green

    Write-Step '2/5 Rust (MSVC) を確認'
    if (-not (Test-CommandExists 'rustup.exe')) {
        Write-Host 'Rustupをインストールします。' -ForegroundColor Yellow
        & winget.exe install --id Rustlang.Rustup -e --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "Rustup のインストールに失敗しました (exit=$LASTEXITCODE)。" }
        Refresh-DeadlineDockPath
    }
    if (-not (Test-CommandExists 'rustup.exe')) {
        throw 'rustup を認識できません。Windowsを一度再起動してから 01_初回セットアップ.cmd を再実行してください。'
    }
    & rustup.exe default stable-msvc
    if ($LASTEXITCODE -ne 0) { throw 'Rust stable-msvc の設定に失敗しました。' }
    Refresh-DeadlineDockPath
    Write-Host "rustc: $(& rustc.exe --version)" -ForegroundColor Green
    Write-Host "cargo: $(& cargo.exe --version)" -ForegroundColor Green

    Write-Step '3/5 Microsoft C++ Build Tools を確認'
    if (-not (Test-VcBuildTools)) {
        Write-Host 'C++ Build Tools が見つからないためインストールします。' -ForegroundColor Yellow
        Write-Host 'WindowsのUAC確認が出た場合は「はい」を押してください。'
        $override = '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
        & winget.exe install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --accept-package-agreements --accept-source-agreements --override $override
        if ($LASTEXITCODE -ne 0) { throw "Visual Studio Build Tools のインストールに失敗しました (exit=$LASTEXITCODE)。" }
    }
    if (-not (Test-VcBuildTools)) {
        throw 'C++ Build Tools の確認に失敗しました。PCを再起動後、01_初回セットアップ.cmd をもう一度実行してください。'
    }
    Write-Host 'C++ Build Tools: OK' -ForegroundColor Green

    Write-Step '4/5 Microsoft Edge WebView2 を確認'
    & winget.exe list --id Microsoft.EdgeWebView2Runtime -e --accept-source-agreements *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'WebView2 Runtime がwinget一覧で確認できないためインストールします。' -ForegroundColor Yellow
        & winget.exe install --id Microsoft.EdgeWebView2Runtime -e --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'WebView2の自動インストール確認に失敗しました。Windows 10/11では通常すでに搭載されています。02で起動できない場合だけ診断してください。'
        }
    } else {
        Write-Host 'WebView2 Runtime: OK' -ForegroundColor Green
    }

    Write-Step '5/5 Deadline Dock の依存関係を取得・検証'
    & npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install に失敗しました (exit=$LASTEXITCODE)。" }

    & npm.cmd run check
    if ($LASTEXITCODE -ne 0) { throw 'TypeScriptチェックに失敗しました。' }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'フロントエンドのビルドに失敗しました。' }

    & cargo.exe check --manifest-path (Join-Path $root 'src-tauri\Cargo.toml')
    if ($LASTEXITCODE -ne 0) { throw 'Rust/Tauriのチェックに失敗しました。' }

    Write-Host ''
    Write-Host 'セットアップ完了です。' -ForegroundColor Green
    Write-Host '次は「02_DeadlineDockを起動.cmd」をダブルクリックしてください。' -ForegroundColor Green
    Write-Host "ログ: $log" -ForegroundColor DarkGray
} catch {
    Write-Host ''
    Write-Host 'セットアップに失敗しました。' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host 'まずPCを再起動して、01_初回セットアップ.cmd をもう一度実行してください。' -ForegroundColor Yellow
    Write-Host 'それでも失敗する場合は「05_診断情報を作成.cmd」を実行し、生成されたtxtの内容をこちらに貼ってください。' -ForegroundColor Yellow
    Write-Host "セットアップログ: $log" -ForegroundColor DarkGray
    exit 1
} finally {
    try { Stop-Transcript | Out-Null } catch {}
}
