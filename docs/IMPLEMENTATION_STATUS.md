# Implementation Status

Snapshot: **v0.1.7-dev**

## 実装済み

- Task CRUD / Soft Delete / Restore
- 締切（日付・日時・相対・上旬/中旬/下旬・ASAP）
- 緊急度順
- 締切変更履歴 / 延期回数
- 未着手 / 作業中 / 完了
- Category管理（10色の色設定・一覧カード/詳細/ミニ画面へ識別しやすい濃さで反映）
- Task Check Items（作成・編集・✓オン/オフ・上下並べ替え・削除・履歴・検索・複写）
- Schedule Event複数登録
- File / Folder / URL Resource
- File / Folder picker
- C: / D: / UNCを含む登録済みローカルパスのOS既定アプリ起動（Rust command経由）
- History表示
- Archive / Search / Filter / Sort
- SQLite FTS5 trigram検索 + LIKE fallback
- Task Duplicate（即時作成せず、通常の登録フォームへ初期値を複写して編集後に登録）
- Snooze
- 独立Task Composer（日付を基本に、候補／文字入力／詳細入力へ展開。メイン/ミニ/ショートカット/複写から同一ウィンドウを利用。本文のみスクロールし登録ボタンを常時表示）
- Global Shortcut設定
- Mini Window / Always on Top / Tray
- Window State保存
- JSON Backup / Restore
- Undo
- 大量一覧段階描画
- Windows初回セットアップ補助
- Windows起動 / Build / Diagnostics補助スクリプト

## Windows向け実行導線

解凍先想定：

```text
C:\Users\ship2\Documents\06-Yu-zora\deadline-dock
```

1. `01_初回セットアップ.cmd`
2. `02_DeadlineDockを起動.cmd`
3. 動作確認後 `03_Windows版をビルド.cmd`

問題時は `05_診断情報を作成.cmd`。

## 自動検証済み

`scripts/validate.py` で以下を確認。

- JSON設定整合性
- package / Tauri / Cargo version整合性
- Global Shortcut capability
- SQLite migration v1-v5
- FTS5 trigram smoke test
- FTS trigger
- 外部通信primitive不在
- 独立Task Composer（日付を基本に、候補／文字入力／詳細入力へ展開。メイン/ミニ/ショートカット/複写から同一ウィンドウを利用。本文のみスクロールし登録ボタンを常時表示） shortcut architecture
- FTS query structure
- Windows helper files
- Rust local path opener command登録

## Windows実機で確認済み

- Node.js / npm / Rust MSVC / C++ Build Tools / WebView2 のセットアップ
- 実npm dependenciesによるTypeScript check / Frontend build
- Rust/Tauri compile
- Tauri開発モード起動
- Trayからの終了を含む基本操作

## まだ未確認

- v0.1.7変更後のWindows実機再チェック
- NSIS installer生成
- 長時間常駐時の安定性


## 現在の優先確認項目

1. v0.1.7の独立登録ウィンドウ（タイトルバー×のみ）
2. チェック項目の作成・✓オン/オフ・並べ替え・複写
3. ミニ画面→メイン詳細遷移
4. 分類色の濃さ
3. 複写 → 編集 → 登録フロー
4. 分類色の表示濃度
5. 既存SQLite DBへのmigration v5適用
6. Backup / Restore
7. UI密度と常駐サイズ調整
