# Architecture

> 2026-09-14追記: 以下はv0.1の既存仕様です。今回追加する任意のGoogle連携については `DeadlineDock_GoogleSheets_Sync_Handoff.md` と `GOOGLE_SHEETS_SETUP.md` を参照してください。ローカル機能は引き続きオフラインで利用できます。

## 方針

Deadline DockはLocal Firstです。v0.1ではネットワーク層を持ちません。

```text
React UI
  ↓
Repository Interface
  ├─ SqliteRepository (Tauri製品版)
  └─ BrowserRepository (UI開発/プレビューのみ)
  ↓
SQLite / localStorage
```

UIコンポーネントはSQLiteへ直接依存せず、Repository Interfaceを経由します。
将来同期を追加する場合も、UIを大きく変更せずRepository / Sync Layer側へ追加できる構成を意図しています。

## Desktop Integration

デスクトップ固有機能はTauri 2と公式Pluginへ分離しています。

```text
platform.ts
  ├─ Dialog: file / folder / backup file selection
  ├─ Opener: file / folder / URL open
  ├─ FS: backup JSON read / write
  ├─ Window API: hide / always-on-top / window focus
  ├─ Event API: mini → main task navigation
  └─ Global Shortcut: frontend dynamic register / unregister

Rust host
  ├─ SQLite plugin + migrations
  ├─ Global Shortcut plugin host
  ├─ System Tray
  └─ Window State
```

UIから外部Web APIへ通信する層はありません。

## Deadlineモデル

Deadlineは単一日時ではなく次の3種類を持ちます。

- `EXACT`
- `FUZZY_RANGE`
- `ASAP`

曖昧期限では、人間向けラベルと内部範囲を両方保存します。

```text
9月中旬
label       = "9月中旬"
range_start = 9/11 00:00
range_end   = 9/20 23:59
```

表示時は原則として内部変換後の日付ではなく、人間向けlabelを維持します。

## History

Taskの重要変更は上書きだけで終わらせず `task_history` に追記します。
`old_value`, `new_value` はJSON文字列として格納し、Historyのschema追加に強くします。

Soft DeleteをUndoした場合も `TASK_RESTORED` を追記するため、「削除した事実を復元によって消す」ことはしません。

## Backup Snapshot

バックアップはアプリ全体の論理データを1つのJSON Snapshotとして書き出します。

```text
BackupSnapshot
  format = deadline-dock-backup
  schemaVersion = 1
  exportedAt
  workspaces[]
  actors[]
  tasks[]
  categories[]
  events[]
  resources[]
  history[]
```

Soft Delete済みレコードとHistoryも含めます。

復元時は以下の順序で処理します。

1. format / schema形状・ID重複・参照整合性を検証
2. 現在DBをSafety Snapshotとしてメモリへexport
3. FK依存順を考慮して現在データを削除
4. 親 → 子の順にimport
5. Taskの `duplicated_from_task_id` は全Task挿入後に復元
6. エラー時はSafety Snapshotからベストエフォートで復旧

現在のTauri JavaScript SQL層に依存しすぎないようRepository内部で完結させています。

## Search / Filter

v0.1.2-devでは通常indexに加えてSQLite FTS5のtrigram tokenizerを使用します。

```text
Task / Category / Resource change
        ↓ trigger
     task_search (FTS5 trigram)
```

3文字以上の検索語はFTSへ送り、日本語・パス・URLの部分一致を高速化します。2文字以下の検索語はtrigramでは成立しないため、既存LIKE検索へ自動フォールバックします。

通常index：

```text
idx_tasks_created_at
idx_tasks_completed_at
idx_tasks_updated_at
idx_tasks_deadline_type
idx_tasks_postponement_count
```

UIは全検索結果を一度にDOMへ描画せず160件単位で追加描画し、`content-visibility` で画面外Rowのレンダリングコストも抑制します。DB結果自体のpaginationは、実測上必要になった段階でRepositoryへ追加します。

## Window State

main / miniは位置・サイズ・最大化状態を自動保存します。

`VISIBLE` 状態は保存しません。

これは「閉じる → Trayへ隠す」という動作を保存して、次回起動時まで非表示になる事故を避けるためです。

Quick Addは毎回入力用の位置・サイズで出すことを優先し、Window State保存対象から除外します。

## 将来同期

v0.1では同期しません。ただし以下を先に持っています。

- UUID
- workspace_id
- actor_id
- revision
- updated_at
- deleted_at

SQLiteファイル自体を共有ドライブ上で複数PCから同時編集する設計にはしません。
共有を実装する場合は、各PCはローカルDBを持ち、変更イベントを明示的に同期する構造を前提にします。
# Google連携の利用者向け接続（2026-09-15）

Desktop app OAuthクライアントは配布ビルド時にアプリへ組み込み、利用者は「Googleと連携」からブラウザで同意する。既存のPKCE/loopback認証、専用シート自動作成・再利用、同期開始を使用する。手動OAuth入力は開発者向け詳細設定に置く。設定未組み込みのビルドは接続不可であることを明示する。

既存の手動設定と認証済みクライアントを優先し、refresh tokenとClient IDの対応を保つ。ユーザートークンはPCの資格情報へ保存し、配布物には含めない。独自バックエンドは導入しない。Google Cloud上のアプリ登録・公開準備と実接続検証は別途必要。

### 関連データの同期と空チェックボックス

分類→タスク→チェック項目の順に同期する。migration 0008のrelated_sync_stateに前回のローカル／リモート行を保存し、同時変更はsync_conflictsで明示選択する。未使用のチェックボックス列に返されるFALSEは実データとみなさない。TRUE、ID、文章、数式は空行ではない。既存データの位置修復は既知の旧エクスポート形状と一致する場合のみ、再読込比較・書込ジャーナル・単一batchUpdate・送信後の検証を伴って行う。

### 急ぎではない期限と初回合算

「急ぎではない」は日付を持たないFUZZY_RANGE（label固定、exact/rangeStart/rangeEndはNULL）として表現する。架空の将来日を設定しない。旧バージョンの同期パーサーは対応しないため接続PCを両方更新する。

migration 0009でinitial_sync_confirmedを追加。同期済みの既存接続は承認済みへ移行、新規・接続解除・同期先切替・バックアップ復元では未承認とする。初回プレビューはローカルのタスク/分類/チェック項目とリモート3タブを指紋化し、確認時に再取得して比較。承認前のデータ書込みはRust境界でも拒否する。一意な同名分類をリモートIDへ対応づけ、タスクの参照をトランザクション内で移し、ローカル属性差は競合解決に残す。タスクの件名一致のみで自動統合しない。
