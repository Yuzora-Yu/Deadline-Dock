#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "src-tauri" / "migrations"

failures: list[str] = []
checks: list[str] = []


def ok(message: str) -> None:
    checks.append(message)
    print(f"[OK] {message}")


def fail(message: str) -> None:
    failures.append(message)
    print(f"[FAIL] {message}")


def require(condition: bool, message: str) -> None:
    if condition:
        ok(message)
    else:
        fail(message)


def load_json(path: Path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        ok(f"JSON parse: {path.relative_to(ROOT)}")
        return value
    except Exception as exc:
        fail(f"JSON parse: {path.relative_to(ROOT)} ({exc})")
        return None


package = load_json(ROOT / "package.json")
tauri_conf = load_json(ROOT / "src-tauri" / "tauri.conf.json")
capabilities = load_json(ROOT / "src-tauri" / "capabilities" / "default.json")

if package and tauri_conf:
    require(package.get("version") == tauri_conf.get("version"), "package.json and tauri.conf.json versions match")

cargo_text = (ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
if package:
    cargo_match = re.search(r'^version\s*=\s*"([^"]+)"', cargo_text, flags=re.MULTILINE)
    require(bool(cargo_match and cargo_match.group(1) == package.get("version")), "Cargo.toml version matches package.json")
require(bool(re.search(r'^serde_json\s*=\s*"1"', cargo_text, flags=re.MULTILINE)), "Cargo.toml includes serde_json required by Tauri context generation")

if capabilities:
    perms = capabilities.get("permissions", [])
    for perm in (
        "global-shortcut:allow-is-registered",
        "global-shortcut:allow-register",
        "global-shortcut:allow-unregister",
        "core:window:allow-set-size",
        "core:window:allow-center",
    ):
        require(perm in perms, f"Capability includes {perm}")

conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys=ON")
for migration in sorted(MIGRATIONS.glob("*.sql")):
    try:
        conn.executescript(migration.read_text(encoding="utf-8"))
        ok(f"SQLite migration: {migration.name}")
    except Exception as exc:
        fail(f"SQLite migration: {migration.name} ({exc})")
        break

# Search index smoke tests.
try:
    workspace = "00000000-0000-4000-8000-000000000001"
    conn.execute(
        "INSERT INTO categories(id,workspace_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        ("cat-validation", workspace, "経理部門", 0, "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z"),
    )
    conn.execute(
        """INSERT INTO tasks(
          id,workspace_id,title,description,category_id,status,deadline_type,deadline_label,
          created_at,updated_at,revision,postponement_count
        ) VALUES(?,?,?,?,?,'TODO','ASAP','できるだけ早く',?,?,1,0)""",
        (
            "task-validation",
            workspace,
            "決算資料をまとめる",
            "月次報告の下準備",
            "cat-validation",
            "2026-09-14T00:00:00Z",
            "2026-09-14T00:00:00Z",
        ),
    )
    conn.execute(
        """INSERT INTO resources(id,task_id,type,label,value,sort_order,created_at,updated_at)
        VALUES(?,?,?,?,?,0,?,?)""",
        (
            "res-validation",
            "task-validation",
            "FOLDER",
            "作業フォルダ",
            "C:/Accounting/2026/MonthlyReport",
            "2026-09-14T00:00:00Z",
            "2026-09-14T00:00:00Z",
        ),
    )
    fts_title = conn.execute(
        "SELECT task_id FROM task_search WHERE task_search MATCH ?",
        ('"決算資料"',),
    ).fetchall()
    require(fts_title == [("task-validation",)], "FTS trigram finds Japanese title substring")
    fts_resource = conn.execute(
        "SELECT task_id FROM task_search WHERE task_search MATCH ?",
        ('"Accounting"',),
    ).fetchall()
    require(fts_resource == [("task-validation",)], "FTS trigram finds resource path substring")
    fts_category = conn.execute(
        "SELECT task_id FROM task_search WHERE task_search MATCH ?",
        ('"経理部門"',),
    ).fetchall()
    require(fts_category == [("task-validation",)], "FTS trigram finds category substring")
    conn.execute(
        """INSERT INTO task_check_items(id,task_id,text,checked,sort_order,created_at,updated_at)
        VALUES(?,?,?,0,0,?,?)""",
        ("check-validation", "task-validation", "請求書番号を確認する", "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z"),
    )
    fts_check = conn.execute(
        "SELECT task_id FROM task_search WHERE task_search MATCH ?",
        ('"請求書番号"',),
    ).fetchall()
    require(fts_check == [("task-validation",)], "FTS trigram finds checklist text")
    conn.execute("UPDATE task_check_items SET text='伝票番号を確認する' WHERE id='check-validation'")
    old_check = conn.execute("SELECT task_id FROM task_search WHERE task_search MATCH ?", ('"請求書番号"',)).fetchall()
    new_check = conn.execute("SELECT task_id FROM task_search WHERE task_search MATCH ?", ('"伝票番号"',)).fetchall()
    require(old_check == [] and new_check == [("task-validation",)], "FTS checklist trigger refreshes edited text")
    conn.execute("UPDATE resources SET deleted_at='2026-09-14T01:00:00Z' WHERE id='res-validation'")
    deleted_resource = conn.execute(
        "SELECT task_id FROM task_search WHERE task_search MATCH ?",
        ('"Accounting"',),
    ).fetchall()
    require(deleted_resource == [], "FTS trigger removes soft-deleted resource text")
except Exception as exc:
    fail(f"FTS smoke tests ({exc})")

# Ensure Rust migration registration is synchronized with migration files.
lib_rs = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
for migration in sorted(MIGRATIONS.glob("*.sql")):
    require(migration.name in lib_rs, f"Rust registers migration {migration.name}")

# External network API scan. Local URLs in docs/config are excluded by scanning application source only.
network_patterns = {
    "fetch(": re.compile(r"\bfetch\s*\("),
    "axios": re.compile(r"\baxios\b", re.IGNORECASE),
    "XMLHttpRequest": re.compile(r"\bXMLHttpRequest\b"),
    "WebSocket(": re.compile(r"\bWebSocket\s*\("),
}
app_sources = list((ROOT / "src").rglob("*.ts")) + list((ROOT / "src").rglob("*.tsx"))
combined = "\n".join(path.read_text(encoding="utf-8") for path in app_sources)
for name, pattern in network_patterns.items():
    require(not pattern.search(combined), f"No external network primitive: {name}")

# Guard the dynamic shortcut architecture against accidental re-hardcoding in Rust.
require("Code::Space" not in lib_rs and "Modifiers::CONTROL" not in lib_rs, "Quick Add shortcut is not hardcoded in Rust")
require("syncQuickAddShortcut" in (ROOT / "src" / "lib" / "platform.ts").read_text(encoding="utf-8"), "Frontend owns Quick Add shortcut registration")
sqlite_repo = (ROOT / "src" / "lib" / "sqliteRepository.ts").read_text(encoding="utf-8")
require("t.id IN (" in sqlite_repo and "SELECT task_id FROM task_search" in sqlite_repo, "FTS query narrows Task IDs before Task scan")


# Windows handoff / launch helpers.
for helper in [
    '01_初回セットアップ.cmd',
    '02_DeadlineDockを起動.cmd',
    '03_Windows版をビルド.cmd',
    '05_診断情報を作成.cmd',
    'scripts/windows/setup.ps1',
    'scripts/windows/run.ps1',
    'scripts/windows/build.ps1',
    'scripts/windows/diagnose.ps1',
]:
    require((ROOT / helper).exists(), f'Windows helper exists: {helper}')

platform_ts = (ROOT / 'src' / 'lib' / 'platform.ts').read_text(encoding='utf-8')
require('fn open_local_path' in lib_rs and bool(re.search(r'generate_handler!\[[\s\S]*?\bopen_local_path\b', lib_rs)),
        'Rust local path opener command is registered')
require("invoke('open_local_path'" in platform_ts,
        'Frontend uses Rust local path opener for FILE/FOLDER resources')
require("#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]" in (ROOT / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8"),
        "Windows release binary uses GUI subsystem (no console window)")

# Dedicated task composer architecture and release ZIP safety.
app_tsx = (ROOT / "src" / "App.tsx").read_text(encoding="utf-8")
mini_tsx = (ROOT / "src" / "components" / "MiniApp.tsx").read_text(encoding="utf-8")
main_tsx = (ROOT / "src" / "main.tsx").read_text(encoding="utf-8")
styles_css = (ROOT / "src" / "styles.css").read_text(encoding="utf-8")
require("openTaskComposer" in app_tsx, "Main window opens dedicated task composer")
require("openTaskComposer" in mini_tsx, "Mini window opens dedicated task composer")
require("QuickWindow" in main_tsx and "mode === 'quick'" in main_tsx, "Dedicated composer window bootstrap exists")
require("composer-scroll" in styles_css and "register-task-button" in styles_css, "Composer uses scrollable body with reachable register action")
quick_tsx = (ROOT / "src" / "components" / "QuickAdd.tsx").read_text(encoding="utf-8")
task_detail_tsx = (ROOT / "src" / "components" / "TaskDetail.tsx").read_text(encoding="utf-8")
repo_ts = (ROOT / "src" / "lib" / "repository.ts").read_text(encoding="utf-8")
require("!standalone && <button" in quick_tsx, "Standalone composer relies on the native title-bar close button")
require("checkItems:" in quick_tsx and "チェック項目" in quick_tsx, "Composer supports checklist creation")
require("toggleCheckItem" in task_detail_tsx and "moveCheckItem" in task_detail_tsx, "Task detail supports checklist toggle and reorder")
require("addCheckItem" in repo_ts and "task_check_items" in (MIGRATIONS / "0005_check_items.sql").read_text(encoding="utf-8"), "Checklist repository API and SQLite table exist")
require((ROOT / "scripts" / "package_release.py").exists(), "UTF-8 ZIP packaging helper exists")
rules_text = (ROOT / "docs" / "DEVELOPMENT_RULES.md").read_text(encoding="utf-8") if (ROOT / "docs" / "DEVELOPMENT_RULES.md").exists() else ""
require("0x800" in rules_text and "日本語ファイル名" in rules_text, "ZIP UTF-8 filename rule is documented")

print(f"\n{len(checks)} checks passed; {len(failures)} failed.")
if failures:
    raise SystemExit(1)
