# Deadline Dock 開発・配布ルール

## ZIP の日本語ファイル名

日本語ファイル名を避けて問題を回避してはならない。配布 ZIP は UTF-8 のファイル名として正しく格納する。

- ZIP 作成は `scripts/package_release.py`（Python `zipfile`）を使用する。
- 非 ASCII ファイル名の ZIP general purpose bit flag 11 (`0x800`) が有効であることを作成後に自動検証する。
- ZIP 内のファイル名が元ファイル名と完全一致することを自動検証する。
- 文字化けした名前を ZIP 内に格納した状態で配布しない。
- Windows 標準の「すべて展開」を第一の互換対象とする。

過去の配布では、元フォルダ上の日本語名は正常だったが、ZIP 作成時に CP437 相当へ誤変換された文字列が ZIP 内の実ファイル名として保存され、UTF-8 flag も付いていなかった。これを再発させない。

## タスク登録 UI

デスクトップ版では、メイン画面・ミニ画面・グローバルショートカット・複写の全経路から同一の独立タスク登録ウィンドウを開く。

- メイン/ミニのウィンドウ内に登録フォームを押し込まない。
- 登録ウィンドウのヘッダーと「タスクを登録」ボタンは常に到達可能にする。
- 内容部分だけをスクロールさせる。
- 候補/詳細の開閉に応じてウィンドウサイズを調整するが、小さい画面では画面内に収める。
- 複写は元データを登録フォームの初期値として渡し、登録確定前は DB に新規タスクを作らない。

## カテゴリ色

カテゴリ色は締切危険度より弱い補助情報とするが、識別できないほど薄くしない。タスク一覧・詳細・ミニ画面で同じ色体系を使う。

## Windows archive / script encoding

- Japanese filenames are allowed and should be preserved.
- Release/update ZIPs must store non-ASCII filenames with ZIP UTF-8 flag bit 11 (`0x800`).
- Any `.ps1` containing non-ASCII text must be encoded as UTF-8 with BOM for Windows PowerShell 5.1 compatibility.
- Packaging must validate both filename flags and PowerShell BOMs before distribution.
- Update ZIPs should not add a duplicate top-level folder when the expected user flow is Windows `Extract All`; archive contents should begin at the update package root.

## Windows branding

- Keep `local.deadlinedock.app` stable: it identifies both local data and Windows shortcut grouping.
- Reuse the opaque logo in `assets/branding/`; export native icon sizes with the Tauri CLI.
- Set the native icon on every configured window, including initially hidden mini/composer windows.
- The installer supplies `deadline-dock-brand.ico` and refreshes only shortcuts whose target is this installation. Preserve the AppUserModelID when recreating them.
- Do not delete the global Windows icon cache or restart Explorer to repair this app's branding.
