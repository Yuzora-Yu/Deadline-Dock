import { planTaskSync, type SyncConflict } from "../src/lib/googleSyncCore";
import {
  addTask,
  changeData,
  readData,
  setDeadline,
  WORKSPACE,
  type Data,
  type Life,
} from "./store";
import { cells, Sheets, type Snapshot } from "./sheets";
import type { CategoryColor } from "../src/types";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const pad = (r: string[], n: number) =>
  Array.from({ length: n }, (_, i) => r[i] ?? "");
export function chooseLife(
  local: Life | undefined,
  remote: Life | undefined,
): Life {
  if (!remote) return local!;
  if (!local || local.operation_id === remote.operation_id) return remote;
  if (
    local.dirty &&
    ((local.state === "DELETED" && remote.state === "ACTIVE") ||
      (local.state === "ACTIVE" &&
        local.base_operation_id === remote.operation_id))
  )
    return local;
  return remote;
}
export function lifecyclePlan(d: Data, s: Snapshot) {
  const remote = new Map<string, Life>();
  for (const r of s.rows[106].slice(1)) {
    if (r.every((v) => !v)) continue;
    if (
      !uuid.test(r[0]) ||
      !["ACTIVE", "DELETED"].includes(r[1]) ||
      !r[2] ||
      !Number.isFinite(Date.parse(r[3]))
    )
      throw new Error("削除の同期記録が不正です。PC版で確認してください。");
    if (remote.has(r[0])) throw new Error("削除の同期記録に重複があります。");
    remote.set(r[0], {
      task_id: r[0],
      state: r[1] as Life["state"],
      operation_id: r[2],
      changed_at: r[3],
      base_operation_id: r[4] ?? "",
      dirty: false,
    });
  }
  for (const r of s.rows[100].slice(1))
    if (r[12] && !remote.has(r[0]))
      remote.set(r[0], {
        task_id: r[0],
        state: "DELETED",
        operation_id: `legacy:${r[0]}:${r[12]}`,
        changed_at: r[12],
        base_operation_id: "",
        dirty: false,
      });
  const ids = new Set([...remote.keys(), ...d.life.map((l) => l.task_id)]);
  const chosen = [...ids].sort().map((id) =>
    chooseLife(
      d.life.find((l) => l.task_id === id),
      remote.get(id),
    ),
  );
  const deleted = new Set(
    chosen.filter((l) => l.state === "DELETED").map((l) => l.task_id),
  );
  const requests: unknown[] = [];
  const ledger = chosen.map((l) => [
    l.task_id,
    l.state,
    l.operation_id,
    l.changed_at,
    l.base_operation_id,
  ]);
  if (
    !same(
      ledger,
      s.rows[106]
        .slice(1)
        .filter((r) => r.some(Boolean))
        .map((r) => pad(r, 5)),
    )
  ) {
    ledger.forEach((r, i) => requests.push(cells(106, i + 1, r)));
  }
  for (const sid of [100, 101, 102, 103]) {
    const key = sid === 100 ? 0 : 1;
    for (let i = s.rows[sid].length - 1; i >= 1; i--)
      if (deleted.has(s.rows[sid][i][key]))
        requests.push({
          deleteDimension: {
            range: {
              sheetId: sid,
              dimension: "ROWS",
              startIndex: i,
              endIndex: i + 1,
            },
          },
        });
  }
  for (const l of chosen) {
    const t = d.tasks.find((t) => t.id === l.task_id);
    const old = d.life.find((v) => v.task_id === l.task_id);
    if (
      t &&
      (!!t.deleted_at !== (l.state === "DELETED") ||
        old?.operation_id !== l.operation_id)
    ) {
      const previous = t.deleted_at;
      t.deleted_at = l.state === "DELETED" ? l.changed_at : null;
      t.updated_at = l.changed_at;
      t.revision++;
      for (const c of d.checks.filter((c) => c.task_id === t.id)) {
        if (
          l.state === "DELETED"
            ? !c.deleted_at || c.deleted_at === previous
            : c.deleted_at === previous
        ) {
          c.deleted_at = t.deleted_at;
          c.updated_at = l.changed_at;
        }
      }
      d.states = d.states.filter((v) => v.entity_id !== t.id);
      d.conflicts = d.conflicts.filter((v) => v.entity_id !== t.id);
      for (const c of d.checks.filter((c) => c.task_id === t.id))
        delete d.related["101:" + c.id];
    }
  }
  d.life = chosen.map((l) => ({ ...l, dirty: false }));
  return requests;
}
function categoryRow(c: Data["categories"][number]) {
  return [
    c.id,
    c.name,
    c.color ?? "slate",
    String(c.sort_order),
    c.updated_at,
    c.deleted_at ?? "",
  ];
}
function checkRow(c: Data["checks"][number], d: Data) {
  return [
    c.id,
    c.task_id,
    d.tasks.find((t) => t.id === c.task_id)?.title ?? " ",
    c.checked ? "TRUE" : "FALSE",
    c.text,
    String(c.sort_order),
    c.updated_at,
    c.deleted_at ?? "",
  ];
}
function category(d: Data, name: string) {
  let c = d.categories.find((c) => !c.deleted_at && c.name === name);
  if (!c && name) {
    const now = new Date().toISOString();
    c = {
      id: crypto.randomUUID(),
      workspace_id: WORKSPACE,
      name,
      color: "slate",
      sort_order: d.categories.length,
      created_at: now,
      updated_at: now,
    };
    d.categories.push(c);
  }
  return c?.id ?? null;
}
function unusedCheck(r: string[]) {
  return (
    !r[0] &&
    !r[1] &&
    !r[2] &&
    !r[4] &&
    !r[6] &&
    !r[7] &&
    (!r[3] || r[3].toUpperCase() === "FALSE") &&
    (!r[5] || r[5] === "0")
  );
}
function identifyRelated(d: Data, s: Snapshot) {
  const requests: unknown[] = [];
  for (const sid of [104, 101])
    for (let i = 1; i < s.rows[sid].length; i++) {
      const r = pad(s.rows[sid][i], sid === 104 ? 6 : 8);
      if (!r.some(Boolean) || (sid === 101 && unusedCheck(r)) || r[0]) continue;
      if (sid === 104) {
        if (!r[1]) throw new Error("分類名のない行があります。");
        r[0] = crypto.randomUUID();
        r[2] ||= "slate";
        r[3] ||= "0";
        r[4] ||= new Date().toISOString();
      } else {
        if (!r[4]) throw new Error("チェック項目の内容がない行があります。");
        if (!r[1]) {
          const matches = new Set([
            ...s.rows[100]
              .slice(1)
              .filter((t) => t[1] === r[2] && uuid.test(t[0]) && !t[12])
              .map((t) => t[0]),
            ...d.tasks
              .filter((t) => t.title === r[2] && !t.deleted_at)
              .map((t) => t.id),
          ]);
          if (matches.size !== 1)
            throw new Error(
              "チェック項目のtask_idを指定してください。同名のタスクは件名だけでは判別できません。",
            );
          r[1] = [...matches][0];
        }
        if (!uuid.test(r[1]))
          throw new Error("チェック項目のtask_idが不正です。");
        r[0] = crypto.randomUUID();
        r[3] ||= "FALSE";
        r[5] ||= String(i - 1);
        r[6] ||= new Date().toISOString();
      }
      requests.push(cells(sid, i, r));
    }
  return requests;
}
function relatedPlan(d: Data, s: Snapshot, sid: 101 | 104) {
  const width = sid === 104 ? 6 : 8,
    kind = sid === 104 ? "CATEGORY" : "CHECK_ITEM";
  const requests: unknown[] = [];
  const records =
    sid === 104
      ? d.categories
      : d.checks.filter(
          (c) => !d.tasks.find((t) => t.id === c.task_id)?.deleted_at,
        );
  const rows = records.map((c) =>
    sid === 104
      ? categoryRow(c as Data["categories"][number])
      : checkRow(c as Data["checks"][number], d),
  );
  const remote = s.rows[sid]
    .slice(1)
    .map((r) =>
      sid === 101 && unusedCheck(r) ? pad([], width) : pad(r, width),
    );
  const seen = new Set<string>();
  for (const r of remote) {
    if (!r.some(Boolean)) continue;
    if (!uuid.test(r[0]) || seen.has(r[0]))
      throw new Error(
        `${sid === 104 ? "分類" : "チェック項目"}のIDが不正または重複しています。PC版で確認してください。`,
      );
    seen.add(r[0]);
  }
  const semantic = (r: string[]) =>
    sid === 104
      ? [r[1], r[2], r[3], r[5]]
      : [r[1], r[3].toUpperCase(), r[4], r[5], r[7]];
  for (let i = 0; i < remote.length; i++) {
    const r = remote[i];
    if (!r.some(Boolean)) continue;
    if (sid === 101 && !d.tasks.some((t) => t.id === r[1] && !t.deleted_at))
      continue;
    // Unify same-name categories before assigning incoming tasks.
    if (sid === 104 && !rows.some((x) => x[0] === r[0])) {
      const matched = d.categories.find(
        (c) => c.name === r[1] && !c.deleted_at && !r[5],
      );
      if (matched && !remote.some((v) => v[0] === matched.id)) {
        const old = matched.id;
        matched.id = r[0];
        for (const t of d.tasks)
          if (t.category_id === old) t.category_id = r[0];
        const row = rows.find((v) => v[0] === old);
        if (row) row[0] = r[0];
      }
    }
    const local = rows.find((x) => x[0] === r[0]);
    const key = sid + ":" + r[0];
    const state = d.related[key];
    const ljson = JSON.stringify(local),
      rjson = JSON.stringify(r);
    const choice = d.conflicts.find(
      (c) =>
        c.entity_type === kind &&
        c.entity_id === r[0] &&
        c.local_json === ljson &&
        c.remote_json === rjson,
    )?.resolution;
    const lc = !!local && (!state || state.local !== ljson),
      rc = !state || state.remote !== rjson;
    if (local && !same(semantic(local), semantic(r)) && lc && rc && !choice) {
      d.conflicts = d.conflicts.filter(
        (c) => !(c.entity_type === kind && c.entity_id === r[0]),
      );
      d.conflicts.push({
        id: crypto.randomUUID(),
        entity_type: kind,
        entity_id: r[0],
        local_json: ljson,
        remote_json: rjson,
        resolution: null,
      });
      continue;
    }
    if (local && (choice === "LOCAL" || (lc && !rc))) {
      requests.push(cells(sid, i + 1, local));
      d.related[key] = { local: ljson, remote: ljson };
    } else {
      if (!local || !same(semantic(local), semantic(r))) {
        const now = new Date().toISOString();
        if (sid === 104) {
          if (
            !r[1] ||
            ![
              "slate",
              "blue",
              "cyan",
              "green",
              "lime",
              "yellow",
              "orange",
              "red",
              "pink",
              "purple",
            ].includes(r[2] || "slate") ||
            !Number.isFinite(Number(r[3]))
          )
            throw new Error("分類の入力を確認してください。");
          const value = {
            id: r[0],
            workspace_id: WORKSPACE,
            name: r[1],
            color: (r[2] || "slate") as CategoryColor,
            sort_order: Number(r[3]),
            created_at: now,
            updated_at: r[4] || now,
            deleted_at: r[5] || null,
          };
          const existing = d.categories.find((c) => c.id === r[0]);
          existing
            ? Object.assign(existing, value, {
                created_at: existing.created_at,
              })
            : d.categories.push(value);
        } else {
          if (
            !r[4] ||
            !["TRUE", "FALSE", ""].includes(r[3].toUpperCase()) ||
            !Number.isFinite(Number(r[5]))
          )
            throw new Error("チェック項目の入力を確認してください。");
          const value = {
            id: r[0],
            task_id: r[1],
            text: r[4],
            checked: r[3].toUpperCase() === "TRUE" ? 1 : 0,
            sort_order: Number(r[5]),
            created_at: now,
            updated_at: r[6] || now,
            deleted_at: r[7] || null,
          };
          const existing = d.checks.find((c) => c.id === r[0]);
          existing
            ? Object.assign(existing, value, {
                created_at: existing.created_at,
              })
            : d.checks.push(value);
        }
      }
      const updated =
        sid === 104
          ? categoryRow(d.categories.find((c) => c.id === r[0])!)
          : checkRow(
              d.checks.find((c) => c.id === r[0])!,
              d,
            );
      d.related[key] = { local: JSON.stringify(updated), remote: rjson };
    }
    d.conflicts = d.conflicts.filter(
      (c) => !(c.entity_type === kind && c.entity_id === r[0]),
    );
  }
  let next = Math.max(1, s.rows[sid].length);
  for (const r of rows)
    if (!seen.has(r[0]) && !r[width - 1]) {
      const key = sid + ":" + r[0];
      if (d.related[key]) continue;
      requests.push(cells(sid, next++, r));
      d.related[key] = { local: JSON.stringify(r), remote: JSON.stringify(r) };
    }
  return requests;
}
export async function sync(
  db: IDBDatabase,
  sheets: Sheets,
  repair = false,
  pass = 0,
): Promise<{ warnings: string[]; conflicts: number }> {
  if (pass > 5)
    throw new Error(
      "同期中に行が続けて追加されています。少し待ってもう一度同期してください。",
    );
  let snapshot = await sheets.ensure(repair);
  let d = await readData(db);
  for (const sid of [100, 101, 104]) {
    const generation = snapshot.meta.sheets
      .find((s: any) => s.properties.sheetId === sid)
      ?.developerMetadata?.find(
        (m: any) => m.metadataKey === "deadlineDockGeneration",
      )?.metadataValue;
    if (generation && d.generations[sid] !== generation) {
      if (generation.startsWith("created:")) {
        if (sid === 100) d.states = [];
        else
          for (const k of Object.keys(d.related))
            if (k.startsWith(sid + ":")) delete d.related[k];
      }
      d.generations[sid] = generation;
    }
  }
  const lifecycle = lifecyclePlan(d, snapshot);
  await sheets.commit(snapshot, lifecycle);
  await changeData(db, (current) => Object.assign(current, d), d.revision);
  snapshot = await sheets.read();
  d = await readData(db);
  // Assign task IDs first so checklist rows can resolve their parent by title.
  const unnamedTasks = await planTaskSync(
    {
      tasks: d.tasks,
      categories: d.categories,
      states: d.states,
      conflicts: d.conflicts,
    },
    {
      spreadsheet_id: sheets.id,
      version: snapshot.ticket ?? "",
      rows: snapshot.rows[100],
      grid_rows: 1000,
    },
  );
  if (unnamedTasks.identify.length) {
    await sheets.commit(
      snapshot,
      unnamedTasks.identify.map((p) => cells(100, p.row_index, p.values)),
    );
    return sync(db, sheets, false, pass + 1);
  }
  const identifiers = identifyRelated(d, snapshot);
  if (identifiers.length) {
    await sheets.commit(snapshot, identifiers);
    return sync(db, sheets, false, pass + 1);
  }
  const requests = relatedPlan(d, snapshot, 104);
  const plan = await planTaskSync(
    {
      tasks: d.tasks,
      categories: d.categories,
      states: d.states,
      conflicts: d.conflicts,
    },
    {
      spreadsheet_id: sheets.id,
      version: snapshot.ticket ?? "",
      rows: snapshot.rows[100],
      grid_rows: snapshot.meta.sheets.find(
        (s: any) => s.properties.sheetId === 100,
      ).properties.gridProperties.rowCount,
    },
  );
  if (plan.identify.length) {
    await sheets.commit(
      snapshot,
      plan.identify.map((p) => cells(100, p.row_index, p.values)),
    );
    return sync(db, sheets, false, pass + 1);
  }
  requests.push(...plan.push.map((p) => cells(100, p.row_index, p.values)));
  for (const incoming of plan.pull) {
    let t = d.tasks.find((t) => t.id === incoming.id);
    if (!t) {
      t = addTask(d, incoming.title, incoming.deadline);
      t.id = incoming.id;
    } else {
      t.revision++;
      t.updated_at = new Date().toISOString();
    }
    t.title = incoming.title;
    t.description = incoming.description;
    t.category_id = category(d, incoming.category);
    t.status = incoming.status;
    t.completed_at =
      t.status === "COMPLETED"
        ? (t.completed_at ?? new Date().toISOString())
        : null;
    t.snooze_until = incoming.snooze_until;
    setDeadline(t, incoming.deadline);
    d.states = d.states.filter((v) => v.entity_id !== t!.id);
    d.states.push({
      entity_id: t.id,
      last_synced_local_revision: t.revision,
      last_synced_remote_hash: incoming.remote_hash,
    });
  }
  requests.push(...relatedPlan(d, snapshot, 101));
  for (const ack of [...plan.acknowledge, ...plan.pushed]) {
    d.states = d.states.filter((v) => v.entity_id !== ack.entity_id);
    d.states.push({
      entity_id: ack.entity_id,
      last_synced_local_revision: ack.local_revision,
      last_synced_remote_hash: ack.remote_hash,
    });
  }
  d.conflicts = d.conflicts.filter(
    (c) => c.entity_type && c.entity_type !== "TASK",
  );
  d.conflicts.push(
    ...plan.conflicts.map(
      (c) =>
        ({
          ...c,
          id: crypto.randomUUID(),
          entity_type: "TASK" as const,
          resolution: null,
        }) satisfies SyncConflict,
    ),
  );
  // A guarded atomic batch handles row writes. Capacity additions precede writes.
  for (const sid of [100, 101, 104]) {
    const max = requests.reduce<number>(
      (m, r: any) =>
        r.updateCells?.start.sheetId === sid
          ? Math.max(m, r.updateCells.start.rowIndex + 1)
          : m,
      0,
    );
    const capacity = snapshot.meta.sheets.find(
      (s: any) => s.properties.sheetId === sid,
    ).properties.gridProperties.rowCount;
    if (max > capacity)
      requests.unshift({
        appendDimension: {
          sheetId: sid,
          dimension: "ROWS",
          length: max - capacity + 100,
        },
      });
  }
  await sheets.commit(snapshot, requests);
  d.lastSync = new Date().toISOString();
  await changeData(db, (current) => Object.assign(current, d), d.revision);
  return { warnings: plan.warnings, conflicts: d.conflicts.length };
}
