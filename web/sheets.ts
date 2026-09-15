import { googleApi } from "./google";
import { TASK_HEADERS } from "../src/lib/googleSyncCore";
export const definitions = [
  { id: 100, title: "タスク一覧", headers: [...TASK_HEADERS, "deadline_data"] },
  {
    id: 101,
    title: "チェック項目",
    headers: [
      "check_item_id",
      "task_id",
      "タスク件名",
      "完了",
      "チェック項目",
      "並び順",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    id: 102,
    title: "予定",
    headers: [
      "event_id",
      "task_id",
      "タスク件名",
      "予定名",
      "開始日時",
      "終了日時",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    id: 103,
    title: "関連リンク",
    headers: [
      "resource_id",
      "task_id",
      "タスク件名",
      "種類",
      "表示名",
      "パス / URL",
      "並び順",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    id: 104,
    title: "分類",
    headers: [
      "category_id",
      "分類名",
      "色",
      "並び順",
      "updated_at",
      "deleted_at",
    ],
  },
  { id: 105, title: "SyncMeta", headers: ["key", "value"] },
  {
    id: 106,
    title: "削除の同期記録",
    headers: [
      "task_id",
      "state",
      "operation_id",
      "changed_at",
      "base_operation_id",
    ],
  },
];
export interface Snapshot {
  meta: any;
  rows: Record<number, string[][]>;
  ticket: string | null;
  fingerprint: string;
}
export const GUARD = "DeadlineDockSyncGuard",
  BOOTSTRAP = "deadline_dock_sync_initialized_v1";
export function cells(sheetId: number, rowIndex: number, values: string[]) {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex: 0 },
      rows: [
        {
          values: values.map((v, i) => ({
            userEnteredValue:
              sheetId === 101 &&
              rowIndex > 0 &&
              i === 3 &&
              ["TRUE", "FALSE"].includes(String(v).toUpperCase())
                ? { boolValue: String(v).toUpperCase() === "TRUE" }
                : { stringValue: String(v) },
          })),
        },
      ],
      fields: "userEnteredValue",
    },
  };
}
export function guardedRequests(ticket: string | null, requests: unknown[]) {
  const range = {
    sheetId: 105,
    startRowIndex: 0,
    endRowIndex: 1,
    startColumnIndex: 0,
    endColumnIndex: 1,
  };
  return [
    ...(ticket ? [{ deleteNamedRange: { namedRangeId: ticket } }] : []),
    ...requests,
    ...(ticket
      ? []
      : [
          {
            addNamedRange: {
              namedRange: {
                namedRangeId: BOOTSTRAP,
                name: "DeadlineDockSyncInitialized",
                range,
              },
            },
          },
        ]),
    {
      addNamedRange: {
        namedRange: {
          namedRangeId: "dd_sync_" + crypto.randomUUID().replaceAll("-", ""),
          name: GUARD,
          range,
        },
      },
    },
  ];
}
export class Sheets {
  constructor(
    public id: string,
    private api: typeof googleApi = googleApi,
  ) {}
  get base() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.id}`;
  }
  async read(): Promise<Snapshot> {
    const meta = await this.api(
      this.base + "?fields=sheets(properties,developerMetadata),namedRanges",
    );
    const ticket =
      meta.namedRanges?.find((n: any) => n.name === GUARD)?.namedRangeId ??
      null;
    if (
      !ticket &&
      meta.namedRanges?.some((n: any) => n.namedRangeId === BOOTSTRAP)
    )
      throw new Error(
        "同期の管理情報が変更されています。PC版の接続設定を確認してください。",
      );
    const ids = definitions.filter((d) =>
      meta.sheets.some((s: any) => s.properties.sheetId === d.id),
    );
    const result = ids.length
      ? await this.api(this.base + "/values:batchGetByDataFilter", {
          dataFilters: ids.map((d) => ({
            gridRange: {
              sheetId: d.id,
              startColumnIndex: 0,
              endColumnIndex: d.headers.length,
            },
          })),
          valueRenderOption: "FORMATTED_VALUE",
        })
      : { valueRanges: [] };
    const rows: Record<number, string[][]> = {};
    for (const v of result.valueRanges ?? []) {
      const id = v.dataFilters[0].gridRange.sheetId;
      rows[id] = (v.valueRange.values ?? []).map((r: unknown[]) =>
        r.map(String),
      );
    }
    for (const d of definitions) rows[d.id] ??= [];
    return { meta, rows, ticket, fingerprint: JSON.stringify(rows) };
  }
  async commit(snapshot: Snapshot, requests: unknown[]) {
    if (!requests.length) return;
    const fresh = await this.read();
    if (
      fresh.ticket !== snapshot.ticket ||
      fresh.fingerprint !== snapshot.fingerprint
    )
      throw new Error(
        "他の端末またはシートで更新されました。もう一度同期してください。",
      );
    const expanded = [...requests];
    for (const sheet of snapshot.meta.sheets) {
      const sid = sheet.properties.sheetId;
      const max = requests.reduce<number>(
        (n, r: any) =>
          r.updateCells?.start.sheetId === sid
            ? Math.max(
                n,
                r.updateCells.start.rowIndex + r.updateCells.rows.length,
              )
            : n,
        0,
      );
      const added = requests.reduce<number>(
        (n, r: any) =>
          r.appendDimension?.sheetId === sid ? n + r.appendDimension.length : n,
        0,
      );
      const capacity = sheet.properties.gridProperties.rowCount + added;
      if (max > capacity)
        expanded.unshift({
          appendDimension: {
            sheetId: sid,
            dimension: "ROWS",
            length: max - capacity + 100,
          },
        });
    }
    await this.api(this.base + ":batchUpdate", {
      requests: guardedRequests(snapshot.ticket, expanded),
    });
  }
  async ensure(repair = false) {
    const s = await this.read();
    const requests: unknown[] = [];
    for (const d of definitions) {
      const existing = s.meta.sheets.find(
        (v: any) => v.properties.sheetId === d.id,
      );
      if (existing && d.id >= 105 && !existing.properties.hidden)
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: d.id, hidden: true },
            fields: "hidden",
          },
        });
      if (d.id === 105 && s.rows[105].length <= 1) {
        requests.push(
          cells(105, 1, ["schema_version", "1"]),
          cells(105, 2, [
            "workspace_id",
            "00000000-0000-4000-8000-000000000001",
          ]),
        );
      }
      if (!existing) {
        if (s.meta.sheets.some((v: any) => v.properties.title === d.title))
          throw new Error(
            `「${d.title}」は同期用とは別のシートです。PC版で作成した同期用ファイルを選んでください。`,
          );
        requests.push({
          addSheet: {
            properties: {
              sheetId: d.id,
              title: d.title,
              gridProperties: {
                rowCount: 1000,
                columnCount: Math.max(26, d.headers.length),
              },
            },
          },
        });
        requests.push(cells(d.id, 0, d.headers));
      } else
        for (let i = 0; i < d.headers.length; i++) {
          const actual = s.rows[d.id][0]?.[i] ?? "";
          if (actual && actual !== d.headers[i])
            throw new Error(
              `「${d.title}」の${i + 1}列目の見出しを「${d.headers[i]}」へ戻してください。`,
            );
          if (!actual)
            requests.push({
              updateCells: {
                start: { sheetId: d.id, rowIndex: 0, columnIndex: i },
                rows: [
                  {
                    values: [
                      { userEnteredValue: { stringValue: d.headers[i] } },
                    ],
                  },
                ],
                fields: "userEnteredValue",
              },
            });
        }
      if (
        !existing?.developerMetadata?.some(
          (m: any) => m.metadataKey === "deadlineDockGeneration",
        )
      )
        requests.push({
          createDeveloperMetadata: {
            developerMetadata: {
              metadataKey: "deadlineDockGeneration",
              metadataValue:
                (existing ? "adopted:" : "created:") + crypto.randomUUID(),
              location: { sheetId: d.id },
              visibility: "DOCUMENT",
            },
          },
        });
      if (repair || !existing) {
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: d.id,
              hidden: d.id >= 105,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: "hidden,gridProperties.frozenRowCount",
          },
        });
        requests.push({
          repeatCell: {
            range: {
              sheetId: d.id,
              endRowIndex: 1,
              endColumnIndex: d.headers.length,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.19, green: 0.24, blue: 0.2 },
                textFormat: {
                  bold: true,
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                },
                wrapStrategy: "CLIP",
              },
            },
            fields: "userEnteredFormat",
          },
        });
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId: d.id,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: d.headers.length,
            },
            properties: { pixelSize: 160 },
            fields: "pixelSize",
          },
        });
        if (d.id < 105) {
          const idsEnd = d.id === 100 || d.id === 104 ? 1 : 2;
          requests.push({
            updateDimensionProperties: {
              range: {
                sheetId: d.id,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: idsEnd,
              },
              properties: { hiddenByUser: true },
              fields: "hiddenByUser",
            },
          });
          const titleColumn =
            d.id === 100 || d.id === 104 ? 1 : d.id === 101 ? 4 : 3;
          requests.push({
            updateDimensionProperties: {
              range: {
                sheetId: d.id,
                dimension: "COLUMNS",
                startIndex: titleColumn,
                endIndex: titleColumn + 1,
              },
              properties: { pixelSize: 300 },
              fields: "pixelSize",
            },
          });
          const metadataStart =
            d.id === 100 ? 7 : d.id === 101 ? 5 : d.id === 104 ? 4 : 6;
          if (metadataStart < d.headers.length)
            requests.push({
              updateDimensionProperties: {
                range: {
                  sheetId: d.id,
                  dimension: "COLUMNS",
                  startIndex: metadataStart,
                  endIndex: d.headers.length,
                },
                properties: { hiddenByUser: true },
                fields: "hiddenByUser",
              },
            });
        }
        if (d.id === 100) {
          requests.push({
            setDataValidation: {
              range: {
                sheetId: 100,
                startRowIndex: 1,
                startColumnIndex: 3,
                endColumnIndex: 4,
              },
              rule: {
                condition: {
                  type: "ONE_OF_LIST",
                  values: ["未着手", "作業中", "完了"].map(
                    (userEnteredValue) => ({ userEnteredValue }),
                  ),
                },
                strict: true,
                showCustomUi: true,
              },
            },
          });
        }
        if (d.id === 101) {
          requests.push({
            setDataValidation: {
              range: {
                sheetId: 101,
                startRowIndex: 1,
                startColumnIndex: 3,
                endColumnIndex: 4,
              },
              rule: {
                condition: { type: "BOOLEAN" },
                strict: true,
                showCustomUi: true,
              },
            },
          });
        }
      }
    }
    await this.commit(s, requests);
    return this.read();
  }
}
