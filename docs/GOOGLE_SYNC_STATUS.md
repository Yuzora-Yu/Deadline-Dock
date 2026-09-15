# Google連携 作業結果（2026-09-14）

## 実装した範囲

v0.1.9: Phase 1「Google OAuth接続・専用シート作成・URL操作」のコードを追加。

- PKCE S256、state照合、127.0.0.1のランダムポート、3分で終了する認証listener。
- refresh tokenとOAuth client secretをWindows Credential Managerへ保存。
- OAuth / userinfo / Drive / Sheetsの通信はRust側。トークンを画面、SQLite、バックアップ、ログに出さない。
- シートIDとURL、メールをSQLiteのmigration 0006で保存。
- 専用シート作成と初期6タブ、固定sheetId、システム列非表示、ヘッダー、フィルター、ステータス選択、チェック項目のcheckbox。
- URL表示・コピー・OS既定ブラウザで開く、再接続、作成失敗時の再試行、連携解除。
- 作成済みファイルをappPropertiesで検索して再利用。複数候補は自動選択を停止する（候補選択UIは今後の対応）。
- Browser版ではデスクトップ限定の案内。

タスクの送受信、初回タスクpush、60秒polling、競合処理、関連データ同期は未実装。シート作成後もタスクは自動送信しません。

## 検証

- `python scripts/validate.py`: 57項目成功。
- `npm run check`: 成功。
- `npm run build`: 成功。既存のTauri API static/dynamic import混在のバンドル警告あり。
- `cargo check`: 成功。
- `cargo test --lib`: 6件成功（PKCEベクトル、state/重複パラメーター、URL制限、HTTPエラー秘匿、模擬API応答、実Windows資格情報の保存/読出/削除）。
- `cargo build --release`: 成功。GUI subsystemを維持。windows-buildの更新版exeとビルド出力のSHA-256一致を確認。
- `scripts/package_release.py`: 日本語filenameのUTF-8 flagとPS1 BOM検証成功。
- 模擬APIのsocket通信テストはWindows環境で終了せず、最終版はHTTPレスポンスを注入するモックへ変更。実Google APIのnetwork integrationは未確認。
- Windows UI操作ツールは `accessibility window-opened handler did not become ready` と返し、更新版を起動できず。実画面とコピー/オープンのE2Eは未確認。
- Google Cloudクライアント情報が未入力のため、実Googleアカウントでの認証・シート生成・再起動後の認証継続は未確認。Phase 1の全Acceptance Criteria達成とは扱わない。

## パス修正

作業フォルダは `C:\Users\ship2\Documents\06-Yu-zora\deadline-dock`。
README、Windowsガイド、導入テキスト、common.ps1の旧パスを修正。
Downloadsの引き継ぎ書にも新パスを記載し、docsへ同内容を保管。
日本語PS1のUTF-8 BOMを保持。

SQLite本体は既存の `%APPDATA%\local.deadlinedock.app\deadline-dock.db` を継続利用。ユーザーのタスクデータを別DBへ切り替えていない。

## 容量整理

開始時約10.8GiB → 整理後約125MiB（約10.6GiB削減）。

削除:
- Rust debug/releaseの再生成可能なビルドキャッシュ（cargo cleanを使用）
- 古いv0.1.7インストーラー
- 過去のセットアップログ

保持:
- 全ソース、Cargo/npm lockfile、開発に必要なnode_modules
- src-tauri/deadline-dock-backup-20260914-1528.json
- SQLiteの作業前バックアップ backups/before-google-sync-20260914.db
- v0.1.8インストーラー（戻すための前版）
- v0.1.9 windows-build/Deadline-Dock.exe とソースZIP

Windowsが保持していて削除不能な停止済みテストexe 2個（約19MiB）は src-tauri/target/locked-tests に隔離して保持。PC再起動後に `cargo clean --manifest-path src-tauri/Cargo.toml` で削除可能。稼働中だった旧Downloadsフォルダのアプリ・フォルダは保持。

バックアップDB/JSON、認証設定、ログをGitやソースZIPへ混入させない除外を追加。GitHubへのPushは実施していない。

## 次の作業

1. GOOGLE_SHEETS_SETUP.mdに従ってDesktop app用OAuthクライアントをアプリへ設定。
2. 旧アプリをトレイから終了して、移動先windows-buildの更新版を起動。
3. 実GoogleでPhase 1 acceptance（接続、URL操作、再起動、解除・再接続）を確認。
4. Phase 2: Taskの差分比較・ID照合・atomicなSQLite更新・Google Sheets actor履歴・競合UI・polling・オフライン保留を実装。
5. Phase 3/4: 関連データ、複数候補選択UI、削除Sheetの再作成UI、API backoffを実装。
