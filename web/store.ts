import type { Task, Category, CheckItem, DeadlineInput } from "../src/types";
import type { SyncState, SyncConflict } from "../src/lib/googleSyncCore";
import { nonUrgentDeadline } from "../src/lib/deadline";
export const WORKSPACE = "00000000-0000-4000-8000-000000000001";
export interface Life {
  task_id: string;
  state: "DELETED" | "ACTIVE";
  operation_id: string;
  changed_at: string;
  base_operation_id: string;
  dirty: boolean;
}
export interface Data {
  formatVersion: 1;
  revision: number;
  tasks: Task[];
  categories: Category[];
  checks: CheckItem[];
  life: Life[];
  states: SyncState[];
  conflicts: SyncConflict[];
  related: Record<string, { local: string; remote: string }>;
  generations: Record<string, string>;
  sheetId: string;
  account: string;
  lastSync: string;
}
export const emptyData = (): Data => ({
  formatVersion: 1,
  revision: 0,
  tasks: [],
  categories: [],
  checks: [],
  life: [],
  states: [],
  conflicts: [],
  related: {},
  generations: {},
  sheetId: "",
  account: "",
  lastSync: "",
});
export function checkedData(value: unknown): Data {
  const d = value as Data;
  if (
    !d ||
    d.formatVersion !== 1 ||
    !Number.isInteger(d.revision) ||
    !["tasks", "categories", "checks", "life", "states", "conflicts"].every(
      (k) => Array.isArray(d[k as keyof Data]),
    ) ||
    typeof d.sheetId !== "string" ||
    !d.related ||
    !d.generations
  )
    throw new Error("この保存形式は読み込めません。データは変更していません。");
  return d;
}
export function openStore(name = "deadline-dock-web-v1"): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("別のタブを閉じて再読み込みしてください。"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function readData(db: IDBDatabase): Promise<Data> {
  return new Promise((resolve, reject) => {
    const r = db.transaction("workspace").objectStore("workspace").get("data");
    r.onsuccess = () => {
      try {
        resolve(r.result === undefined ? emptyData() : checkedData(r.result));
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(r.error);
  });
}
// All edits read and write in one transaction. Never await inside an active IDB transaction.
export async function changeData(
  db: IDBDatabase,
  edit: (d: Data) => void,
  expected?: number,
): Promise<Data> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    const store = tx.objectStore("workspace");
    const get = store.get("data");
    let result: Data;
    let failure: unknown;
    get.onsuccess = () => {
      try {
        result =
          get.result === undefined ? emptyData() : checkedData(get.result);
        if (expected !== undefined && result.revision !== expected)
          throw new Error(
            "別の画面で更新されました。もう一度同期してください。",
          );
        edit(result);
        result.revision++;
        store.put(result, "data");
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error("保存できませんでした。"));
    tx.onerror = () => {
      failure ??= tx.error;
    };
  });
}
export function setDeadline(task: Task, d: DeadlineInput) {
  task.deadline_type = d.type;
  task.deadline_label = d.label;
  task.deadline_exact = d.exact ?? null;
  task.deadline_range_start = d.rangeStart ?? null;
  task.deadline_range_end = d.rangeEnd ?? null;
}
export function addTask(
  d: Data,
  title: string,
  deadline = nonUrgentDeadline(),
): Task {
  if (!title.trim()) throw new Error("件名を入力してください。");
  const now = new Date().toISOString();
  const t: Task = {
    id: crypto.randomUUID(),
    workspace_id: WORKSPACE,
    title: title.trim().slice(0, 500),
    description: "",
    status: "TODO",
    deadline_type: deadline.type,
    deadline_label: deadline.label,
    created_at: now,
    updated_at: now,
    revision: 1,
    postponement_count: 0,
  };
  setDeadline(t, deadline);
  d.tasks.push(t);
  return t;
}
export function editTask(d: Data, id: string, edit: (t: Task) => void) {
  const t = d.tasks.find((x) => x.id === id);
  if (!t || t.deleted_at) throw new Error("タスクは削除されています。");
  edit(t);
  t.updated_at = new Date().toISOString();
  t.revision++;
}
export function removeTask(d: Data, id: string, restore = false) {
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return;
  const previous = t.deleted_at;
  const now = new Date().toISOString();
  t.deleted_at = restore ? null : now;
  t.updated_at = now;
  t.revision++;
  for (const c of d.checks.filter((c) => c.task_id === id)) {
    if (restore ? c.deleted_at === previous : !c.deleted_at) {
      c.deleted_at = restore ? null : now;
      c.updated_at = now;
    }
  }
  const old = d.life.find((l) => l.task_id === id);
  d.life = d.life.filter((l) => l.task_id !== id);
  d.life.push({
    task_id: id,
    state: restore ? "ACTIVE" : "DELETED",
    operation_id: crypto.randomUUID(),
    changed_at: now,
    base_operation_id: old?.operation_id ?? "",
    dirty: true,
  });
  d.states = d.states.filter((s) => s.entity_id !== id);
  d.conflicts = d.conflicts.filter((c) => c.entity_id !== id);
}
