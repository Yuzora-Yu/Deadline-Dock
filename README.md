# Deadline Dock

締切を中心に仕事を管理する、ローカル完結型のWindowsデスクトップタスク管理アプリです。

Current development snapshot: **v0.1.10-dev**

## 引き継ぎ・現在の状態

別PCからの再開は [最新の引き継ぎ書](docs/HANDOFF_2026-09-15.md) を最初に読んでください。Google連携のセットアップは [こちら](docs/GOOGLE_SHEETS_SETUP.md)。実タスクや認証情報はリポジトリに含みません。

## コンセプト

- 「件名 + 締切」だけで即登録。必要なときは同じ登録画面から詳細入力へ展開
- 締切を重要度より優先
- 日付だけでなく「今週中」「9月中旬」「ASAP」などの曖昧期限に対応
- 締切変更を上書きせず履歴として記録
- 会議・イベント日時は締切と別に複数登録
- 作業フォルダ・ファイル・URLをタスクに紐づけ、ワンクリックで開く
- 完了済みタスクも検索可能な仕事台帳として保持
- 過去タスクを登録フォームへ複写し、内容を編集してから新規登録
- ミニウィンドウ、Always on Top、システムトレイ、グローバルショートカット
- JSONバックアップ / 復元
- ローカル機能はアカウント不要。Google Sheets連携は任意（タスク双方向同期・競合対応、実Google接続は確認待ち）

## 技術構成

- Tauri 2
- React + TypeScript + Vite
- SQLite (`@tauri-apps/plugin-sql`)
- Tauri公式 Dialog / Opener / FS / Global Shortcut / Window State

製品版ではデータをPC内のSQLite DB (`deadline-dock.db`) に保存します。
ブラウザでUIだけ確認する場合は、開発用フォールバックとして `localStorage` を利用します。

## 現在の実装

### タスク・期限

- タスク作成・編集・削除（Soft Delete）
- 未着手 / 作業中 / 完了
- 作業開始日時・完了日時の自動記録
- 締切：日付、日時、今日、明日、今週、来週、今月、来月、任意月の上旬/中旬/下旬、ASAP
- 「今ヤバい順」の緊急度算出
- 締切変更履歴・延期回数
- Snooze / 表示開始日時
- 完了・削除直後のUndo

### 情報・履歴

- 分類の追加・名称変更・削除・並び替え・10色の色設定
- 作業内容に加えて、タスク内チェック項目（作成・編集・✓オン/オフ・並べ替え・削除）
- 会議・イベントの複数登録
- ファイル / フォルダ / URL の複数登録
- OSの選択ダイアログからファイル・フォルダ登録
- 関連先をOS標準アプリで開く
- タスク変更履歴表示
- 過去タスク複写（件名・締切・説明・分類・予定・関連先等を登録フォームへ事前入力し、登録前に編集可能）

### 一覧・検索

- タスク検索（件名・作業内容・チェック項目・分類・Resource名/パス/URL）
- ステータスフィルター
- 分類フィルター
- 延期有無フィルター
- 締切種別フィルター
- 登録日範囲フィルター
- 完了日範囲フィルター（Archive）
- 緊急度 / 締切 / 更新 / 登録 / 完了 / 件名ソート
- 完了済みアーカイブ
- 簡易予定一覧
- 検索・期間指定向けSQLiteインデックス
- SQLite FTS5 trigram検索（3文字以上）＋短い語のLIKEフォールバック
- 大量一覧の段階描画（160件単位）＋画面外レンダリング抑制

### デスクトップ

- ミニウィンドウ
- Always on Top
- システムトレイ
- クイック登録グローバルショートカット（設定画面で候補変更 / 無効化可能）
- クイック登録は日付選択を基本とし、候補（今日 / 明日 / 明後日 / 月末 / 週・月 / 上中下旬 / ASAP）と文字入力も利用可能
- クイック登録から詳細入力（分類・作業内容・チェック項目・予定・作業場所・表示開始）へ展開可能
- 候補／詳細を開くとQuick Addウィンドウを拡張し、画面に収まらない場合はスクロール可能
- 件名 → Enter → 締切 → Enter のキーボード登録 / Escキャンセル
- main / miniウィンドウの位置・サイズ・最大化状態の自動復元
- quickウィンドウは位置状態を保存せず毎回クイック入力向けに表示
- ミニウィンドウのタスクをクリックするとメイン画面で該当タスクを直接表示
- ミニウィンドウはフォーカス復帰時＋10秒間隔でローカルデータを再読込

### データ保全

- SQLiteによるローカル保存
- JSONバックアップ書き出し
- JSONバックアップからの復元
- Backupには履歴・削除済みデータを含む全ローカルデータを保存
- 復元前のメモリ内Safety Snapshotによるベストエフォート復旧
- UUID / workspace_id / actor_id / revision / deleted_at を用いた将来同期対応のデータ構造

## Windowsで最初に動かす

ZIPを `C:\Users\ship2\Documents\06-Yu-zora\deadline-dock` に解凍する想定で、Windows用の補助スクリプトを同梱しています。

1. `01_初回セットアップ.cmd` をダブルクリック
2. 開発確認が必要な場合だけ `02_DeadlineDockを起動.cmd` を使用
3. 通常利用する場合は `03_Windows版をビルド.cmd` を実行し、生成されたNSISインストーラーでインストール
4. インストール後はスタートメニュー等の **Deadline Dock** から直接起動する（CMD / PowerShellは使用しない）

`01_初回セットアップ.cmd` は不足している Node.js LTS / Rust MSVC / Microsoft C++ Build Tools / WebView2 を確認し、必要なものだけ `winget` で導入した後、npm / TypeScript / Frontend / Rust のチェックを行います。

問題が起きた場合は `05_診断情報を作成.cmd` を実行すると `deadline-dock-diagnostics.txt` が生成されます。

PowerShellから手動実行する場合：

```powershell
cd C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
.\01_初回セットアップ.cmd
.\02_DeadlineDockを起動.cmd
```

詳細は `00_最初に読んでください.txt` と `docs/WINDOWS_QUICKSTART.md` を参照してください。

現在の `tauri.conf.json` はWindows向けNSISバンドルを対象にしています。

### 通常利用時の起動について

`02_DeadlineDockを起動.cmd` は開発確認用です。`tauri dev` の親プロセスとしてPowerShell画面が残るため、日常利用では使用しません。

Release版には Windows GUI subsystem を指定しているため、`Deadline-Dock.exe` またはNSISでインストールしたDeadline Dockを直接起動した場合、コンソール画面は表示されません。アプリを閉じる際もCMD/PowerShellには依存せず、タスクトレイの「終了」で完全終了できます。

## データベース

Migration：

- `src-tauri/migrations/0001_init.sql` — 初期schema
- `src-tauri/migrations/0002_query_indexes.sql` — 検索・一覧向けindex
- `src-tauri/migrations/0003_fts_search.sql` — FTS5 trigram全文検索と同期trigger
- `src-tauri/migrations/0004_category_color.sql` — 分類色
- `src-tauri/migrations/0005_check_items.sql` — タスク内チェック項目 + FTS再構築
- `src-tauri/migrations/0006_google_sync.sql` — Google連携設定と同期用テーブル
- `src-tauri/migrations/0007_task_sync.sql` — 自動同期設定・競合一意制約・送信前ジャーナル

主なテーブル：

- `workspaces`
- `actors`
- `tasks`
- `categories`
- `schedule_events`
- `resources`
- `task_check_items`
- `task_history`

## ウィンドウ

- `main`: 通常の2ペイン画面
- `mini`: 常駐用コンパクト画面
- `quick`: グローバルショートカット用高速登録画面

## バックアップ

設定画面からJSONバックアップを保存・復元できます。

バックアップには以下を含みます。

- Workspace / Actor
- Task（Soft Delete済みも含む）
- Category
- Schedule Event
- Resource
- Task Check Item
- Task History

復元は現在のローカルデータを置き換える破壊的操作なので、UIで確認を要求します。

Tauri版では安全性のため、バックアップファイルの読み書き権限をユーザーHOME配下に限定しています。

## 外部通信について

ローカル機能の通常利用に外部通信は不要です。任意のGoogle連携ではRustからGoogle OAuth / Drive / Sheets APIへ接続します。設定方法と実装範囲は [Google連携ガイド](docs/GOOGLE_SHEETS_SETUP.md) を参照してください。

将来の複数ユーザー共有はv0.1の対象外ですが、同期を後付けしやすいID・Revision・Actor・Workspace構造を先に持たせています。

## 現在の残作業

主な残作業は以下です。

- 実npm依存を使ったFrontend production build確認
- Windows実機でのTauri統合テスト
- Windows上でFTS5 / Tray / Global Shortcut / Window Eventの実動確認
- NSISインストーラ生成
- 実利用フィードバックに基づくUI密度・キーボード操作調整

詳細は `docs/IMPLEMENTATION_STATUS.md` を参照してください。


## v0.1.6 UI方針

メイン・ミニ・ショートカット・複写のどこからでも、独立した同一のタスク登録ウィンドウを開きます。登録フォームを親ウィンドウ内に押し込まないため、親画面サイズと競合しません。

配布ZIPは `scripts/package_release.py` でUTF-8ファイル名を検証して作成します。日本語ファイル名を維持したままWindows標準展開で文字化けしない形式を使用します。
