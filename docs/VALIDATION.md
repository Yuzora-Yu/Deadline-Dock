# Validation Record

Snapshot: **v0.1.7-dev**

## Automated local validation

```text
python3 scripts/validate.py
```

Result at snapshot creation:

```text
54 checks passed; 0 failed.
```

検証対象：

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- Version consistency
- Global Shortcut permissions
- Quick Add window resize / center permissions
- SQLite migrations v1 / v2 / v3 / v4 / v5
- FTS5 trigram Japanese title search
- FTS Resource path search
- FTS Category search
- FTS Checklist text search / edit trigger
- Soft-deleted Resource removal from FTS
- Rust migration registration
- Application source network primitive scan
- Quick Add dynamic shortcut architecture
- FTS Task-ID-first query structure
- Windows helper script presence
- Rust `open_local_path` command registration
- Frontend FILE/FOLDER opener command routing
- Dedicated Task Composer architecture / native close button一本化
- Checklist Repository / UI / SQLite schema
- UTF-8 ZIP packaging helper / developer rule

## Windows integration validation

Windows実機では以下の順に実施する。

```text
01_初回セットアップ.cmd
02_DeadlineDockを起動.cmd
```

初回セットアップは以下を検証する。

- Supported Node.js
- npm
- Rust stable-msvc
- cargo
- Visual Studio C++ Build Tools
- WebView2
- npm install
- npm run check
- npm run build
- cargo check

## Windows実機確認状況

v0.1.6まではユーザー環境でTauri開発モード起動と主要操作を確認済み。v0.1.7は更新パッチ適用時に `npm run check` / `npm run build` / `cargo check` を再実行して検証する。

このスナップショット生成環境単体ではWindows binaryを生成できないため、Windows側で問題が出た場合は：

```text
05_診断情報を作成.cmd
```

を実行し、`deadline-dock-diagnostics.txt` を確認する。
