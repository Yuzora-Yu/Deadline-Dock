# Deadline Dock Windows Quick Start

この手順は次の解凍先を前提にしています。

```text
C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
```

## 一番簡単な方法

### 初回だけ

`01_初回セットアップ.cmd` をダブルクリックしてください。

途中でWindowsの「このアプリがデバイスに変更を加えることを許可しますか？」が表示された場合は、Microsoft / Visual Studio / Node.js / Rustのインストール内容を確認した上で「はい」を選びます。

最後に `セットアップ完了です。` と表示されれば準備完了です。

### Deadline Dockを起動

`02_DeadlineDockを起動.cmd（開発確認用）` をダブルクリックしてください。

初回のTauri起動ではRust側のコンパイルが走ります。黒いPowerShell画面はDeadline Dock実行中は閉じないでください。

Deadline Dockの右上×を押すと、アプリは終了せずタスクトレイへ隠れます。完全に終了する場合は、タスクトレイのDeadline Dockメニューから `終了` を選びます。

## 普通のWindowsアプリにする

開発モードで一通り動いたら `03_Windows版をビルド.cmd` をダブルクリックします。

成功すると：

```text
C:\Users\ship2\Documents\06-Yu-zora\deadline-dock\windows-build
```

が開きます。

`Deadline-Dock.exe` は直接起動できます。NSISのsetup `.exe` は通常のWindowsアプリとしてインストールするためのものです。

## PowerShellで実行したい場合

初回：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
.\01_初回セットアップ.cmd
```

起動：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
.\02_DeadlineDockを起動.cmd（開発確認用）
```

ビルド：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
.\03_Windows版をビルド.cmd
```

## エラーになったら

まずPCを再起動して、`01_初回セットアップ.cmd` をもう一度実行してください。

まだ失敗する場合：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
.\05_診断情報を作成.cmd
```

生成される `deadline-dock-diagnostics.txt` の内容を共有してください。

## Windowsの警告について

この開発版はコード署名証明書を使用していません。そのため、自分のPCで生成した `Deadline-Dock.exe` やNSIS installerを初回実行すると、Windowsが「発行元を確認できません」等の警告を出す場合があります。

これは外部APIや有料証明書を使わない開発版であることによるものです。ファイルの入手元がこのプロジェクトであることを確認したうえで実行してください。

ZIP内の `.cmd` がWindowsによってブロックされた場合は、まずZIPファイルを右クリック →「プロパティ」→「許可する / ブロック解除」が表示されていればチェックしてから再展開してください。


## v0.1.4 hotfix

Windows実機で `tauri::generate_context!()` が `serde_json` を必要とすることを確認し、Cargo依存を追加済みです。セットアップ失敗時はログがメモ帳で自動表示され、コンソールは自動で閉じません。


## 日常利用

`03_Windows版をビルド.cmd` で作成したNSISインストーラーからインストールしてください。インストール後はDeadline Dock本体を直接起動します。Release版はWindows GUI subsystemでビルドされるため、CMD / PowerShell等のコンソール画面は表示されません。
