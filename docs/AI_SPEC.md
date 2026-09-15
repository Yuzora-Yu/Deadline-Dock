# Deadline Dock — AI実装基準仕様 v0.1

> 2026-09-14追記: 以下はv0.1の既存仕様です。今回追加する任意のGoogle連携については `DeadlineDock_GoogleSheets_Sync_Handoff.md` と `GOOGLE_SHEETS_SETUP.md` を参照してください。ローカル機能は引き続きオフラインで利用できます。

この文書は本リポジトリを編集するAI/開発者向けの基準仕様である。仕様判断に迷った場合は「タスク管理のための入力・判断をユーザーに増やさない」ことを優先する。

## 1. プロダクトの目的

Deadline Dockは一般的な多機能Todoアプリではない。

> 件名と締切だけで即登録でき、締切・作業履歴・過去の作業場所を自然に蓄積する、ローカル常駐型の仕事台帳。

重要度や工数をユーザーに細かく入力させるのではなく、締切・変更履歴・実際の状態からアプリ側が「今気にすべき仕事」を整理する。

## 2. 最重要原則

1. 最小登録は「件名 + 締切」。
2. 締切を最も重要な情報として扱う。
3. 登録日・更新日・開始日・完了日・履歴は自動記録する。
4. 曖昧期限を正式なデータとして扱う。
5. 完了タスクは削除せず検索可能な仕事履歴として保持する。
6. 過去のファイル・フォルダ・URLをすぐ再利用できること。
7. 外部API、クラウド、アカウントをv0.1に導入しない。
8. 将来同期を妨げないID/Revision/Workspace/Actor構造を維持する。

## 3. v0.1 非目標

- AI API
- 外部Web API
- オンライン同期
- 複数ユーザー共有
- ガントチャート
- 重要度の手入力
- 工数見積もり必須化
- 本格的なカレンダー連携
- Web/モバイル版

## 4. Task

必須:

- title
- deadline

任意:

- description
- category
- resources
- schedule events
- snooze_until

自動:

- id (UUID)
- workspace_id
- created_at
- updated_at
- started_at
- completed_at
- status
- revision
- postponement_count
- duplicated_from_task_id
- deleted_at

Status:

- TODO（未着手）
- IN_PROGRESS（作業中）
- COMPLETED（完了）

## 5. Deadline

種類:

- EXACT
- FUZZY_RANGE
- ASAP

対応入力:

- 今日 / 明日
- 任意日付
- 任意日時
- 今週中 / 来週中
- 今月中 / 来月中
- 任意月の上旬 / 中旬 / 下旬
- できるだけ早く（ASAP）

上旬 = 1〜10日
中旬 = 11〜20日
下旬 = 21〜月末

曖昧期限は `deadline_label` を保持し、内部範囲へ変換してもUIでは原則として人間が指定したラベルを表示する。

締切変更時は以前の値を削除せずHistoryへ記録し、後ろ倒しなら `postponement_count` を増加させる。

## 6. 緊急度

基本順:

1. 期限超過
2. 今日
3. ASAP
4. 現在が曖昧期限範囲内
5. 3日以内
6. 7日以内
7. それ以降
8. Snooze中

ユーザーにHigh/Medium/Low等を入力させない。

## 7. Schedule Event

DeadlineとSchedule Eventを同一フィールドで管理しない。

1 Taskに0件以上。

最低項目:

- id
- task_id
- title
- starts_at
- ends_at (optional)
- created_at
- updated_at
- deleted_at

## 8. Resource

種類:

- FILE
- FOLDER
- URL

1 Taskに複数登録可能。

Resourceは実体をDBへコピーせずパス/URLを保存する。
クリック時はOS既定アプリで開く。

## 9. Category

ユーザー定義。
設定画面から追加・名称変更・削除・並び替えが可能。
v0.1は1 Task = 0〜1 Category。


## 9.1 Task Check Item

作業内容の自由記述とは別に、Task配下へ細かな作業手順をチェック項目として0件以上登録できる。

最低項目:

- id
- task_id
- text
- checked
- sort_order
- created_at / updated_at / deleted_at

UIでは作成、文言編集、✓オン/オフ、上下並べ替え、削除が可能。
新規Task登録時にも入力できること。

## 10. History

重要変更は自動追記する。

最低対象:

- Task作成
- 件名
- 作業内容
- Category
- Deadline
- Status
- Snooze
- Event add/update/delete
- Resource add/update/delete
- Check Item add/update/toggle/reorder/delete
- Duplicate
- Delete

ユーザーはHistoryを編集しない。

## 11. Archive / Search / Duplicate

完了タスクは通常一覧から外してよいが、Archiveから検索・閲覧できること。

検索対象:

- Task title
- description
- Category name
- Resource label
- file/folder path
- URL
- Check Item text

過去Taskから新規作成する場合、デフォルトで以下をコピーする:

- title
- description
- category
- resources
- check item text/order（checked状態はfalseへ戻す）

コピーしない:

- status
- history
- created/started/completed timestamps

新しいDeadlineは複写時に指定する。Schedule Eventは任意コピー。

## 12. UI

Main:

- 左ペイン: Task一覧
- 右ペイン: Task詳細

一覧では情報過多にしない。
基本表示は件名、締切/緊急度、直近予定、延期回数、分類程度。

Mini:

- 幅300〜400px目安
- 重要Taskを少数表示
- Always on Topを切替可能

Quick Add:

- Global Shortcut `Ctrl+Shift+Space`
- title + deadlineを中心とする

Tray:

- Task追加
- Main表示
- Mini表示
- Exit

## 13. Local First / Free

通常利用でネット接続不要。

禁止:

- 外部APIへのTask送信
- 必須Telemetry
- 広告SDK
- アカウント登録要求
- 有料SaaS依存

## 14. 将来共有

v0.1では実装しない。

将来用に以下を維持する:

- UUID
- workspace_id
- actor_id
- revision
- updated_at
- deleted_at

SQLiteファイルそのものをクラウド共有フォルダ等へ置き、複数PCから同時編集する方式を同期機能として採用しない。
将来はローカルDBを各端末が保持し、変更を明示的に同期する構造を採る。

## 15. 実装判断ルール

仕様にない機能を足す前に、以下を確認する。

- 登録速度を落とさないか
- 日常操作を増やさないか
- ユーザーに主観的な判断を強制しないか
- Deadline中心という思想を弱めないか

機能追加より操作削減を優先する。
