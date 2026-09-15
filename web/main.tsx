import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addTask,
  changeData,
  editTask,
  emptyData,
  openStore,
  readData,
  removeTask,
  setDeadline,
  WORKSPACE,
  type Data,
} from "./store";
import {
  account,
  authorize,
  authorizeInThisTab,
  consumeRedirect,
  connected,
  createSheet,
  disconnect,
  listSheets,
  loadGoogle,
  sheetIdFromInput,
} from "./google";
import { Sheets } from "./sheets";
import { sync } from "./sync";
import {
  compareUrgency,
  deadlineInputFromTask,
  exactDeadlineFromDate,
  getUrgency,
  nonUrgentDeadline,
  todayDeadline,
  tomorrowDeadline,
} from "../src/lib/deadline";
import type { Task, TaskStatus } from "../src/types";
import "./style.css";

const statusLabel = {
  TODO: "未着手",
  IN_PROGRESS: "作業中",
  COMPLETED: "完了",
};
function App() {
  const [db, setDb] = useState<IDBDatabase>();
  const [data, setData] = useState(emptyData);
  const [page, setPage] = useState<"tasks" | "done" | "settings">("tasks");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Task>();
  const [undo, setUndo] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [auth, setAuth] = useState(false);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [sheetInput, setSheetInput] = useState("");
  const [pending, setPending] = useState<{
    id: string;
    local: number;
    remote: number;
    overlap: number;
  }>();
  const [filter, setFilter] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const editing = useRef(false);
  editing.current = !!selected;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncing = useRef(false);
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    let alive = true;
    let opened: IDBDatabase;
    openStore()
      .then(async (database) => {
        opened = database;
        const saved = await readData(database);
        if (alive) {
          setDb(database);
          setData(saved);
          channel.current = new BroadcastChannel("deadline-dock-web");
          channel.current.onmessage = () => {
            readData(database).then(setData).catch(report);
          };
        } else database.close();
      })
      .catch(report);
    return () => {
      alive = false;
      opened?.close();
      channel.current?.close();
      clearTimeout(timer.current);
    };
  }, []);
  const refresh = async () => {
    if (db) setData(await readData(db));
    channel.current?.postMessage("updated");
  };
  const runSync = async (repair = false) => {
    if (!db || syncing.current || editing.current) return;
    const current = await readData(db);
    if (!current.sheetId) return;
    if (!connected()) {
      setAuth(false);
      setMessage("端末に保存済み · Googleへ再接続すると同期します");
      return;
    }
    syncing.current = true;
    setBusy(true);
    setError("");
    setMessage("同期中…");
    try {
      const operation = () => sync(db, new Sheets(current.sheetId), repair);
      const result = await navigator.locks.request(
        "deadline-dock-sync",
        operation,
      );
      await refresh();
      setMessage(
        result.conflicts
          ? `${result.conflicts}件の競合を設定で確認してください。`
          : result.warnings.length
            ? result.warnings.join("\n")
            : "同期済み",
      );
    } catch (e) {
      report(e);
      await refresh();
      setMessage("端末に保存済み · 同期を再試行できます");
    } finally {
      syncing.current = false;
      setBusy(false);
      setAuth(connected());
    }
  };
  const save = async (edit: (d: Data) => void, immediate = false) => {
    if (!db) return;
    setError("");
    try {
      const saved = await changeData(db, edit);
      setData(saved);
      channel.current?.postMessage("updated");
      setMessage("端末に保存しました");
      clearTimeout(timer.current);
      if (saved.sheetId)
        timer.current = setTimeout(() => void runSync(), immediate ? 0 : 3000);
    } catch (e) {
      report(e);
      throw e;
    }
  };
  useEffect(() => {
    if (!db) return;
    // React may finish closing the editor after the zero-delay deletion timer.
    // Retry once after that commit, rather than waiting for the periodic poll.
    if (!selected && connected()) void runSync();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && !selected && connected())
        void runSync();
    }, 60000);
    return () => clearInterval(interval);
  }, [db, selected]);
  useEffect(() => {
    if (page === "settings")
      loadGoogle()
        .then(() => setGoogleReady(true))
        .catch(report);
  }, [page]);
  const finishConnection = async () => {
    if (!db) return;
    const user = await account();
    await changeData(db, (d) => {
      if (d.account && d.account !== user.sub) {
        d.sheetId = "";
        d.states = [];
        d.related = {};
        d.generations = {};
        d.conflicts = [];
        d.lastSync = "";
      }
      d.account = user.sub;
    });
    await refresh();
    setAuth(true);
    setFiles(await listSheets());
    setMessage("Googleに接続しました。同期先を選んでください。");
  };
  useEffect(() => {
    if (!db) return;
    try {
      if (consumeRedirect()) {
        setPage("settings");
        setBusy(true);
        finishConnection()
          .catch(report)
          .finally(() => setBusy(false));
      }
    } catch (e) {
      setPage("settings");
      report(e);
    }
  }, [db]);
  const connect = () => {
    setError("");
    setBusy(true);
    authorize()
      .then(finishConnection)
      .catch(report)
      .finally(() => setBusy(false));
  };
  const choose = async (input: string) => {
    setBusy(true);
    setError("");
    try {
      const id = sheetIdFromInput(input);
      const snapshot = await new Sheets(id).read();
      const remote = snapshot.rows[100].slice(1).filter((r) => r[1] && !r[12]);
      setPending({
        id,
        local: data.tasks.filter((t) => !t.deleted_at).length,
        remote: remote.length,
        overlap: remote.filter((r) =>
          data.tasks.some((t) => t.id === r[0] && !t.deleted_at),
        ).length,
      });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const link = async () => {
    if (!pending) return;
    const id = pending.id;
    setPending(undefined);
    await save((d) => {
      if (d.sheetId !== id) {
        d.states = [];
        d.related = {};
        d.generations = {};
        d.conflicts = [];
      }
      d.sheetId = id;
    }, true);
  };
  const exportData = () => {
    const now = new Date().toISOString();
    const backup = {
      format: "deadline-dock-backup",
      schemaVersion: 1,
      exportedAt: now,
      workspaces: [
        { id: WORKSPACE, name: "個人", created_at: now, updated_at: now },
      ],
      actors: [{ id: WORKSPACE, display_name: "Local User", created_at: now }],
      tasks: data.tasks,
      categories: data.categories,
      checkItems: data.checks,
      events: [],
      resources: [],
      history: [],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `deadline-dock-backup-${now.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tasks = data.tasks
    .filter(
      (t) =>
        !t.deleted_at &&
        (page === "done"
          ? t.status === "COMPLETED"
          : t.status !== "COMPLETED") &&
        (!filter || t.category_id === filter) &&
        `${t.title} ${t.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(compareUrgency);
  return (
    <>
      <header>
        <a className="brand" href="./">
          <img src="./icon.svg" width="40" height="40" alt="" />
          <span>
            Deadline Dock<small>思いついたら、ここに。</small>
          </span>
        </a>
        <span className="edition">WEB</span>
      </header>
      <main>
        <div className="notice" role="status">
          {message || "このブラウザに自動保存"}
          {busy && <span className="spinner" />}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => setError("")}
              aria-label="エラー表示を閉じる"
            >
              ×
            </button>
          </div>
        )}
        {page !== "settings" ? (
          <>
            <section className="intro">
              <p className="eyebrow">
                {page === "done" ? "WELL DONE" : "YOUR NEXT STEP"}
              </p>
              <h1>{page === "done" ? "できたこと" : "今日も、ひとつずつ。"}</h1>
              <p>
                {page === "done"
                  ? "積み重ねた仕事を振り返る。"
                  : "小さな用事も、大切な締切も。"}
              </p>
            </section>
            {page === "tasks" && (
              <form
                className="quick"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!title.trim()) return;
                  try {
                    await save((d) => {
                      addTask(d, title);
                    });
                    setTitle("");
                  } catch {}
                }}
              >
                <label htmlFor="quick-title">タスクを追加</label>
                <div className="row">
                  <input
                    id="quick-title"
                    placeholder="何をする？ 件名だけでOK"
                    value={title}
                    maxLength={500}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={!db || busy}
                  />
                  <button
                    className="primary"
                    disabled={!db || busy || !title.trim()}
                    aria-label="タスクを登録"
                  >
                    ＋
                  </button>
                </div>
                <small>
                  締切は「急ぎではない」で登録。あとから編集できます。
                </small>
              </form>
            )}
            <div className="filters">
              <input
                aria-label="タスクを検索"
                placeholder="タスクを検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="分類で絞り込み"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">すべての分類</option>
                {data.categories
                  .filter((c) => !c.deleted_at)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="list-head">
              <h2>{page === "done" ? "完了したタスク" : "タスク"}</h2>
              <span>{tasks.length}件</span>
            </div>
            <div className="tasks">
              {tasks.map((t) => {
                const checks = data.checks.filter(
                  (c) => c.task_id === t.id && !c.deleted_at,
                );
                return (
                  <article key={t.id}>
                    <button
                      className="complete"
                      aria-label={`${t.title}を${t.status === "COMPLETED" ? "未着手に戻す" : "完了にする"}`}
                      disabled={busy}
                      onClick={() =>
                        void save((d) =>
                          editTask(d, t.id, (x) => {
                            x.status =
                              t.status === "COMPLETED" ? "TODO" : "COMPLETED";
                            x.completed_at =
                              x.status === "COMPLETED"
                                ? new Date().toISOString()
                                : null;
                          }),
                        ).catch(() => {})
                      }
                    >
                      {t.status === "COMPLETED" ? "✓" : ""}
                    </button>
                    <button
                      className="task-body"
                      disabled={busy}
                      onClick={() => setSelected(structuredClone(t))}
                    >
                      <strong>{t.title}</strong>
                      <span>
                        <b className={getUrgency(t).tone}>
                          {getUrgency(t).label}
                        </b>
                        {t.category_id && (
                          <em>
                            {
                              data.categories.find(
                                (c) => c.id === t.category_id,
                              )?.name
                            }
                          </em>
                        )}
                        {checks.length > 0 && (
                          <em>
                            ✓ {checks.filter((c) => c.checked).length}/
                            {checks.length}
                          </em>
                        )}
                        {t.status === "IN_PROGRESS" && <em>作業中</em>}
                      </span>
                      {t.description && (
                        <small className="description-preview">
                          {t.description}
                        </small>
                      )}
                    </button>
                    <span className="chevron">›</span>
                  </article>
                );
              })}
            </div>
            {!tasks.length && (
              <div className="empty">
                <span>✓</span>
                <h3>
                  {query
                    ? "見つかりませんでした"
                    : page === "done"
                      ? "完了したタスクがここに並びます"
                      : "頭の中を、少し軽く。"}
                </h3>
                <p>
                  {query
                    ? "キーワードを変えてお試しください。"
                    : "まずは件名ひとつから始めましょう。"}
                </p>
              </div>
            )}
            {undo && (
              <div className="undo">
                タスクを削除しました
                <button
                  onClick={async () => {
                    try {
                      await save((d) => removeTask(d, undo, true), true);
                      setUndo("");
                    } catch {}
                  }}
                >
                  元に戻す
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <section className="intro">
              <p className="eyebrow">KEEP IN SYNC</p>
              <h1>設定と連携</h1>
              <p>スマホでメモして、PCで仕上げる。</p>
            </section>
            <section className="card">
              <h2>Google Sheets</h2>
              <p>
                PC版と同じGoogleアカウントで接続し、同じ同期用スプレッドシートを選びます。
              </p>
              <button
                className="primary"
                disabled={!googleReady || busy || !db}
                onClick={connect}
              >
                {auth
                  ? "Googleへ再接続"
                  : googleReady
                    ? "Googleと連携"
                    : "Google接続を準備中…"}
              </button>
              <button
                disabled={!db || syncing.current}
                onClick={() => {
                  try {
                    authorizeInThisTab();
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                同じタブでGoogleに接続
              </button>
              {auth && (
                <>
                  <label>
                    同期用スプレッドシート
                    <select
                      aria-label="同期用スプレッドシート"
                      disabled={busy}
                      defaultValue=""
                      onChange={(e) =>
                        e.target.value && void choose(e.target.value)
                      }
                    >
                      <option value="">シートを選択</option>
                      {files.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <details>
                    <summary>URLを指定する</summary>
                    <input
                      aria-label="スプレッドシートURL"
                      value={sheetInput}
                      onChange={(e) => setSheetInput(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/…"
                    />
                    <button
                      disabled={busy || !sheetInput}
                      onClick={() => void choose(sheetInput)}
                    >
                      このシートを確認
                    </button>
                  </details>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const f = await createSheet();
                        await choose(f.spreadsheetId);
                      } catch (e) {
                        report(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    新しい同期用シートを作成
                  </button>
                </>
              )}
              {data.sheetId && (
                <div className="linked">
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${data.sheetId}/edit`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    スプレッドシートを開く ↗
                  </a>
                  <small>
                    最終同期：
                    {data.lastSync
                      ? new Date(data.lastSync).toLocaleString("ja-JP")
                      : "まだありません"}
                  </small>
                  <div className="row">
                    <button
                      disabled={busy || !auth}
                      onClick={() => void runSync()}
                    >
                      今すぐ同期
                    </button>
                    <button
                      disabled={busy || !auth}
                      onClick={() => void runSync(true)}
                    >
                      レイアウトを整える
                    </button>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      disconnect();
                      setAuth(false);
                      void save((d) => {
                        d.sheetId = "";
                        d.states = [];
                        d.related = {};
                        d.generations = {};
                        d.conflicts = [];
                        d.lastSync = "";
                      }).catch(() => {});
                    }}
                  >
                    このブラウザの連携を解除
                  </button>
                </div>
              )}
              <p className="fine">
                タスク・分類・チェック項目を同期します。画面を開いている間は保存後約3秒／1分ごとに同期。削除は関連するチェック項目・予定・リンクもシートから消します。予定・リンクの編集はPC版をご利用ください。
              </p>
              <p className="fine">
                Googleの接続は一定時間で切れます。その際は再接続してください。PC版は両方ともv0.1.12以降に更新してください。
              </p>
            </section>
            {!!data.conflicts.length && (
              <section className="card">
                <h2>変更の競合</h2>
                <p>
                  同じ項目を複数の端末で更新しています。残したい内容を選びます。
                </p>
                {data.conflicts.map((c) => (
                  <div className="conflict" key={c.id}>
                    <h3>
                      {c.entity_type === "TASK"
                        ? "タスク"
                        : c.entity_type === "CATEGORY"
                          ? "分類"
                          : "チェック項目"}
                    </h3>
                    {(["LOCAL", "REMOTE"] as const).map((side) => {
                      const raw = JSON.parse(
                        side === "LOCAL" ? c.local_json : c.remote_json,
                      );
                      const text = Array.isArray(raw)
                        ? raw.filter(Boolean).slice(1, 7).join(" · ")
                        : `${raw.title}\n${raw.description}`;
                      return (
                        <button
                          key={side}
                          disabled={busy}
                          onClick={() =>
                            void save((d) => {
                              const current = d.conflicts.find(
                                (v) => v.id === c.id,
                              );
                              if (current) current.resolution = side;
                            }, true).catch(() => {})
                          }
                        >
                          <b>
                            {side === "LOCAL"
                              ? "このブラウザの内容"
                              : "スプレッドシートの内容"}
                          </b>
                          <span>{text}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </section>
            )}
            <section className="card">
              <h2>分類</h2>
              <p>仕事や用途ごとにタスクを整理できます。</p>
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = categoryName.trim();
                  if (!name) return;
                  try {
                    await save((d) => {
                      if (
                        d.categories.some(
                          (c) => !c.deleted_at && c.name === name,
                        )
                      )
                        throw new Error("同じ名前の分類があります。");
                      const now = new Date().toISOString();
                      d.categories.push({
                        id: crypto.randomUUID(),
                        workspace_id: WORKSPACE,
                        name,
                        color: "slate",
                        sort_order: d.categories.length,
                        created_at: now,
                        updated_at: now,
                      });
                    });
                    setCategoryName("");
                  } catch {}
                }}
              >
                <input
                  aria-label="新しい分類名"
                  placeholder="例：仕事、暮らし"
                  value={categoryName}
                  maxLength={200}
                  onChange={(e) => setCategoryName(e.target.value)}
                />
                <button disabled={busy || !db || !categoryName.trim()}>
                  追加
                </button>
              </form>
            </section>
            <section className="card">
              <h2>端末内の保存</h2>
              <p>
                未連携のタスクは、この端末・このブラウザのIndexedDBに保存されます。別のブラウザには引き継がれません。
              </p>
              <p className="fine">
                サイトデータの削除やプライベートブラウズではデータが失われることがあります。大切なタスクはGoogle連携またはバックアップで保管してください。
              </p>
              <button disabled={!db || busy} onClick={exportData}>
                バックアップを保存
              </button>
              <small>PC版に読み込めるJSON形式です。</small>
            </section>
            <p className="footer">
              <a href="/tools/Tool05_deadline-dock/">PC版・使い方</a> ·{" "}
              <a href="/tools/Tool05_deadline-dock/privacy/">プライバシー</a>
            </p>
          </>
        )}
      </main>
      <nav aria-label="メインメニュー">
        {(["tasks", "done", "settings"] as const).map((p, i) => (
          <button
            key={p}
            className={page === p ? "active" : ""}
            aria-current={page === p ? "page" : undefined}
            onClick={() => setPage(p)}
          >
            <span>{["▤", "✓", "⚙"][i]}</span>
            {["タスク", "完了済み", "設定"][i]}
          </button>
        ))}
      </nav>
      {selected && (
        <Editor
          task={selected}
          data={data}
          busy={busy}
          onClose={() => setSelected(undefined)}
          onSave={async (t, checkEdits, revision) => {
            await save((d) => {
              if (d.revision !== revision)
                throw new Error(
                  "別の画面で更新されました。一度閉じて最新の内容を確認してください。",
                );
              const current = d.tasks.find((x) => x.id === t.id);
              if (current?.revision !== selected.revision)
                throw new Error(
                  "別の画面で更新されました。一度閉じて最新の内容を確認してください。",
                );
              editTask(d, t.id, (x) => {
                Object.assign(x, t);
              });
              for (const c of checkEdits) {
                const old = d.checks.find((v) => v.id === c.id);
                old ? Object.assign(old, c) : d.checks.push(c);
              }
            });
            setSelected(undefined);
          }}
          onDelete={async () => {
            await save((d) => removeTask(d, selected.id), true);
            setUndo(selected.id);
            setSelected(undefined);
          }}
        />
      )}
      {pending && (
        <div className="overlay">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="初回の同期を確認"
          >
            <h2>タスクを合算して連携</h2>
            <p>
              このブラウザに{pending.local}件、シートに{pending.remote}
              件。共通するIDは{pending.overlap}件です。
            </p>
            <p>
              別のIDは両方残します。同じIDで内容が異なる場合は、設定の「変更の競合」で選べます。件名だけが同じタスクも別のIDなら残ります。
            </p>
            <p>削除済みのIDには削除記録を適用します。</p>
            <div className="row">
              <button onClick={() => setPending(undefined)}>キャンセル</button>
              <button
                className="primary"
                onClick={() => void link().catch(report)}
              >
                合算して同期を開始
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function Editor({
  task,
  data,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  data: Data;
  busy: boolean;
  onClose: () => void;
  onSave: (t: Task, c: Data["checks"], revision: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [sourceRevision] = useState(data.revision);
  const [draft, setDraft] = useState(task);
  const [checks, setChecks] = useState(() =>
    structuredClone(data.checks.filter((c) => c.task_id === task.id)),
  );
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const action = async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="overlay">
      <section
        className="editor"
        role="dialog"
        aria-modal="true"
        aria-label="タスクを編集"
      >
        <div className="editor-head">
          <button onClick={onClose} disabled={saving}>
            閉じる
          </button>
          <strong>タスクの詳細</strong>
          <button
            className="primary"
            disabled={saving || busy || !draft.title.trim()}
            onClick={() =>
              void action(() =>
                onSave(
                  { ...draft, title: draft.title.trim() },
                  checks,
                  sourceRevision,
                ),
              )
            }
          >
            保存
          </button>
        </div>
        <fieldset disabled={busy || saving}>
          <label>
            件名
            <input
              value={draft.title}
              maxLength={500}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            ステータス
            <select
              value={draft.status}
              onChange={(e) => {
                const status = e.target.value as TaskStatus;
                setDraft({
                  ...draft,
                  status,
                  completed_at:
                    status === "COMPLETED"
                      ? (draft.completed_at ?? new Date().toISOString())
                      : null,
                });
              }}
            >
              {Object.entries(statusLabel).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            締切 <small>{deadlineInputFromTask(draft).label}</small>
            <input
              aria-label="締切日"
              type="date"
              value={
                draft.deadline_type === "EXACT" && draft.deadline_exact
                  ? new Date(
                      new Date(draft.deadline_exact).getTime() -
                        new Date(draft.deadline_exact).getTimezoneOffset() *
                          60000,
                    )
                      .toISOString()
                      .slice(0, 10)
                  : ""
              }
              onChange={(e) => {
                const t = { ...draft };
                setDeadline(
                  t,
                  e.target.value
                    ? exactDeadlineFromDate(e.target.value)
                    : nonUrgentDeadline(),
                );
                setDraft(t);
              }}
            />
          </label>
          <div className="chips">
            {[
              ["今日", todayDeadline],
              ["明日", tomorrowDeadline],
              ["急ぎではない", nonUrgentDeadline],
            ].map(([label, fn]) => (
              <button
                key={String(label)}
                onClick={() => {
                  const t = { ...draft };
                  setDeadline(t, (fn as typeof todayDeadline)());
                  setDraft(t);
                }}
              >
                {String(label)}
              </button>
            ))}
          </div>
          <label>
            分類
            <select
              value={draft.category_id ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, category_id: e.target.value || null })
              }
            >
              <option value="">未分類</option>
              {data.categories
                .filter((c) => !c.deleted_at)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            作業内容
            <textarea
              rows={5}
              maxLength={50000}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder="手順、補足、忘れたくないこと"
            />
          </label>
          <h3>チェック項目</h3>
          {checks
            .filter((c) => !c.deleted_at)
            .map((c) => (
              <div className="check-row" key={c.id}>
                <input
                  aria-label={`${c.text}の完了`}
                  type="checkbox"
                  checked={!!c.checked}
                  onChange={(e) =>
                    setChecks(
                      checks.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              checked: e.target.checked ? 1 : 0,
                              updated_at: new Date().toISOString(),
                            }
                          : x,
                      ),
                    )
                  }
                />
                <span>{c.text}</span>
                <button
                  aria-label={`${c.text}を削除`}
                  onClick={() =>
                    setChecks(
                      checks.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              deleted_at: new Date().toISOString(),
                              updated_at: new Date().toISOString(),
                            }
                          : x,
                      ),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          <div className="row">
            <input
              aria-label="チェック項目を追加"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="チェック項目を追加"
              maxLength={1000}
            />
            <button
              disabled={!text.trim()}
              onClick={() => {
                const now = new Date().toISOString();
                setChecks([
                  ...checks,
                  {
                    id: crypto.randomUUID(),
                    task_id: task.id,
                    text: text.trim(),
                    checked: 0,
                    sort_order: checks.length,
                    created_at: now,
                    updated_at: now,
                  },
                ]);
                setText("");
              }}
            >
              追加
            </button>
          </div>
          <div className="delete-area">
            {confirmDelete ? (
              <>
                <p>
                  このタスクと関連するチェック項目・予定・リンクを削除します。連携中のシートにも反映します。
                </p>
                <button
                  className="danger"
                  onClick={() => void action(onDelete)}
                >
                  削除する
                </button>
                <button onClick={() => setConfirmDelete(false)}>
                  キャンセル
                </button>
              </>
            ) : (
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                タスクを削除
              </button>
            )}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/tools/deadline-dock/sw.js", {
        scope: "/tools/deadline-dock/",
      })
      .catch(() => {});
  });
