# 別PCでの開発再開（2026-09-15）

## 作業場所

- `C:\Users\surfa\Documents\12-アプリ開発\Deadline-Dock`
- `git fetch origin` 後、開始時点のmainは `4ab39cf` でorigin/mainと一致。未コミット変更なし。
- 引き継ぎ元は [HANDOFF_2026-09-15.md](HANDOFF_2026-09-15.md)。次工程はPhase 1/2の実Google検証で、Phase 3は未着手。

## 環境

- 既存Node.js v24.15.0 / npm 11.12.1を使用し、`npm ci --no-audit --no-fund` 完了。
- Rustupを公式wingetパッケージから導入。Rust stable MSVC 1.98.1。
- Visual Studio 2022 Build Tools（VCToolsと推奨構成）を公式wingetパッケージから導入。Windows SDKも導入済み。
- WebView2は既存インストールを確認。
- Python検証はCodex同梱Pythonを使用。通常の`python`コマンドはWindowsAppsのエイリアスのため、単独のPython環境は別途必要。
- `.cargo/config.toml` の並列数2を維持。依存lockfileは変更なし。

## 今回の修正

設定画面の色選択コンポーネント内にGoogle連携設定が誤って含まれ、分類数に応じて重複していた。色選択内の重複を除き、設定ページ末尾の1か所に統一。設定画面の説明も任意のGoogle連携による送信を明記する内容に更新した。

## 検証

- `npm run check`: 成功（このリポジトリの型チェックコマンド）。
- `npm test`: 22件成功。
- `npm run build`: 成功。既存の静的・動的import混在によるchunk分割の警告あり。
- `scripts/validate.py`: 59項目成功。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib -j 2`: 10件成功。初回コンパイル14分46秒。
- 最初のRust試行はBuild Tools導入中で`link.exe`未検出となったが、導入後の再実行で解消。
- ブラウザのサンプルデータで一覧・詳細・設定を確認。修正後、Google連携設定が1か所となることをアクセシビリティツリーと画面で確認。
- `npm run tauri -- dev`: ビルド成功（テスト後の追加ビルド1分29秒）。`deadline-dock.exe`のウィンドウ名と応答ありをOSから確認。ネイティブ画面内の操作・実Google接続は未検証。
- 初回起動で既定のSQLite DBを作成し、同期関連テーブルを含むschemaを読み取り専用で確認。タスク数0件。
- Release/NSISインストーラーはこのPCでは未生成。今回は開発版の起動まで確認。
- このリポジトリには`lint`スクリプトはない。`git diff --check`は成功。

## 次の工程

このPCのアプリ内でGoogle OAuthクライアント設定と本人の認証を行い、引き継ぎ書の実Google検証項目を順に確認する。クライアント情報や実データをGit・チャットに保存しない。

起動前にはこのPCの既定保存先にタスクDBが存在しないことを確認した。前PCのタスク・認証情報はGitクローンでは移行されない。

開発起動は`02_DeadlineDockを起動.cmd`または`npm run tauri -- dev`。通常利用向けのRelease/NSISビルドは`03_Windows版をビルド.cmd`。

## 追記: Google接続の簡略化

利用者にOAuth設定を要求しない構成へ変更。ビルド時に共通Desktop OAuthクライアントを指定でき、既存の認証・シート作成・同期開始へ進む。個別入力は開発者向け詳細設定へ移動。詳細は[Google設定手順](GOOGLE_SHEETS_SETUP.md)を参照。

型チェック・Frontend build・TypeScript 22件・Rust 12件・Python検証59項目が成功。追加Rustテストは不完全な共通設定の拒否と、既存Client IDを更新時にも維持することを検証。ブラウザの模擬IPCで設定済み／未設定のボタン状態と開発者設定の折り畳みを確認。一時的な模擬画面は削除済み。

この時点では共通OAuthクライアントの登録・組み込みは未完了。後続の追記で完了。一般公開と実認証・実シート同期は未完了。

## 追記: Google Cloud側の準備

- 専用プロジェクト`Deadline Dock`（ID: `deadline-dock-508705`）を作成。
- Google Drive APIとGoogle Sheets APIを有効化し、各詳細ページで「有効」を確認。
- Google Auth Platform初期設定で、アプリ名`Deadline Dock`、ログイン管理者のサポート／連絡先メール、対象`外部`（テストモード）を入力。
- Google APIサービスのユーザーデータポリシーは本人が同意し、Auth Platform作成を完了。
- 必要scope、テストユーザー、Desktop OAuthクライアントとローカル設定は下記の通り完了。OAuth値・ユーザートークンは本記録に含めない。

## 追記: OAuthクライアント作成完了

本人がGoogleポリシーへ同意しAuth Platform作成を完了。openid/email/profile/drive.fileを登録し、本人をテストユーザーに追加。DesktopクライアントDeadline Dock Windowsを作成。ダウンロードJSONをGit対象外のclient_secret.desktop.jsonへ保存。Windows起動・ビルドスクリプトで読み込む。一般公開と実Google認証・同期の検証は引き続き未完了。

## 追記: 実データのチェック項目同期エラー復旧

2026-09-15 15:45 JST、未使用チェックボックスFALSE行の誤認を修正し、実アプリからの自動同期が正常終了（last_error=NULL）。既存チェック項目4件を1001〜1004行目から2〜5行目へ、内容・IDを変えずに移動。書込ジャーナルCONFIRMEDと移動前後の全セル一致、ブラウザでE2のチェック項目を確認。分類2件・チェック項目4件の同期状態を保持。Rust19件・TypeScript24件・型チェック成功。

## 追記: 件名のみ登録・2台の初回合算

件名のみ25件の取込と2つの独立同期状態への同一ID共有、別タスクの合算、同一タスクの同時編集競合をテスト。TypeScript28件・Rust22件・型チェック・build・Python63項目成功。初回確認は模擬IPCのブラウザ画面で表示→あとで確認→再表示→承認後同期まで検証。一時画面は削除。実アプリを再起動してmigration0009適用、既存接続はinitial_sync_confirmed=1、同期正常終了・last_error=NULL・未同期タスクrevision0件を確認。別の実PCでのOAuth・同時利用は未検証。
