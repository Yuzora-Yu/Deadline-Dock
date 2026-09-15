# Windows Build Guide

Deadline DockはWindows向けTauri 2アプリです。

## 推奨：同梱スクリプトを使う

解凍先を次の場所とします。

```text
C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
```

### 1. 初回セットアップ

エクスプローラーから：

```text
01_初回セットアップ.cmd
```

PowerShellから：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
.\01_初回セットアップ.cmd
```

このスクリプトは以下を確認し、不足分だけ導入します。

- Node.js LTS（Vite 7対応版）
- Rust / Cargo（stable-msvc）
- Microsoft Visual Studio 2022 Build Tools
  - `Microsoft.VisualStudio.Workload.VCTools`
- Microsoft Edge WebView2 Runtime
- npm dependencies

その後、`npm run check`、`npm run build`、`cargo check` を実行します。

### 2. 開発起動

```text
02_DeadlineDockを起動.cmd
```

PowerShellから：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
.\02_DeadlineDockを起動.cmd
```

Tauri development modeで起動します。黒いコンソールは実行中は閉じないでください。

### 3. Windows版を生成

```text
03_Windows版をビルド.cmd
```

成功時は次のフォルダが開きます。

```text
C:\Users\ship2\Documents\06-Yu-zora\deadline-dock\windows-build
```

生成物：

- `Deadline-Dock.exe` — 直接起動用
- NSIS `.exe` — Windowsインストーラー

### 4. ブラウザだけでUI確認

```text
04_ブラウザだけで確認.cmd
```

これはTauri固有機能を使わない確認用です。System Tray / Always on Top / ファイル起動 / SQLite実機動作等の検証には使えません。

### 5. エラー時

```text
05_診断情報を作成.cmd
```

次のファイルが作成され、自動でNotepadが開きます。

```text
C:\Users\ship2\Documents\06-Yu-zora\deadline-dock\deadline-dock-diagnostics.txt
```

その内容をそのままサポート時に共有してください。

## 手動コマンド

補助スクリプトを使わない場合：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
npm.cmd install
npm.cmd run check
npm.cmd run tauri -- dev
```

Release build：

```powershell
npm.cmd run tauri -- build --bundles nsis
```

## 実機で確認する項目

- SQLite migration v1 / v2 / v3（FTS5 trigramを含む）
- Task CRUD
- Quick Add / Global Shortcut
- 日本語IME変換中のEnter
- System Tray / Close → Tray hide / Trayから終了
- main / mini Window State復元
- miniのTaskクリック → mainの該当Task表示
- Always on Top
- File picker / Folder picker
- C: / D: / UNCを含むFile / Folder opener
- URL opener
- JSON Backup / Restore
- NSIS install / uninstall

## 備考

Tauri 2のWindows開発にはMicrosoft C++ Build ToolsとWebView2が必要です。NSISのみを生成するため、MSI向けVBSCRIPT設定は不要です。
