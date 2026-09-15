# Google連携 作業結果（2026-09-15 / v0.1.12）

現在の実装と公開設定は [GOOGLE_PRODUCTION.md](GOOGLE_PRODUCTION.md)、変更点は [CHANGELOG.md](CHANGELOG.md) を参照してください。v0.1.10時点の引き継ぎ書は過去の記録です。

- タスク・分類・チェック項目の双方向同期、初回合算確認、競合比較を実装済み。
- 親タスク削除時の子データ削除、削除同期用の非表示タブ、不足タブの再作成、レイアウト修復に対応。
- 予定・関連リンクは内容の独立同期が未対応。親タスク削除時の行整理のみ対応。
- TypeScript 30件、Rust 30件、既存検証67項目を通過。Google実APIによる検証用シートでの修復・削除・再作成テストも成功。
- 2台の実PCを同時接続した試験は未実施。両方のPCをv0.1.12以降に揃えること。

作業先: `C:\Users\surfa\Documents\12-アプリ開発\Deadline-Dock`。実データは `%APPDATA%\local.deadlinedock.app\deadline-dock.db`。認証情報・実データ・バックアップはGitと配布物に含めません。

実API試験は `src-tauri/src/live_checks.rs` の無効化済みテストです。利用者の明示的な承認がある環境でのみ、`DEADLINE_DOCK_LIVE_AUTH_DB` に既存DBを指定して `cargo test live_google_maintenance -- --ignored --nocapture` を実行します。認証DBは読取専用で使用し、別の合成データ専用シートを作成して終了時にゴミ箱へ移します。
