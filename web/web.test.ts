import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  addTask,
  changeData,
  emptyData,
  openStore,
  readData,
  removeTask,
  type Life,
} from "./store";
import {
  BOOTSTRAP,
  GUARD,
  definitions,
  guardedRequests,
  Sheets,
} from "./sheets";
import { chooseLife, sync } from "./sync";

function fakeSheets() {
  let state: any = {
    meta: {
      sheets: definitions.map((d) => ({
        properties: {
          sheetId: d.id,
          title: d.title,
          gridProperties: { rowCount: 1000 },
        },
        developerMetadata: [
          {
            metadataKey: "deadlineDockGeneration",
            metadataValue: "created:test-" + d.id,
          },
        ],
      })),
      namedRanges: [],
    },
    rows: Object.fromEntries(definitions.map((d) => [d.id, [d.headers]])),
  };
  const api: any = async (url: string, body: any) => {
    if (url.includes("batchGetByDataFilter"))
      return {
        valueRanges: body.dataFilters.map((f: any) => ({
          dataFilters: [f],
          valueRange: {
            values: structuredClone(state.rows[f.gridRange.sheetId]),
          },
        })),
      };
    if (url.endsWith(":batchUpdate")) {
      const next = structuredClone(state);
      for (const r of body.requests) {
        if (r.deleteNamedRange) {
          if (
            !next.meta.namedRanges.some(
              (v: any) => v.namedRangeId === r.deleteNamedRange.namedRangeId,
            )
          )
            throw new Error("stale guard");
          next.meta.namedRanges = next.meta.namedRanges.filter(
            (v: any) => v.namedRangeId !== r.deleteNamedRange.namedRangeId,
          );
        }
        if (r.addNamedRange) {
          if (
            next.meta.namedRanges.some(
              (v: any) =>
                v.namedRangeId === r.addNamedRange.namedRange.namedRangeId,
            )
          )
            throw new Error("duplicate guard");
          next.meta.namedRanges.push(r.addNamedRange.namedRange);
        }
        if (r.updateCells) {
          const c = r.updateCells;
          const rows = next.rows[c.start.sheetId];
          while (rows.length <= c.start.rowIndex) rows.push([]);
          c.rows[0].values.forEach(
            (v: any, i: number) =>
              (rows[c.start.rowIndex][c.start.columnIndex + i] =
                v.userEnteredValue.stringValue ??
                (v.userEnteredValue.boolValue ? "TRUE" : "FALSE")),
          );
        }
        if (r.deleteDimension) {
          const v = r.deleteDimension.range;
          next.rows[v.sheetId].splice(v.startIndex, v.endIndex - v.startIndex);
        }
        if (r.addSheet) {
          next.meta.sheets.push({
            properties: r.addSheet.properties,
            developerMetadata: [],
          });
          next.rows[r.addSheet.properties.sheetId] = [];
        }
        if (r.createDeveloperMetadata) {
          const m = r.createDeveloperMetadata.developerMetadata;
          next.meta.sheets
            .find((s: any) => s.properties.sheetId === m.location.sheetId)
            .developerMetadata.push(m);
        }
      }
      state = next;
      return {};
    }
    return structuredClone(state.meta);
  };
  return {
    sheets: new Sheets("test", api),
    get state() {
      return state;
    },
    api,
  };
}
describe("browser persistence and inter-device synchronization", () => {
  it("ignores unused checkbox grid cells and assigns IDs to sheet-entered records", async () => {
    const remote = fakeSheets(),
      db = await openStore(crypto.randomUUID());
    remote.state.rows[100].push(["", "シートで登録"]);
    remote.state.rows[101].push(["", "", "シートで登録", "FALSE", "チェック"]);
    remote.state.rows[101].push(["", "", "", "FALSE"]);
    remote.state.rows[104].push(["", "オフィス"]);
    await sync(db, remote.sheets);
    const d = await readData(db);
    expect(d.tasks[0].deadline_label).toBe("急ぎではない");
    expect(d.checks).toHaveLength(1);
    expect(d.checks[0].task_id).toBe(d.tasks[0].id);
    expect(d.categories[0].name).toBe("オフィス");
    db.close();
  });
  it("persists rapid edits in transactions and survives reopening", async () => {
    const name = crypto.randomUUID();
    let db = await openStore(name);
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        changeData(db, (d) => {
          addTask(d, "件名 " + i);
        }),
      ),
    );
    expect((await readData(db)).tasks).toHaveLength(30);
    db.close();
    db = await openStore(name);
    const d = await readData(db);
    expect(d.tasks[0].deadline_label).toBe("急ぎではない");
    expect(d.revision).toBe(30);
    db.close();
  });
  it("rejects stale writes and preserves unknown formats", async () => {
    const db = await openStore(crypto.randomUUID());
    await changeData(db, (d) => {
      addTask(d, "keep");
    });
    await expect(
      changeData(
        db,
        (d) => {
          d.tasks = [];
        },
        0,
      ),
    ).rejects.toThrow("別の画面");
    expect((await readData(db)).tasks).toHaveLength(1);
    await new Promise<void>((resolve) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(
        { formatVersion: 999, tasks: ["original"] },
        "data",
      );
      tx.oncomplete = () => resolve();
    });
    await expect(
      changeData(db, (d) => {
        d.tasks = [];
      }),
    ).rejects.toThrow("保存形式");
    db.close();
  });
  it("cascades deletion and undo only to children deleted with the task", () => {
    const d = emptyData(),
      t = addTask(d, "parent");
    d.checks = [
      {
        id: "a",
        task_id: t.id,
        text: "active",
        checked: 0,
        sort_order: 0,
        created_at: t.created_at,
        updated_at: t.updated_at,
      },
      {
        id: "b",
        task_id: t.id,
        text: "old",
        checked: 0,
        sort_order: 1,
        created_at: t.created_at,
        updated_at: t.updated_at,
        deleted_at: "2020-01-01T00:00:00Z",
      },
    ];
    removeTask(d, t.id);
    expect(d.checks[0].deleted_at).toBe(t.deleted_at);
    removeTask(d, t.id, true);
    expect(d.checks[0].deleted_at).toBeNull();
    expect(d.checks[1].deleted_at).toBe("2020-01-01T00:00:00Z");
    expect(d.life[0].base_operation_id).not.toBe("");
  });
  it("honors native deletion/undo operation identities", () => {
    const remote: Life = {
      task_id: crypto.randomUUID(),
      state: "DELETED",
      operation_id: "remote",
      base_operation_id: "",
      changed_at: new Date().toISOString(),
      dirty: false,
    };
    expect(
      chooseLife(
        { ...remote, state: "ACTIVE", operation_id: "stale", dirty: false },
        remote,
      ),
    ).toBe(remote);
    const undo = {
      ...remote,
      state: "ACTIVE" as const,
      operation_id: "undo",
      base_operation_id: "remote",
      dirty: true,
    };
    expect(chooseLife(undo, remote)).toBe(undo);
    expect(chooseLife({ ...undo, base_operation_id: "older" }, remote)).toBe(
      remote,
    );
  });
  it("roundtrips tasks, notes, categories and checks across two independent stores", async () => {
    const remote = fakeSheets(),
      a = await openStore(crypto.randomUUID()),
      b = await openStore(crypto.randomUUID());
    let id = "";
    await changeData(a, (d) => {
      const t = addTask(d, "mobile");
      id = t.id;
      t.description = "notes";
      const cid = crypto.randomUUID();
      d.categories.push({
        id: cid,
        workspace_id: t.workspace_id,
        name: "仕事",
        color: "blue",
        sort_order: 0,
        created_at: t.created_at,
        updated_at: t.updated_at,
      });
      t.category_id = cid;
      d.checks.push({
        id: crypto.randomUUID(),
        task_id: t.id,
        text: "check",
        checked: 1,
        sort_order: 0,
        created_at: t.created_at,
        updated_at: t.updated_at,
      });
    });
    await sync(a, remote.sheets);
    await sync(b, remote.sheets);
    let d = await readData(b);
    expect(d.tasks[0].description).toBe("notes");
    expect(d.categories[0].name).toBe("仕事");
    expect(d.checks[0].checked).toBe(1);
    await changeData(b, (d) => {
      d.tasks[0].description = "changed on B";
      d.tasks[0].revision++;
    });
    await sync(b, remote.sheets);
    await sync(a, remote.sheets);
    expect((await readData(a)).tasks[0].description).toBe("changed on B");
    expect(remote.state.meta.namedRanges).toHaveLength(2);
    remote.state.rows[102].push([crypto.randomUUID(), id, "mobile", "meeting"]);
    remote.state.rows[103].push([crypto.randomUUID(), id, "mobile", "URL"]);
    await changeData(a, (d) => removeTask(d, id));
    await sync(a, remote.sheets);
    for (const sid of [100, 101, 102, 103])
      expect(remote.state.rows[sid]).toHaveLength(1);
    await sync(b, remote.sheets);
    expect((await readData(b)).tasks[0].deleted_at).toBeTruthy();
    await sync(b, remote.sheets);
    expect(remote.state.rows[100]).toHaveLength(1);
    a.close();
    b.close();
  });
  it("keeps conflicting changes until explicitly resolved", async () => {
    const remote = fakeSheets(),
      a = await openStore(crypto.randomUUID()),
      b = await openStore(crypto.randomUUID());
    await changeData(a, (d) => {
      addTask(d, "original");
    });
    await sync(a, remote.sheets);
    await sync(b, remote.sheets);
    await changeData(a, (d) => {
      d.tasks[0].title = "A";
      d.tasks[0].revision++;
    });
    await changeData(b, (d) => {
      d.tasks[0].title = "B";
      d.tasks[0].revision++;
    });
    await sync(a, remote.sheets);
    const result = await sync(b, remote.sheets);
    expect(result.conflicts).toBe(1);
    expect((await readData(b)).tasks[0].title).toBe("B");
    expect(remote.state.rows[100][1][1]).toBe("A");
    await changeData(b, (d) => {
      d.conflicts[0].resolution = "LOCAL";
    });
    await sync(b, remote.sheets);
    expect(remote.state.rows[100][1][1]).toBe("B");
    a.close();
    b.close();
  });
  it("rejects stale native-compatible guard tickets atomically", async () => {
    const remote = fakeSheets();
    const first = guardedRequests(null, []);
    await remote.api("x:batchUpdate", { requests: first });
    await expect(
      remote.api("x:batchUpdate", { requests: first }),
    ).rejects.toThrow("duplicate");
    const guard = remote.state.meta.namedRanges.find(
      (n: any) => n.name === GUARD,
    ).namedRangeId;
    expect(
      remote.state.meta.namedRanges.some(
        (n: any) => n.namedRangeId === BOOTSTRAP,
      ),
    ).toBe(true);
    await remote.api("x:batchUpdate", { requests: guardedRequests(guard, []) });
    await expect(
      remote.api("x:batchUpdate", { requests: guardedRequests(guard, []) }),
    ).rejects.toThrow("stale");
    expect(remote.state.meta.namedRanges).toHaveLength(2);
  });
  it("repairs missing sheets but rejects renamed column headers", async () => {
    const remote = fakeSheets();
    remote.state.meta.sheets = remote.state.meta.sheets.filter(
      (s: any) => s.properties.sheetId !== 101,
    );
    delete remote.state.rows[101];
    await remote.sheets.ensure();
    expect(remote.state.rows[101][0]).toEqual(definitions[1].headers);
    remote.state.rows[100][0][1] = "incorrect";
    await expect(remote.sheets.ensure()).rejects.toThrow("見出し");
  });
});
