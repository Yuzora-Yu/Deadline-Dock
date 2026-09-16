## v0.1.14 — 2026-09-16

- 昨日作成した不透明ロゴをWindowsの実行ファイル・インストーラー・トレイ・画面内、PWAのホーム画面アイコンに統一。
- Windowsの一覧と詳細をカード化し、余白・文字・選択状態・ミニ画面を整理。最低幅880pxでも操作領域を維持。
- ブラウザ版に詳細入力での新規登録を追加。件名・締切・分類・状態・表示開始・作業内容・チェック項目を登録前に入力できる。件名だけのクイック登録も維持。
- 未保存入力の破棄確認、ダイアログ内のキーボード移動、入力中のチェック項目を保存に含める処理を追加。
- PWAの192/512px PNG、Apple用アイコン、インストールボタン、iPhone/Androidの追加案内、新規登録ショートカットを追加。
- ブラウザ同期の二重開始、ロック待機中の接続先変更、Windowsの古い詳細読込結果の上書きを防止。
- オフラインキャッシュの世代を全配信ファイルから計算。アイコンだけの更新も反映し、編集中の強制再読込は行わない。

# v0.1.13 — 2026-09-15

- スマホ向けブラウザ版を同じリポジトリに追加。未連携時はIndexedDB保存、Google SheetsでWindows版とタスク・分類・チェック項目を共有。
- 設定に更新確認・ダウンロード・インストーラー起動を追加。取得サイズとSHA-256を検証。
- Windowsインストーラーを日本語表示に変更。
- Tool05紹介ページからWindows版とブラウザ版の両方へ移動。

# v0.1.12 — 2026-09-15

- アプリでタスクを削除すると、Google Sheetsのタスク行と関連するチェック項目・予定・リンク行も削除。既存の削除済み行も次回同期で整理。
- 削除・取消は自動同期を即時開始。非表示の最小限の削除記録で、別PCからの意図しない復活を防止。
- PC内のチェック項目・予定・リンクも連動して削除。取消では、親タスクと一緒に削除した内容だけを復元。
- 同期時に不足タブを自動追加。再作成を識別し、該当データの同期基準をリセットしてPC内データから再送。
- 設定に「レイアウトを整える」を追加。見出し、列幅、固定行・列、入力候補、説明メモを整備。件名を左端に置き、管理用の列を非表示化。
- 見出し・列順が変更された場合は、入力済みデータを上書きせず修正箇所を案内。
- 全同期の書き込みに共通ガードを追加。同時同期で古い行番号を使う書き込みを拒否し、最新状態から再試行。保護用の記録は2件に固定。
- 模擬テストに加え、Google上の隔離した検証用シートで初期作成・修復・削除・再同期・不足タブ再作成を確認。

# v0.1.11 — 2026-09-15

- Google連携を本番公開。分類・チェック項目の双方向同期、締切空欄の新規行の「急ぎではない」取り込み、初回合算確認を実装。
- 紹介・ダウンロードページとプライバシーポリシーを公開し、不透明背景のロゴへ更新。

# v0.1.10 — 2026-09-15

- 配布ビルド共通のDesktop OAuth設定をサポート。「Googleと連携」から既存のシート自動作成・同期開始へ進む導線に変更し、手動入力は開発者向け設定へ移動。共通クライアントの発行・組み込みと実接続検証は未完了。
- 別PCでの画面確認で見つかった、分類の色選択ごとにGoogle連携設定が重複表示される不具合を修正。設定画面の送信に関する説明を任意のGoogle連携に合わせて更新。
- Google Sheetsタスク双方向同期、UUID照合、競合比較と採用、Google由来の変更履歴を追加。
- 自動同期、通信エラー再試行、既存シート選択、新規シートによる復旧を追加。
- 同期書き込み前の記録とSQLiteのrevision照合、復元時の同期停止を追加。
- 実Google認証・実機間の同期は確認待ち。関連データ同期は次段階。
- 別PC向けの引き継ぎ書とGitへの機密・実データ除外を整備。

# Changelog

## v0.1.8-dev

- Windows Release版をGUI subsystemでビルドし、通常起動時のコンソール画面を非表示化
- `02_DeadlineDockを起動.cmd` を開発確認用として明確化
- Windows build完了時に、日常利用はNSISインストール版またはRelease EXEを直接起動するよう案内

# CHANGELOG

## v0.1.7-dev

- 独立タスク登録ウィンドウのアプリ内「×」を廃止し、Windows標準タイトルバーの閉じるボタンへ一本化。
- タスク内チェック項目を追加。新規登録時・既存タスク詳細の両方で作成可能。
- チェック項目は✓オン/オフ、文言編集、上下並べ替え、削除に対応。
- 複写時はチェック項目の文言・並びを複写し、完了状態は未完了へリセット。
- チェック項目の追加・変更・完了状態・削除・並べ替えを変更履歴へ記録。
- 検索対象へチェック項目を追加し、FTS5 trigram indexもチェック項目変更に追従。
- Backup / Restoreへチェック項目を追加。旧バックアップ（checkItemsなし）も引き続き復元可能。
- SQLite migration `0005_check_items.sql` を追加。

## v0.1.6-dev

- タスク登録を独立した専用ウィンドウへ統一。メイン・ミニ・グローバルショートカット・複写から同じ入力UIを使用。
- 入力ウィンドウ内は本文のみスクロールし、「タスクを登録」ボタンを常時到達可能に変更。
- 候補/詳細入力の開閉に応じたウィンドウサイズ調整を継続し、小型画面では作業領域内へ制限。
- メイン画面に「ミニ」ボタンを追加。
- ミニ画面のタスクをクリックするとメイン画面を表示し、そのタスク詳細を開く。
- 分類色を一段濃くし、一覧・詳細・ミニ画面で視認しやすく調整。
- タスク作成後にメイン/ミニへ更新イベントを送信。
- ZIP配布処理をUTF-8ファイル名検証付きPython `zipfile` へ変更し、日本語ファイル名の文字化けを根本修正。

# Changelog

## 0.1.5-dev - 2026-09-14

- クイック登録を「件名＋日付」のシンプル入力を基本に再設計
- クイック登録の候補／詳細表示時にQuick Addウィンドウを自動リサイズし、スクロールでも操作可能に変更
- Tauri CapabilityへQuick Addの `set-size` / `center` 権限を追加し、実機での自動リサイズを有効化
- 登録前の詳細入力（分類、作業内容、表示開始、予定複数、フォルダ／ファイル／URL複数）を追加
- 「候補から選ぶ」を、今日／明日／明後日／月末／ASAP、週・月、上旬・中旬・下旬にグループ化
- 文字入力期限に「明後日」を追加
- 登録ボタン文言を「タスクを登録」に統一
- 複写時に即時作成せず、通常の新規登録UIへ内容を事前入力してから編集・登録する方式へ変更
- 分類に10色の色設定を追加し、タスク一覧・完了済み一覧・詳細・ミニ画面へ薄く反映
- SQLite migration `0004_category_color.sql` を追加

## 0.1.4-dev

- Windows実機のRustチェックで判明した `serde_json` 依存漏れを修正
- `serde` / `serde_json` をCargo依存に追加
- Tauri Tray APIのdeprecated呼び出しを現行APIへ更新
- 初回セットアップ失敗時にログを自動でメモ帳表示
- セットアップ失敗時のコンソールを閉じず、コピーしやすい動作へ変更
- 不要な「まずPC再起動」案内を削除
- validatorへ `serde_json` 依存チェックを追加

## 0.1.3-dev

- Windows向けワンクリック補助スクリプトを追加
  - `01_初回セットアップ.cmd`
  - `02_DeadlineDockを起動.cmd`
  - `03_Windows版をビルド.cmd`
  - `04_ブラウザだけで確認.cmd`
  - `05_診断情報を作成.cmd`
- Node.js / Rust MSVC / C++ Build Tools / WebView2 の自動確認とwingetセットアップを追加
- TypeScript / Frontend / Rustの初回検証をセットアップへ統合
- Windowsビルド成功時に `windows-build` へ直接実行EXEとNSIS installerを収集
- Windows診断情報ファイル生成機能を追加
- 登録済みFILE/FOLDERのopenをFrontend opener scope依存からRust側 `open_local_path` commandへ変更
  - C: / D: / UNC等のユーザー登録パスを後日開く用途に対応
- Windows Quick Startドキュメント追加
- Versionを0.1.3へ更新

## 0.1.2-dev

- クイック登録ショートカットを設定画面から変更 / 無効化可能に変更
  - Ctrl + Shift + Space
  - Ctrl + Alt + Space
  - Ctrl + Shift + N
  - Alt + Shift + Space
  - 無効
- Global Shortcut登録をRust固定値からFrontend動的登録へ変更
- Tauri CapabilityへGlobal Shortcut register / unregister権限を明示追加
- SQLite FTS5 trigram全文検索 migration v3追加
  - Task title / description
  - Category
  - Resource label / path / URL
  - 3文字以上はFTS、2文字以下はLIKEへフォールバック
  - FTSはTask IDを先に絞る非相関queryへ最適化
- Task / Category / Resource変更時にFTS indexを同期するtrigger追加
- 大量一覧を160件単位で段階描画
- `content-visibility` による画面外Task Row描画抑制
- ミニウィンドウのTaskクリックでメインウィンドウの該当Taskを直接表示
- ミニウィンドウをフォーカス時＋10秒間隔で再読込
- `scripts/validate.py` を追加し、migration / FTS / capability / network scan等を自動検証
- Versionを0.1.2へ更新

## 0.1.1-dev

- Backup ValidatorでDefault Workspace / Local Actorの存在も検証し、復元後の書き込み参照切れを防止
- Browser previewのバックアップでもWorkspace / Actorを保持するよう整合性を改善
- 完了済み一覧は現在の緊急度ではなく、元締切・完了日・分類・延期回数を表示

- 詳細フィルター追加
  - Status
  - Deadline Type
  - Created Date Range
  - Completed Date Range
- 完了直後Undo
- 削除直後Undo / Task Restore History
- JSON Backup / Restore
- Tauri FS Plugin導入
- main / miniのWindow State自動保存・復元
- Quick AddをWindow State保存対象外に設定
- SQLite query index migration追加
- UI layout / responsive調整
- Quick Add deadline text parser / Enter操作 / Escキャンセル
- Quick Addでも任意月の上旬・中旬・下旬を候補選択可能
- Versionを0.1.1へ更新

## 0.1.0-dev

- 初回実装
- Task CRUD
- Deadline / Fuzzy Deadline / ASAP
- Deadline History / Postponement Count
- Category / Schedule Event / Resource
- Archive / Search / Filter / Sort / Duplicate
- Mini Window / Always on Top / Tray / Global Shortcut
- SQLite Local Storage

## 2026-09-15 Google同期修正

- 分類・チェック項目の双方向同期、関連データの競合確認を追加。
- Google Sheetsの未入力チェックボックス（FALSE）を空行として扱い、1000行の空欄を新規項目と誤認しないよう修正。
- 旧処理が1001行目以降へ送信したチェック項目は、IDと前回同期内容が一致し、先頭999行以上が空欄の場合だけ上部へ移動。変更済み・未知・重複IDの行は移動しない。
- 作業内容は入力欄を離れると保存。同期中の追加変更を再実行し、画面更新時は未保存の入力を保持。

- 件名のみのシート行に「急ぎではない」を補い、スマホからの一括登録に対応。初回同期の合算確認ダイアログとRust側の承認ゲート、同名分類の対応づけを追加。2台の独立状態で合算・競合・新規行ID共有をテスト。
