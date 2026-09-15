//! Non-destructive sheet setup and explicit layout repair.
use crate::{
    google::{self, DB_ERROR, WORKSPACE},
    task_sync::request_json,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::BTreeMap;

fn definitions() -> Vec<(i64, &'static str, Vec<&'static str>)> {
    vec![
        (
            100,
            "タスク一覧",
            vec![
                "task_id",
                "件名",
                "締切",
                "ステータス",
                "分類",
                "作業内容",
                "表示開始",
                "延期回数",
                "登録日",
                "更新日",
                "完了日",
                "revision",
                "deleted_at",
                "deadline_data",
            ],
        ),
        (
            101,
            "チェック項目",
            vec![
                "check_item_id",
                "task_id",
                "タスク件名",
                "完了",
                "チェック項目",
                "並び順",
                "updated_at",
                "deleted_at",
            ],
        ),
        (
            102,
            "予定",
            vec![
                "event_id",
                "task_id",
                "タスク件名",
                "予定名",
                "開始日時",
                "終了日時",
                "updated_at",
                "deleted_at",
            ],
        ),
        (
            103,
            "関連リンク",
            vec![
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
        ),
        (
            104,
            "分類",
            vec![
                "category_id",
                "分類名",
                "色",
                "並び順",
                "updated_at",
                "deleted_at",
            ],
        ),
        (105, "SyncMeta", vec!["key", "value"]),
        (
            106,
            "削除の同期記録",
            vec![
                "task_id",
                "state",
                "operation_id",
                "changed_at",
                "base_operation_id",
            ],
        ),
    ]
}

const GENERATION: &str = "deadlineDockGeneration";
fn header_repairs(sid: i64, headers: &[&str], sheet: &Value) -> Result<Vec<Value>, String> {
    let values = &sheet["data"][0]["rowData"][0]["values"];
    let mut requests = vec![];
    for (col, expected) in headers.iter().enumerate() {
        let cell = &values[col]["userEnteredValue"];
        let text = cell["stringValue"].as_str().unwrap_or("");
        if text == *expected {
            continue;
        }
        if !cell.is_null() && cell != &json!({}) && cell != &json!({"stringValue":""}) {
            return Err(format!("「{}」の見出し・列の順序が変更されています（{}列目）。内容を保護するため同期を止めました。見出しを「{}」へ戻してください。",sheet["properties"]["title"].as_str().unwrap_or("同期シート"),col+1,expected));
        }
        requests.push(json!({"updateCells":{"start":{"sheetId":sid,"rowIndex":0,"columnIndex":col},"rows":[{"values":[{"userEnteredValue":{"stringValue":expected}}]}],"fields":"userEnteredValue"}}));
    }
    Ok(requests)
}
fn layout(sid: i64, width: usize) -> Vec<Value> {
    let forest = json!({"red":0.19,"green":0.24,"blue":0.20});
    let mut r = vec![
        json!({"updateSheetProperties":{"properties":{"sheetId":sid,"hidden":sid>=105,"gridProperties":{"frozenRowCount":1,"frozenColumnCount":if sid==100 {2} else if sid==104 || sid>=105 {0} else {3},"hideGridlines":false},"tabColorStyle":{"rgbColor":forest}},"fields":"hidden,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines,tabColorStyle"}}),
        json!({"repeatCell":{"range":{"sheetId":sid,"endColumnIndex":width},"cell":{"userEnteredFormat":{"textFormat":{"fontFamily":"Arial","fontSize":10},"verticalAlignment":"MIDDLE","wrapStrategy":"CLIP"}},"fields":"userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy"}}),
        json!({"repeatCell":{"range":{"sheetId":sid,"endRowIndex":1,"endColumnIndex":width},"cell":{"userEnteredFormat":{"backgroundColor":forest,"textFormat":{"bold":true,"foregroundColor":{"red":1,"green":1,"blue":1}},"verticalAlignment":"MIDDLE"}},"fields":"userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.verticalAlignment"}}),
        json!({"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"ROWS","startIndex":0,"endIndex":1},"properties":{"pixelSize":38},"fields":"pixelSize"}}),
        json!({"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"COLUMNS","startIndex":0,"endIndex":width},"properties":{"hiddenByUser":false,"pixelSize":140},"fields":"hiddenByUser,pixelSize"}}),
    ];
    if sid >= 105 {
        return r;
    }
    r.push(json!({"setBasicFilter":{"filter":{"range":{"sheetId":sid,"startRowIndex":0,"endColumnIndex":width}}}}));
    let hidden = match sid {
        100 => vec![(0, 1), (7, 14)],
        104 => vec![(0, 1), (3, 6)],
        101 => vec![(0, 2), (5, 8)],
        102 => vec![(0, 2), (6, 8)],
        _ => vec![(0, 2), (6, 9)],
    };
    for (start, end) in hidden {
        r.push(json!({"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"COLUMNS","startIndex":start,"endIndex":end},"properties":{"hiddenByUser":true},"fields":"hiddenByUser"}}));
    }
    let widths: Vec<(usize, usize)> = match sid {
        100 => vec![(1, 300), (2, 130), (3, 110), (4, 150), (5, 380), (6, 170)],
        101 => vec![(2, 260), (3, 70), (4, 380)],
        102 => vec![(2, 260), (3, 260), (4, 180), (5, 180)],
        103 => vec![(2, 260), (3, 100), (4, 220), (5, 400)],
        _ => vec![(1, 220), (2, 120)],
    };
    for (col, size) in widths {
        r.push(json!({"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"COLUMNS","startIndex":col,"endIndex":col+1},"properties":{"pixelSize":size},"fields":"pixelSize"}}));
    }
    if sid == 100 {
        r.push(json!({"setDataValidation":{"range":{"sheetId":sid,"startRowIndex":1,"startColumnIndex":3,"endColumnIndex":4},"rule":{"condition":{"type":"ONE_OF_LIST","values":[{"userEnteredValue":"未着手"},{"userEnteredValue":"作業中"},{"userEnteredValue":"完了"}]},"strict":true,"showCustomUi":true}}}));
        for (col, note) in [
            (
                1,
                "ここに件名を入力するだけでタスクを追加できます。IDはアプリが設定します。",
            ),
            (
                2,
                "例：2026/09/30。空欄の新規タスクは「急ぎではない」で取り込みます。",
            ),
            (5, "作業の手順やメモを入力できます。"),
            (6, "表示を開始する日時（任意）。"),
        ] {
            r.push(json!({"updateCells":{"start":{"sheetId":sid,"rowIndex":0,"columnIndex":col},"rows":[{"values":[{"note":note}]}],"fields":"note"}}));
        }
    }
    if sid == 101 {
        r.push(json!({"setDataValidation":{"range":{"sheetId":sid,"startRowIndex":1,"startColumnIndex":3,"endColumnIndex":4},"rule":{"condition":{"type":"BOOLEAN"},"strict":true,"showCustomUi":true}}}));
    }
    if sid == 102 || sid == 103 {
        r.push(json!({"updateCells":{"start":{"sheetId":sid,"rowIndex":0,"columnIndex":2},"rows":[{"values":[{"note":"内容の双方向同期は準備中です。アプリで親タスクを削除した際の行の整理には対応しています。"}]}],"fields":"note"}}));
    }
    r
}
fn generation(sheet: &Value) -> Result<Option<String>, String> {
    let entries: Vec<_> = sheet["developerMetadata"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["metadataKey"] == GENERATION)
        .collect();
    if entries.len() > 1 {
        return Err("同期シートの識別情報が重複しています。".into());
    }
    Ok(entries
        .first()
        .and_then(|m| m["metadataValue"].as_str())
        .map(str::to_owned))
}
async fn remember(
    db: &SqlitePool,
    id: &str,
    generations: &BTreeMap<i64, String>,
) -> Result<(), String> {
    let mut tx = db.begin().await.map_err(|_| DB_ERROR)?;
    for (sid, current) in generations {
        let previous: Option<String> = sqlx::query_scalar(
            "SELECT generation FROM sync_sheet_generations WHERE spreadsheet_id=? AND sheet_id=?",
        )
        .bind(id)
        .bind(sid)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| DB_ERROR)?;
        // A new sheet incarnation has no old remote rows. Reset only its baseline
        // so retained local records can repopulate it, even after a lost reply.
        if previous.as_ref() != Some(current)
            && (previous.is_some() || current.starts_with("created:"))
        {
            let entity = match sid {
                100 => Some("TASK"),
                101 => Some("CHECK_ITEM"),
                104 => Some("CATEGORY"),
                _ => None,
            };
            if let Some(entity) = entity {
                let table = if *sid == 100 {
                    "sync_entity_state"
                } else {
                    "related_sync_state"
                };
                sqlx::query(&format!("DELETE FROM {table} WHERE entity_type=?"))
                    .bind(entity)
                    .execute(&mut *tx)
                    .await
                    .map_err(|_| DB_ERROR)?;
                sqlx::query("DELETE FROM sync_conflicts WHERE entity_type=?")
                    .bind(entity)
                    .execute(&mut *tx)
                    .await
                    .map_err(|_| DB_ERROR)?;
            }
        }
        sqlx::query("INSERT INTO sync_sheet_generations(spreadsheet_id,sheet_id,generation) VALUES(?,?,?) ON CONFLICT(spreadsheet_id,sheet_id) DO UPDATE SET generation=excluded.generation").bind(id).bind(sid).bind(current).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    }
    tx.commit().await.map_err(|_| DB_ERROR)?;
    Ok(())
}
pub(crate) async fn ensure(
    db: &SqlitePool,
    token: &str,
    id: &str,
    repair: bool,
) -> Result<(), String> {
    let http = google::client()?;
    let endpoint = format!("https://sheets.googleapis.com/v4/spreadsheets/{id}");
    let metadata = request_json(
        http.get(&endpoint)
            .query(&[("fields", "sheets(properties,developerMetadata)")])
            .bearer_auth(token),
        true,
    )
    .await?;
    let sheets = metadata["sheets"]
        .as_array()
        .ok_or("シート情報を読み取れません。")?;
    let defs = definitions();
    let filters: Vec<_> = sheets
        .iter()
        .filter_map(|s| s["properties"]["sheetId"].as_i64())
        .filter(|sid| defs.iter().any(|d| d.0 == *sid))
        .map(|sid| json!({"gridRange":{"sheetId":sid,"startRowIndex":0,"endRowIndex":1}}))
        .collect();
    let headers = if filters.is_empty() {
        json!({"sheets":[]})
    } else {
        request_json(
            http.post(format!("{endpoint}:getByDataFilter"))
                .bearer_auth(token)
                .json(&json!({"dataFilters":filters,"includeGridData":true})),
            true,
        )
        .await?
    };
    let mut requests = vec![];
    let mut generations = BTreeMap::new();
    for (sid, title, header) in defs {
        let existing = sheets.iter().find(|s| s["properties"]["sheetId"] == sid);
        if existing.is_none() && sheets.iter().any(|s| s["properties"]["title"] == title) {
            return Err(format!("「{title}」と同名の別タブがあります。内容を保護するため追加を止めました。既存タブの名前を変更してから再同期してください。"));
        }
        if let Some(sheet) = existing {
            if sheet["properties"]["sheetType"]
                .as_str()
                .is_some_and(|s| s != "GRID")
            {
                return Err(format!("「{title}」は通常の表ではありません。"));
            }
            let count = sheet["properties"]["gridProperties"]["columnCount"]
                .as_u64()
                .unwrap_or(0) as usize;
            let rows = sheet["properties"]["gridProperties"]["rowCount"]
                .as_u64()
                .unwrap_or(1);
            if rows < 2 {
                requests.push(
                    json!({"appendDimension":{"sheetId":sid,"dimension":"ROWS","length":2-rows}}),
                );
            }
            if count < header.len() {
                requests.push(json!({"appendDimension":{"sheetId":sid,"dimension":"COLUMNS","length":header.len()-count}}));
            }
            let row = headers["sheets"]
                .as_array()
                .and_then(|v| v.iter().find(|s| s["properties"]["sheetId"] == sid))
                .ok_or("見出しを読み取れません。")?;
            requests.extend(header_repairs(sid, &header, row)?);
        } else {
            requests.push(json!({"addSheet":{"properties":{"sheetId":sid,"title":title,"hidden":sid>=105,"gridProperties":{"rowCount":1000,"columnCount":header.len().max(14)}}}}));
            requests.push(json!({"updateCells":{"start":{"sheetId":sid,"rowIndex":0,"columnIndex":0},"rows":[{"values":header.iter().map(|s|json!({"userEnteredValue":{"stringValue":s}})).collect::<Vec<_>>()}],"fields":"userEnteredValue"}}));
            if sid == 105 {
                requests.push(json!({"updateCells":{"start":{"sheetId":sid,"rowIndex":1,"columnIndex":0},"rows":[{"values":[{"userEnteredValue":{"stringValue":"schema_version"}},{"userEnteredValue":{"stringValue":"1"}}]},{"values":[{"userEnteredValue":{"stringValue":"workspace_id"}},{"userEnteredValue":{"stringValue":WORKSPACE}}]}],"fields":"userEnteredValue"}}));
            }
        }
        let stamp = if let Some(stamp) = existing.map(generation).transpose()?.flatten() {
            stamp
        } else {
            let stamp = format!(
                "{}:{}",
                if existing.is_some() {
                    "adopted"
                } else {
                    "created"
                },
                uuid::Uuid::new_v4()
            );
            requests.push(json!({"createDeveloperMetadata":{"developerMetadata":{"metadataKey":GENERATION,"metadataValue":stamp,"location":{"sheetId":sid},"visibility":"DOCUMENT"}}}));
            stamp
        };
        generations.insert(sid, stamp);
        if existing.is_none() || repair {
            requests.extend(layout(sid, header.len()));
        }
    }
    if repair || !sheets.iter().any(|s| s["properties"]["sheetId"] == 100) {
        requests.push(json!({"updateSpreadsheetProperties":{"properties":{"locale":"ja_JP","timeZone":"Asia/Tokyo"},"fields":"locale,timeZone"}}));
        requests.push(json!({"updateSheetProperties":{"properties":{"sheetId":100,"index":0},"fields":"index"}}));
    }
    if sheets.iter().any(|s| {
        s["properties"]["sheetId"] == 0
            && matches!(
                s["properties"]["title"].as_str(),
                Some("Sheet1" | "シート1")
            )
    }) {
        let default = request_json(
            http.post(format!("{endpoint}:getByDataFilter"))
                .bearer_auth(token)
                .json(&json!({"dataFilters":[{"gridRange":{"sheetId":0}}],"includeGridData":true})),
            true,
        )
        .await?;
        if default["sheets"]
            .as_array()
            .is_some_and(|s| s.len() == 1 && google::empty_default_sheet(&s[0]))
        {
            requests.push(json!({"deleteSheet":{"sheetId":0}}));
        }
    }
    if !requests.is_empty() {
        request_json(
            http.post(format!("{endpoint}:batchUpdate"))
                .bearer_auth(token)
                .json(&json!({"requests":requests})),
            false,
        )
        .await?;
    }
    remember(db, id, &generations).await?;
    Ok(())
}
#[tauri::command]
pub async fn google_repair_sheet(
    app: tauri::AppHandle,
    state: tauri::State<'_, google::GoogleState>,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    let id = crate::task_sync::connected_id(&db).await?;
    let token = google::access_token(&db).await?;
    ensure(&db, &token, &id, true).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_headers_are_restored_but_data_is_never_overwritten() {
        let blank = json!({"data":[{"rowData":[{"values":[]}]}]});
        assert_eq!(
            header_repairs(100, &["task_id", "件名"], &blank)
                .unwrap()
                .len(),
            2
        );
        let moved = json!({"data":[{"rowData":[{"values":[{"userEnteredValue":{"stringValue":"a-task-uuid"}},{"userEnteredValue":{"stringValue":"My task"}}]}]}]});
        assert!(header_repairs(100, &["task_id", "件名"], &moved).is_err());
        let formula =
            json!({"data":[{"rowData":[{"values":[{"userEnteredValue":{"formulaValue":"=1"}}]}]}]});
        assert!(header_repairs(100, &["task_id"], &formula).is_err());
    }
    #[test]
    fn layout_never_writes_task_values_or_deletes_rows() {
        for (sid, _, header) in definitions() {
            for request in layout(sid, header.len()) {
                assert!(request.get("deleteDimension").is_none());
                if let Some(repeat) = request.get("repeatCell") {
                    assert!(!repeat["fields"]
                        .as_str()
                        .unwrap()
                        .contains("userEnteredValue"));
                }
                if let Some(update) = request.get("updateCells") {
                    assert_eq!(update["start"]["rowIndex"], 0);
                    assert_eq!(update["fields"], "note");
                }
            }
        }
    }
    #[test]
    fn recreated_tabs_reset_only_their_baselines_and_only_once() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let db=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
            sqlx::raw_sql("CREATE TABLE sync_entity_state(entity_type TEXT);CREATE TABLE related_sync_state(entity_type TEXT);CREATE TABLE sync_conflicts(entity_type TEXT);").execute(&db).await.unwrap();
            sqlx::raw_sql(include_str!("../migrations/0011_sheet_generations.sql")).execute(&db).await.unwrap();
            sqlx::raw_sql("INSERT INTO sync_entity_state VALUES('TASK');INSERT INTO related_sync_state VALUES('CATEGORY'),('CHECK_ITEM');").execute(&db).await.unwrap();
            remember(&db,"sheet",&BTreeMap::from([(100,"adopted:old".into()),(101,"created:new".into())])).await.unwrap();
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM sync_entity_state").fetch_one(&db).await.unwrap(),1);
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM related_sync_state").fetch_one(&db).await.unwrap(),1);
            sqlx::query("INSERT INTO related_sync_state VALUES('CHECK_ITEM')").execute(&db).await.unwrap();
            remember(&db,"sheet",&BTreeMap::from([(101,"created:new".into()),(100,"created:replacement".into())])).await.unwrap();
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM sync_entity_state").fetch_one(&db).await.unwrap(),0);
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM related_sync_state").fetch_one(&db).await.unwrap(),2);
        });
    }
}
