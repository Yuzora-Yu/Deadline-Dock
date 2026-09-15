# ブラウザ版

- 紹介・Windows版: https://yu-zora.com/tools/Tool05_deadline-dock/
- ブラウザ版: https://yu-zora.com/tools/deadline-dock/
- ソースはこのリポジトリの `web/`。`src/types.ts`、締切処理、タスク同期の差分計画はWindows版と共有。
- スマホ向けの件名登録、詳細編集、完了、分類、チェック項目、削除・取消、Google Sheets同期。
- 未連携時はIndexedDB。デモタスクの初期投入はしない。変更はトランザクション完了後に保存済み表示。別タブの更新を上書きしないよう保存世代を確認。
- JSONバックアップはWindows版へ読み込み可能。予定・関連リンク・履歴の編集はWindows版に限定。

## 開発・配信

```powershell
npm run dev:web
npm run build:web
npm test
node scripts/export-web.mjs "C:/Users/surfa/Documents/13-ポータルサイト/yu-zora-main/site/apps/deadline-dock"
```

開発URLは `http://localhost:1421/tools/deadline-dock/`。`127.0.0.1` からはGoogle認証の登録済み生成元と一致しないため認証しない。

`dist-web/` のHTML、JS、CSS、SVG、manifest、service workerだけをポータルへ転送。`build-manifest.json` は元コミットとファイルハッシュを記録する。更新時は、前回マニフェストに記載された旧成果物だけを整理する。ソース、node_modules、Windows EXE、秘密情報は配信しない。

ポータルは `site/apps/deadline-dock` を `dist/tools/deadline-dock` へコピーする。紹介ページの旧エイリアス `/tools/deadline-dock/` は廃止し、ここをアプリ本体に使う。紹介ページのソースはポータル `config/tools.json` のTool05。

service workerのスコープはアプリ配下のみ。Google API・OAuth・ポータルの他ページはキャッシュしない。初回オンライン読込後にオフライン起動可能。新しいworkerは既存画面が閉じた後に切り替わる。

## Google認証

Googleプロジェクト `deadline-dock-508705` の **Deadline Dock Web** を使用。公開client IDは `web/google.ts`。クライアントシークレットは不要・同梱禁止。

生成元: `https://yu-zora.com` と `http://localhost:1421`。
リダイレクトURI: それぞれの生成元に `/tools/deadline-dock/` を付ける。

通常はGISのトークンモデル。ポップアップが使えない環境は「同じタブでGoogleに接続」のOAuthリダイレクトを使用。ランダムstateと開始時刻をsessionStorageへ置き、戻り時に照合・削除。アクセストークンはメモリのみ。URLフラグメントは認証処理時に履歴から除去。ページ再読み込み・期限切れ後は再接続が必要。更新用トークンはブラウザへ保存しない。

権限は `openid email profile drive.file`。Windowsと同じプロジェクト内で、同じアカウントの同期用ファイルを選択。初回は件数・共通ID数を確認して合算。別IDは同じ件名でも両方残し、同IDで双方の変更が競合する場合は利用者が選択。

## 同期プロトコル

Windows v0.1.12以降と共通のシートID 100〜106、見出し、`deadlineDockGeneration` を使う。削除記録106は同じoperation_id/base_operation_id判定。物理行の削除後に読み直してタスク・分類・チェック項目を同期する。

書き込みは `DeadlineDockSyncGuard` のnamed rangeを旧IDで削除して新IDを追加するatomic batch。初回の固定ID `deadline_dock_sync_initialized_v1` と合わせて2件だけ保持。直前の値再確認と組み合わせ、別端末が古い行番号へ書き込むことを防ぐ。手動のシート構造編集はこのガードに参加しないため、同期中は行の並べ替え・列構造変更を避ける。

不足タブと空欄の見出しを追加し、既存の非空見出しが異なる場合は停止する。Windows版にある詳細な列幅・入力候補のレイアウトは通常同期で変更しない。

## 検証

`web/web.test.ts` は独立したIndexedDBを2つ使い、連続保存・再読込・古い世代の拒否・未知形式保護・同時更新の競合・親子削除・native互換ガード・不足タブ・シートからの件名だけ登録・空のチェックボックス領域を検証する。

実画面検証: `npm run build:web` の後に `npm run test:web-ui`。インストール済みEdgeを独立したヘッドレスプロファイルで使い、390px幅、編集、オフライン起動・登録、再読込、完了、削除・取消、横はみ出しを検証する。ユーザーの通常ブラウザには接続しない。

2026-09-15にWeb OAuthで実ユーザーの既存同期シート2件を読取確認。隔離したブラウザ作成シートで、Windows OAuthからの参照、ガード付き作業内容の更新、その変更のブラウザ取り込み、親子行削除を確認。実ユーザーのシート内容はこのWeb検証では変更していない。

追加確認: 削除直後の自動同期、SyncMeta/削除記録の非表示、同期ガード2件の維持を実APIで検証済み。検証専用シートは終了後にゴミ箱へ移動した。390px実画面・オフライン再読込テストも通過。
