# Deadline Dock / Google Sheets 双方向同期機能
## Codex 引き継ぎ書
Version: 1.0
対象ベース: Deadline Dock v0.1.8
作業フォルダ: C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
作成日: 2026-09-14

---

## 1. この引き継ぎ書の目的

既存の Windows デスクトップアプリ「Deadline Dock」に、Google アカウント連携と Google Sheets 双方向同期を追加する。

最重要要件は次のとおり。

1. ユーザーが Deadline Dock から Google アカウントを連携できる。
2. 連携完了後、アプリ側が連携専用 Google スプレッドシートを自動作成する。
3. 作成したスプレッドシートの URL をアプリ側に保存し、ユーザーへ表示する。
4. ユーザーはアプリから「スプレッドシートを開く」「URLをコピー」ができる。
5. Deadline Dock で行ったタスク変更を Google Sheets に反映する。
6. Google Sheets 上で行った編集を Deadline Dock に反映する。
7. 有料サーバー、有料 API、Google Apps Script を必須にしない。
8. Deadline Dock のローカル SQLite を本体データとし、Google Sheets は同期先として扱う。
9. オフラインでも Deadline Dock のローカル機能は使える。
10. 同期競合を黙って上書きしない。

---

# 2. 結論：実現可能性

実現可能。

推奨構成は以下。

```text
Deadline Dock
  ├─ SQLite（本体データ）
  ├─ Google OAuth 2.0
  ├─ Google Drive API
  └─ Google Sheets API
          ↓
ユーザー自身の Google Drive
          ↓
Deadline Dock 連携用 Google スプレッドシート
```

Google アカウント OAuth 2.0 で認証したユーザーに代わってファイルを作成した場合、そのユーザーが Google Drive 上のファイル所有者になる。

Google Sheets API / Google Drive API の標準利用を前提とし、有料バックエンドは置かない。

---

# 3. Google 側で使用する API

## 必須

- Google Drive API
- Google Sheets API

## OAuth scope

原則として以下を使用する。

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

`drive.file` を優先すること。

広範な以下の scope は原則使用しない。

```text
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/spreadsheets
```

`drive.file` は、アプリが作成したファイルや、ユーザーがこのアプリに明示的に許可したファイルだけを扱うための scope として使用する。

Google 公式でも `drive.file` は推奨の非センシティブ scope とされている。

---

# 4. Google Cloud 側で事前に必要な設定

Codex 側でコードを作っても、Google Cloud Console 上の OAuth クライアント自体は別途必要。

最低限、以下を README / セットアップガイドへ記載すること。

1. Google Cloud Project を作成
2. Google Drive API を有効化
3. Google Sheets API を有効化
4. Google Auth Platform / OAuth consent screen を設定
5. OAuth Client を「Desktop app」で作成
6. Client ID を Deadline Dock 側へ設定

初期の個人・少人数テストでは Test User を設定してもよい。

ただし Google OAuth アプリを `Testing` のまま長期運用すると refresh token の有効期限問題が生じるため、常用段階では適切な Publishing Status にすること。

---

# 5. 認証方式

## 必須方針

Windows デスクトップアプリ向け OAuth 2.0 Authorization Code Flow + PKCE を使用する。

ブラウザを開き、ループバック IP に認証結果を返す。

例:

```text
http://127.0.0.1:{random_port}/oauth2callback
```

手動コピー＆ペースト式の OOB 認証は使用しない。

## 認証フロー

```text
設定画面
  ↓
「Google アカウントと連携」
  ↓
PKCE code_verifier / code_challenge 生成
  ↓
127.0.0.1 の空きポートで一時 callback listener 起動
  ↓
システムブラウザで Google OAuth URL を開く
  ↓
ユーザーが Google アカウント選択・同意
  ↓
localhost callback で authorization code 受信
  ↓
token endpoint で access token / refresh token 取得
  ↓
Google userinfo で email / sub / display name 取得
  ↓
refresh token を安全に保存
  ↓
スプレッドシート自動作成へ進む
```

OAuth 認証処理は可能な限り Rust 側へ置き、WebView / React 側に refresh token を露出させないこと。

---

# 6. Token の保存

## 禁止

refresh token を以下へ平文保存しない。

- SQLite
- JSON backup
- localStorage
- ログ
- React state の永続保存

## 推奨

Windows Credential Manager を使用する。

Rust の `keyring` crate 等を利用してよい。

保存キー例:

```text
service: DeadlineDock
username: google:<google_sub>
```

SQLite に保存してよいのは以下程度。

```text
google_account_sub
google_account_email
spreadsheet_id
spreadsheet_url
connection_status
last_sync_at
```

access token は短期利用とし、基本メモリ上。

---

# 7. 連携用スプレッドシートの自動作成

## 要件

Google 連携成功後、アプリ側で自動作成する。

ユーザーへ Google Drive を開いて手動作成させない。

## 推奨方式

Google Drive API:

```text
files.create
mimeType = application/vnd.google-apps.spreadsheet
```

を使用する。

理由:

- ユーザー自身を owner にできる
- `drive.file` scope で扱える
- `appProperties` を付けられる
- `webViewLink` を取得できる
- 将来、既存同期ファイルを検索・再接続しやすい

作成時の metadata 例:

```json
{
  "name": "Deadline Dock タスク同期",
  "mimeType": "application/vnd.google-apps.spreadsheet",
  "appProperties": {
    "deadlineDock": "true",
    "schemaVersion": "1",
    "workspaceId": "<DEFAULT_WORKSPACE_ID>"
  }
}
```

レスポンス fields:

```text
id,name,webViewLink
```

取得した `id` と `webViewLink` を SQLite の同期設定へ保存。

その後 Google Sheets API を使用してシート構成を初期化する。

---

# 8. スプレッドシート URL のユーザーへの提示

自動作成後、以下の UI を出す。

```text
Google Sheets 連携が完了しました

連携用スプレッドシートを作成しました。

[ スプレッドシートを開く ]
[ URLをコピー ]

https://docs.google.com/...
```

設定画面にも常設する。

```text
Google連携
────────────────────
接続中: example@gmail.com

同期先
Deadline Dock タスク同期

[ スプレッドシートを開く ]
[ URLをコピー ]
[ 今すぐ同期 ]

最終同期: 2026/09/14 17:20

[ Google連携を解除 ]
```

URL をユーザー本人へ見せるだけなら Drive の共有権限追加処理は不要。

ユーザー自身が owner なので、その URL を開ける。

将来的に「他ユーザーへ共有」までアプリから行う場合だけ、Drive API `permissions.create` を別機能として追加する。

初期版では勝手に `anyone` 権限を付けないこと。

---

# 9. Google Sheets の構成

スプレッドシートは複数タブ構成とする。

推奨:

```text
1. タスク一覧
2. チェック項目
3. 予定
4. 関連リンク
5. 分類
6. SyncMeta
```

`SyncMeta` は非表示。

履歴については Phase 1 では同期対象外でよい。
必要なら将来「履歴」タブを read-only mirror として追加する。

---

# 10. 「タスク一覧」シート

推奨列。

|列|表示|用途|
|---|---|---|
|A|task_id|非表示・システム用|
|B|件名|ユーザー編集可|
|C|締切|ユーザー編集可|
|D|ステータス|ユーザー編集可|
|E|分類|ユーザー編集可|
|F|作業内容|ユーザー編集可|
|G|表示開始|ユーザー編集可|
|H|延期回数|原則 read-only|
|I|登録日|原則 read-only|
|J|更新日|原則 read-only|
|K|完了日|原則 read-only|
|L|revision|非表示|
|M|deleted_at|非表示|
|N|local_sync_version 等|非表示・必要なら使用|

A, L, M, N 等のシステム列は非表示。

ユーザーが並べ替えても同期が壊れないよう、絶対に「行番号」を task identity として使用しない。

`task_id` を基準に照合する。

---

# 11. 締切セル

Deadline Dock には以下の deadline が存在する。

- EXACT
- FUZZY_RANGE
- ASAP

Google Sheets 上ではユーザーに理解しやすい「締切」1列を基本とする。

例:

```text
2026/09/18
2026/09/18 17:00
9月中旬
9月下旬
今月中
ASAP
```

Sheets → App 同期時は、既存の Deadline Dock の deadline parser を可能な限り再利用する。

`明後日` 等の相対入力にも対応可能だが、同期時点を基準に確定されることを理解した設計にする。

不正値の場合:

- タスクを壊さない
- 同期エラーとして UI に表示
- 元の Deadline Dock 値を保持
- エラー対象セル / task_id を明示

---

# 12. ステータス

Sheets 表示:

```text
未着手
作業中
完了
```

内部:

```text
TODO
IN_PROGRESS
COMPLETED
```

Data validation のプルダウンを設定する。

---

# 13. 分類

「分類」シート推奨列:

```text
category_id
分類名
色
並び順
updated_at
deleted_at
```

category_id は非表示。

色は既存 Deadline Dock の 10 色を維持。

```text
slate
blue
cyan
green
lime
yellow
orange
red
pink
purple
```

タスク一覧の分類列にはデータ検証を設定してもよい。

未登録分類を Sheets 上で入力した場合の初期仕様:

- 原則、新規分類として自動作成
- default color = slate
- その後「分類」シートへ追加
- Deadline Dock 側にも反映

ただし名前が空の場合は未分類。

---

# 14. チェック項目

「チェック項目」シート推奨列:

```text
check_item_id   （非表示）
task_id         （非表示）
タスク件名      （表示用）
完了            （Google Sheets checkbox）
チェック項目
並び順
updated_at
deleted_at      （非表示）
```

Google Sheets checkbox TRUE / FALSE と Deadline Dock の `checked` を同期。

行順変更を identity に使用しない。

---

# 15. 予定

「予定」シート推奨列:

```text
event_id       （非表示）
task_id        （非表示）
タスク件名
予定名
開始日時
終了日時
updated_at
deleted_at
```

---

# 16. 関連リンク

「関連リンク」シート推奨列:

```text
resource_id    （非表示）
task_id        （非表示）
タスク件名
種類
表示名
パス / URL
並び順
updated_at
deleted_at
```

FILE / FOLDER / URL を維持。

ローカル Windows パスは別 PC では開けないことがあるが、同期自体はそのまま行う。

---

# 17. SyncMeta

非表示シート。

最低限:

```text
key | value
schema_version | 1
workspace_id | <UUID>
created_by | Deadline Dock
created_at | ...
```

可能であれば Google Sheets の developerMetadata も併用する。

タブ名そのものだけに依存しないこと。

ユーザーが「タスク一覧」を「仕事一覧」等へ改名しても同期が壊れない設計が望ましい。

各 sheet に developer metadata または固定 sheetId を持たせる。

---

# 18. 同期の基本方針

SQLite を master とするが、Google Sheets の編集も正式入力として受け入れる「双方向同期」。

## App → Sheets

タスク登録・変更後:

```text
SQLite commit
  ↓
同期対象として記録
  ↓
オンラインなら短時間 debounce 後 push
```

推奨 debounce:

```text
2～5秒
```

ネットがなければローカル操作は成功させる。

後で再同期する。

## Sheets → App

リアルタイム webhook は初期版では不要。

定期 polling とする。

例:

```text
60秒ごと
```

さらに以下のタイミングで即 pull:

- アプリ起動時
- ウィンドウ foreground 復帰時
- 「今すぐ同期」
- Google 連携直後

---

# 19. 同期状態テーブル

SQLite migration を追加する。

例:

```sql
CREATE TABLE google_sync_settings (
    workspace_id TEXT PRIMARY KEY,
    google_sub TEXT,
    email TEXT,
    spreadsheet_id TEXT,
    spreadsheet_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_pull_at TEXT,
    last_push_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sync_entity_state (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    last_synced_local_revision INTEGER,
    last_synced_remote_hash TEXT,
    last_synced_at TEXT,
    PRIMARY KEY(entity_type, entity_id)
);

CREATE TABLE sync_conflicts (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_json TEXT NOT NULL,
    remote_json TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution TEXT
);
```

必要に応じて `sync_outbox` を追加してもよい。

---

# 20. 差分判定

Sheets の行にはユーザーが編集したとき自動で revision が増えない。

したがって、remote revision のみを信用しない。

Sheets から読み取った同期対象フィールドを canonical JSON 化し、SHA-256 等の hash を作る。

例:

```text
remote_hash = SHA256(canonicalized_remote_fields)
```

SQLite 側:

```text
Task.revision
```

を使用。

各 entity について:

```text
local_changed =
  current_local_revision != last_synced_local_revision

remote_changed =
  current_remote_hash != last_synced_remote_hash
```

判定:

```text
local_changed=true, remote_changed=false
→ App → Sheets

local_changed=false, remote_changed=true
→ Sheets → App

local_changed=false, remote_changed=false
→ 何もしない

local_changed=true, remote_changed=true
→ CONFLICT
```

---

# 21. 競合

競合時に自動でどちらかを消さない。

例:

```text
同期競合があります

タスク: 月次報告資料

Deadline Dock
締切: 9/18

Google Sheets
締切: 9/25

[ Deadline Dock を採用 ]
[ Google Sheets を採用 ]
```

可能ならフィールド単位比較を表示。

初期版で UI コストが大きい場合は entity 単位でもよい。

競合中は該当 task を同期エラー状態として表示し、他の task の同期は継続する。

---

# 22. Sheets からの新規タスク作成

対応する。

ユーザーが「タスク一覧」へ新しい行を追加し、`task_id` が空の場合:

最低限:

```text
件名
締切
```

が有効なら Deadline Dock 側で Task を作成。

その後生成された `task_id` を Sheet の非表示列へ書き戻す。

分類、作業内容、ステータス等も同時に反映。

不正な行は無視せず「同期エラー」としてユーザーへ通知。

---

# 23. Sheets での物理行削除

初期版では、Google Sheets 上で行を削除しただけでは Deadline Dock の task を削除しない。

理由:

- accidental delete が危険
- sort / filter / copy 操作との区別が難しい
- 履歴保護を優先

推奨挙動:

既知の task_id が remote から消えた場合は、自動削除せず同期警告。

Task の削除は Deadline Dock 側を正規操作とする。

将来必要なら「削除要求」列を追加して明示的操作にする。

---

# 24. Deadline Dock 側の削除

Deadline Dock は soft delete (`deleted_at`) を使用している。

App 側で削除された場合:

- Sheets 行を即物理削除しない
- hidden `deleted_at` を更新
- 行をグレーアウトする、または別領域へ移す

初期実装で複雑なら、該当行を残したまま hidden deleted_at の同期のみでよい。

---

# 25. 履歴

Deadline Dock は変更履歴を重視している。

Sheets → App 変更時も履歴へ残す。

可能であれば actor として:

```text
Google Sheets (example@gmail.com)
```

を記録する。

現状 repository の history は `LOCAL_ACTOR_ID` 固定なので、Codex は以下のどちらかを行う。

### 推奨
mutation context / actorId を渡せるよう Repository を最小限リファクタリング。

例:

```ts
interface MutationContext {
  actorId?: string;
  source?: 'LOCAL' | 'GOOGLE_SHEETS';
}
```

### 代替
Sheets 同期専用 mutation method を追加し、同期 actor で履歴を書き込む。

既存のローカル履歴挙動を壊さないこと。

---

# 26. 既存コード構成

v0.1.8 の主要構造:

```text
src/
  App.tsx
  types.ts
  components/
    CategorySettings.tsx
    DeadlinePicker.tsx
    MiniApp.tsx
    QuickAdd.tsx
    ScheduleView.tsx
    TaskDetail.tsx
    TaskList.tsx
  lib/
    backup.ts
    browserRepository.ts
    categoryColors.ts
    datetime.ts
    deadline.ts
    platform.ts
    preferences.ts
    repository.ts
    sqliteRepository.ts

src-tauri/
  src/
    lib.rs
    main.rs
  migrations/
    0001_init.sql
    0002_query_indexes.sql
    0003_fts_search.sql
    0004_category_color.sql
    0005_check_items.sql
```

Repository 抽象:

```ts
getRepository()
```

Tauri では `SqliteRepository`、
browser preview では `BrowserRepository`。

Google sync は Tauri 実環境のみ有効でよい。

browser preview では:

```text
Google連携はデスクトップ版のみ利用できます
```

と表示。

---

# 27. 推奨の新規コード構成

例:

```text
src/
  components/
    GoogleSyncSettings.tsx
    SyncConflictDialog.tsx
    SyncStatusBadge.tsx

  lib/
    googleSync.ts
    googleSyncTypes.ts

src-tauri/
  src/
    google_auth.rs
    google_api.rs
    secure_token_store.rs
    sync_commands.rs

  migrations/
    0006_google_sync.sql
```

OAuth/token/API HTTP 通信は原則 Rust。

同期ロジックは以下の分担でもよい。

```text
Rust:
- OAuth
- secure token
- token refresh
- Google REST API call
- spreadsheet creation
- open/copy URL 用データ返却

TypeScript:
- sync orchestration
- local Repository coordination
- conflict UI
- settings UI
```

ただし refresh token を WebView へ渡さないこと。

---

# 28. Tauri commands の例

```rust
google_connect()
google_disconnect()
google_connection_status()

google_create_sync_spreadsheet()

google_sheet_get_metadata()
google_sheet_read_ranges()
google_sheet_batch_update_values()
google_sheet_batch_update_structure()

google_drive_find_deadline_dock_files()

google_sync_now()
```

API の粒度は実装しやすいよう整理してよい。

---

# 29. Spreadsheet 再発見

ローカル設定が残っている場合は `spreadsheet_id` を使用。

ファイルが削除・アクセス不可なら:

```text
連携用スプレッドシートが見つかりません。

[ 新しいスプレッドシートを作成 ]
[ Google連携を解除 ]
```

可能であれば Drive API で:

```text
appProperties has { deadlineDock=true, workspaceId=... }
```

を検索して再発見可能にする。

複数件見つかった場合は勝手に選ばず UI で選択。

---

# 30. シート初期フォーマット

自動作成後に以下を実施。

- header row bold
- freeze first row
- filter
- column widths
- system columns hide
- status data validation
- check item checkbox
- category validation
- datetime number format
- SyncMeta hide

見た目は業務用スプレッドシートとして普通に直接使えること。

---

# 31. アプリ UI

設定画面へセクション追加。

```text
Google Sheets 連携
────────────────────────

未接続の場合:
[ Google アカウントと連携 ]

接続済み:
example@gmail.com

同期: ● 正常
最終同期: 17:23

[ 今すぐ同期 ]
[ スプレッドシートを開く ]
[ URLをコピー ]

自動同期
[ ON ]

同期間隔
[ 60秒 ▼ ]

[ Google連携を解除 ]
```

メイン画面にも小さな状態表示があってよい。

```text
☁ 同期済み
```

エラー:

```text
⚠ 同期エラー
```

クリックで詳細。

---

# 32. 初回接続 UX

推奨フロー:

```text
Google アカウントと連携
 ↓
ブラウザ認証
 ↓
認証成功
 ↓
「連携用スプレッドシートを作成しています」
 ↓
Drive API files.create
 ↓
Sheets 構造初期化
 ↓
現在の Deadline Dock データを初回 push
 ↓
完了
```

完了画面:

```text
Google Sheets 連携が完了しました。

現在のタスクを同期しました。

[ スプレッドシートを開く ]
[ URLをコピー ]
[ 閉じる ]
```

---

# 33. 初回同期

既存 Deadline Dock タスクを Google Sheet へ push。

この時点で Sheets 側に既存データはないため conflict は発生しない。

タスク数が多い場合は 1 行ずつ API call しない。

必ず batch update を使う。

---

# 34. API 呼び出し量

Google Sheets API / Drive API を過剰に叩かない。

禁止:

```text
1セル変更 = 1 API request
```

推奨:

```text
変更を数秒 debounce
↓
複数変更を1 batch request
```

Pull も複数 range をまとめて取得。

---

# 35. オフライン

ネットワークエラーでローカル Task 操作を失敗させない。

例:

```text
タスク登録
→ SQLite: 成功
→ Google: timeout
```

結果:

```text
タスク登録は成功
Google同期は「保留」
```

UI:

```text
☁ 同期待ち 3件
```

ネット復帰後に再送。

---

# 36. Google API error

以下を区別。

- 401 token expired → refresh
- refresh token invalid → 再ログイン要求
- 403 permission → 連携状態エラー
- 404 spreadsheet deleted → 再作成 UI
- 429 rate limit → exponential backoff
- 5xx → retry
- network timeout → offline queue

ユーザーへ生 HTTP error をそのまま見せない。

ログには token を絶対出さない。

---

# 37. Backup

現在の JSON Backup に以下を含めてもよい。

```text
google_account_email
spreadsheet_id
spreadsheet_url
sync settings
```

ただし以下は絶対に含めない。

```text
access_token
refresh_token
client_secret 相当の認証情報
```

Backup restore 後に credential がない場合:

```text
Google連携情報はありますが、認証が必要です。
[ 再接続 ]
```

とする。

---

# 38. Google Client ID の扱い

Desktop app は public client であり、バイナリに完全な秘密を保持できない。

PKCE を利用する。

Client ID は build config / application config へ持たせてよい。

client secret を「漏れてはいけないサーバー秘密鍵」として設計しない。

必要な Google Cloud OAuth client 設定について README に明記する。

---

# 39. Google Sheets URL

URL は API が返す `webViewLink` を優先。

取得できない場合は `spreadsheet_id` から以下を構築してもよい。

```text
https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit
```

アプリの「開く」は OS の既定ブラウザを使用。

「URLをコピー」は clipboard API を使用。

---

# 40. 「共有」の意味

今回の必須要件:

> アプリが作成したスプレッドシートの URL を、連携した本人へ表示・コピー可能にする。

これは Drive permission を変更しなくてよい。

将来的なオプション:

```text
他のGoogleアカウントへ共有
```

を実装する場合は Drive API `permissions.create`。

ただし初期版で:

```text
type=anyone
role=writer
```

等を勝手に設定してはならない。

---

# 41. 実装 Phase

## Phase 1: Google 接続 + 自動シート作成

必須完成条件:

- OAuth
- secure refresh token
- Google account 表示
- Drive API で Sheet 自動作成
- spreadsheet id/url 保存
- 「開く」「URLコピー」
- disconnect
- reconnect

ここまでで一度動作確認。

## Phase 2: Task 双方向同期

- タスク一覧作成
- 初回 full push
- App → Sheets
- Sheets → App
- 新規行 → Task 作成
- task_id hidden
- polling
- offline
- basic sync status

## Phase 3: 関連データ

- Categories
- CheckItems
- ScheduleEvents
- Resources

## Phase 4: Conflict / robustness

- conflict UI
- missing/deleted Sheet
- sheet rename
- recovery
- batching
- backoff
- detailed sync state

---

# 42. Phase 1 Acceptance Criteria

すべて満たすこと。

1. Deadline Dock から Google 接続ボタンを押せる。
2. ブラウザで Google 認証が開始する。
3. 認証完了後アプリへ戻れる。
4. linked email が表示される。
5. ユーザー My Drive に Spreadsheet が自動作成される。
6. アプリに URL が表示される。
7. 「開く」でブラウザから開ける。
8. 「URLコピー」が動作する。
9. アプリ再起動後も連携が維持される。
10. refresh token が SQLite / backup / log に平文で存在しない。
11. Google 連携解除が可能。
12. Deadline Dock の既存ローカル機能を壊さない。

---

# 43. Phase 2 Acceptance Criteria

1. 既存 Task が初回 push される。
2. アプリで Task 新規作成 → Sheet に出る。
3. アプリで件名変更 → Sheet に出る。
4. アプリで締切変更 → Sheet に出る。
5. アプリで完了 → Sheet に出る。
6. Sheet で件名変更 → App に出る。
7. Sheet で締切変更 → App に出る。
8. Sheet で status 変更 → App に出る。
9. Sheet 新規行 → App に Task ができる。
10. Sheet row sort 後も task mapping が壊れない。
11. offline 時も Task 操作可能。
12. 復帰後同期する。
13. 同時変更 conflict を silent overwrite しない。
14. Sheet 起因変更が History に残る。

---

# 44. 既存 Deadline Dock で壊してはいけない機能

- タスク件名 + deadline の高速登録
- 独立 Task Composer window
- 詳細入力
- 曖昧締切
- ASAP
- Deadline history / 延期回数
- TODO / IN_PROGRESS / COMPLETED
- 分類 + 10 色
- 作業内容
- チェック項目
- 予定
- Resource
- 完了済み検索
- 複写
- Mini window
- Quick Add shortcut
- tray
- Always on Top
- SQLite
- backup / restore
- no-console release build

---

# 45. Windows / Packaging 重要ルール

このプロジェクトでは過去に Windows 配布 ZIP の文字コード問題が発生した。

必ず `docs/DEVELOPMENT_RULES.md` を確認。

特に:

## ZIP filename

日本語 filename を避けることが解決策ではない。

ZIP 内 filename は UTF-8 flag (`0x800`) が付いていることを生成後に検証する。

## PowerShell

Windows PowerShell 5.1 で日本語を含む `.ps1` は UTF-8 BOM 必須。

BOMなし UTF-8 の日本語 PowerShell script を配布しない。

## ZIP layout

更新 patch は無意味な二重 folder にしない。

展開後:

```text
deadline-dock-vX.Y.Z-update\
  更新を適用.cmd
  apply-update.ps1
  ...
```

となること。

## Release

通常ユーザーが起動する Deadline Dock では console window を出さない。

開発用 CMD と release exe を分離。

---

# 46. テスト

既存:

```text
scripts/validate.py
npm run check
npm run build
cargo check
```

を必ず通す。

Google sync 追加後は mock API を作り、最低限以下を automated test。

- local → remote diff
- remote → local diff
- no change
- conflict
- malformed deadline
- new Sheet row
- reordered rows
- duplicate task_id
- offline/retry
- token refresh failure
- missing spreadsheet
- deleted spreadsheet

実 Google API を使う integration test は別扱い。

---

# 47. セキュリティ

必須:

- minimum scope
- drive.file
- PKCE
- state parameter verification
- loopback listener は認証中のみ
- callback 後 listener 終了
- refresh token secure storage
- token log 禁止
- external URL validation
- API error sanitation
- user consent

CSRF 防止のため OAuth `state` を必ず検証。

---

# 48. 無料運用要件

初期設計では以下を使用しない。

- 有料バックエンド
- Firebase 必須化
- Supabase 必須化
- Cloud Run 必須化
- Google Apps Script 必須化
- 定期課金サービス

Desktop app から Google APIs へ直接接続する。

Google API quota を浪費しないよう batch / polling を適切に設計。

---

# 49. Codex に最初にやってほしいこと

実装前に以下を実施。

1. `README.md`
2. `docs/AI_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DEVELOPMENT_RULES.md`
5. `src/types.ts`
6. `src/lib/repository.ts`
7. `src/lib/sqliteRepository.ts`
8. `src-tauri/src/lib.rs`
9. `src-tauri/Cargo.toml`
10. migrations

を読む。

その上で Phase 1 の実装計画を短く提示してから作業開始。

既存コードを全面 rewrite しない。

Repository / SQLite / Task Composer の既存挙動を維持しながら増設する。

---

# 50. Codex への作業指示文

以下をそのまま作業指示として使用可。

> Deadline Dock v0.1.8 に Google Sheets 双方向同期を追加してください。
> この `DeadlineDock_GoogleSheets_Sync_Handoff.md` を最上位仕様として扱い、まず Phase 1「Google OAuth 接続・Google Drive 上への同期用 Spreadsheet 自動作成・URL表示/コピー/オープン」まで実装してください。
>
> Google scope は原則 `drive.file` + OIDC basic scopes とし、広い Drive/Sheets scope は使用しないでください。
> OAuth は Desktop app の Authorization Code + PKCE + loopback callback を使用し、refresh token を SQLite / localStorage / JSON backup / log に平文保存しないでください。
>
> Google API 通信および token 管理は Rust/Tauri 側を優先してください。
> Spreadsheet はアプリ側で自動作成し、ユーザー自身が owner になる構成にしてください。
> 作成後は spreadsheet URL を設定画面に表示し、「開く」「URLコピー」を提供してください。
>
> Phase 1 の完了後に既存機能の regression check を行い、`scripts/validate.py`, `npm run check`, `npm run build`, `cargo check` を通してください。
> 既存 Deadline Dock のローカルタスク管理機能を壊さないでください。
>
> Windows 配布ルールとして、日本語 ZIP filename の UTF-8 flag 検証、日本語を含む PowerShell `.ps1` の UTF-8 BOM、二重 folder 禁止、release 版 console 非表示を必ず維持してください。
>
> Phase 1 の実装・検証結果を報告後、Phase 2 の Task 双方向同期へ進んでください。

---

# 51. 参考 Google 公式ドキュメント

Google Sheets API scopes:
https://developers.google.com/workspace/sheets/api/scopes

Google Drive API scopes:
https://developers.google.com/workspace/drive/api/guides/api-specific-auth

Create and manage spreadsheets:
https://developers.google.com/workspace/sheets/api/guides/create

Create and manage Drive files:
https://developers.google.com/workspace/drive/api/guides/create-file

Drive sharing / permissions:
https://developers.google.com/workspace/drive/api/guides/manage-sharing

OAuth consent configuration:
https://developers.google.com/workspace/guides/configure-oauth-consent

Google Workspace authentication overview:
https://developers.google.com/workspace/guides/auth-overview

---

# 52. 最重要事項まとめ

- 実現可能。
- Spreadsheet はアプリが自動作成する。
- URL もアプリがユーザーへ表示・コピー・オープン可能。
- ユーザー自身が owner。
- 最小 scope は `drive.file` を優先。
- Service Account は使わない。
- SQLite が本体。
- Sheets は双方向同期先。
- token は Windows の secure storage。
- 競合を silent overwrite しない。
- 行番号を identity にしない。
- task_id 等の UUID を hidden column に持つ。
- Google Sheet は人間が直接使いやすい UI にする。
- 有料バックエンドなし。
- まず Phase 1、その後 Phase 2 以降。
