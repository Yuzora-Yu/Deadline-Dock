//! Category/checklist synchronization, with per-entity baselines and reviewed conflicts.
use crate::google::{self, GoogleState, DB_ERROR, WORKSPACE};
use crate::task_sync::{connected_id, request_json};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::State;

type Cells = Vec<String>;
// Sheets supplies FALSE for the unused cells in a checkbox-validated column.
// A ticked box, text, IDs or formulas still make the row meaningful.
fn empty_row(kind: Kind, row: &[String]) -> bool {
    row.iter().enumerate().all(|(col, value)| {
        value.is_empty() || (kind == Kind::Check && col == 3 && value == "FALSE")
    })
}
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Kind {
    Category,
    Check,
}
impl Kind {
    fn name(self) -> &'static str {
        if self == Self::Category {
            "CATEGORY"
        } else {
            "CHECK_ITEM"
        }
    }
    fn title(self) -> &'static str {
        if self == Self::Category {
            "分類"
        } else {
            "チェック項目"
        }
    }
    fn sid(self) -> i64 {
        if self == Self::Category {
            104
        } else {
            101
        }
    }
    fn headers(self) -> Vec<&'static str> {
        if self == Self::Category {
            vec![
                "category_id",
                "分類名",
                "色",
                "並び順",
                "updated_at",
                "deleted_at",
            ]
        } else {
            vec![
                "check_item_id",
                "task_id",
                "タスク件名",
                "完了",
                "チェック項目",
                "並び順",
                "updated_at",
                "deleted_at",
            ]
        }
    }
}
fn semantic(kind: Kind, row: &[String]) -> Cells {
    row.iter()
        .enumerate()
        .filter(|(i, _)| {
            if kind == Kind::Category {
                *i != 4
            } else {
                *i != 2 && *i != 6
            }
        })
        .map(|(_, v)| v.clone())
        .collect()
}
fn encoded(row: &[String]) -> String {
    json!(row).to_string()
}
fn optional(value: &str) -> Option<&str> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
fn valid(kind: Kind, row: &[String]) -> Result<(), String> {
    if row.len() != kind.headers().len() || row.iter().any(|s| s.len() > 50000) {
        return Err("列の形式が不正です。".into());
    }
    uuid::Uuid::parse_str(&row[0]).map_err(|_| "IDが不正です。")?;
    let order = if kind == Kind::Category { 3 } else { 5 };
    if row[order]
        .parse::<i64>()
        .ok()
        .is_none_or(|v| !(0..=100000).contains(&v))
    {
        return Err("並び順は0〜100000の整数にしてください。".into());
    }
    if !row.last().unwrap().is_empty()
        && chrono::DateTime::parse_from_rfc3339(row.last().unwrap()).is_err()
    {
        return Err("削除日時が不正です。".into());
    }
    if kind == Kind::Category {
        if row[1].trim().is_empty() || row[1].len() > 800 {
            return Err("分類名が空、または長すぎます。".into());
        }
        if ![
            "slate", "blue", "cyan", "green", "lime", "yellow", "orange", "red", "pink", "purple",
        ]
        .contains(&row[2].as_str())
        {
            return Err("色はslate/blue/cyan/green/lime/yellow/orange/red/pink/purpleから指定してください。".into());
        }
    } else {
        uuid::Uuid::parse_str(&row[1]).map_err(|_| "親タスクIDが不正です。")?;
        if !["TRUE", "FALSE"].contains(&row[3].as_str()) || row[4].trim().is_empty() {
            return Err("チェック項目と完了チェックを確認してください。".into());
        }
    }
    Ok(())
}
pub(crate) async fn local_rows(
    db: &SqlitePool,
    kind: Kind,
) -> Result<BTreeMap<String, Cells>, String> {
    let query = if kind == Kind::Category {
        "SELECT id,name,color,sort_order,updated_at,deleted_at FROM categories WHERE workspace_id=? ORDER BY sort_order,id"
    } else {
        "SELECT c.*,t.title,t.deleted_at AS parent_deleted FROM task_check_items c JOIN tasks t ON t.id=c.task_id WHERE t.workspace_id=? AND t.deleted_at IS NULL ORDER BY c.sort_order,c.id"
    };
    let mut result = BTreeMap::new();
    for r in sqlx::query(query)
        .bind(WORKSPACE)
        .fetch_all(db)
        .await
        .map_err(|_| DB_ERROR)?
    {
        let id: String = r.get("id");
        let deleted: Option<String> = r.get("deleted_at");
        let cells = if kind == Kind::Category {
            vec![
                id.clone(),
                r.get("name"),
                r.get("color"),
                r.get::<i64, _>("sort_order").to_string(),
                r.get("updated_at"),
                deleted.unwrap_or_default(),
            ]
        } else {
            vec![
                id.clone(),
                r.get("task_id"),
                r.get("title"),
                if r.get::<i64, _>("checked") == 1 {
                    "TRUE"
                } else {
                    "FALSE"
                }
                .into(),
                r.get("text"),
                r.get::<i64, _>("sort_order").to_string(),
                r.get("updated_at"),
                deleted.or(r.get("parent_deleted")).unwrap_or_default(),
            ]
        };
        result.insert(id, cells);
    }
    Ok(result)
}
#[derive(Clone)]
pub(crate) struct Snapshot {
    pub(crate) rows: Vec<Cells>,
    grid_rows: i64,
}
fn snapshot(kind: Kind, meta: Value) -> Result<Snapshot, String> {
    let sheet = meta["sheets"]
        .as_array()
        .and_then(|s| s.iter().find(|s| s["properties"]["sheetId"] == kind.sid()))
        .ok_or("同期タブがありません。「接続を確認」を実行してください。")?;
    let width = kind.headers().len();
    let mut rows: Vec<Cells> = Vec::new();
    for grid in sheet["data"].as_array().into_iter().flatten() {
        let start = grid["startRow"].as_u64().unwrap_or(0) as usize;
        for (offset, row) in grid["rowData"].as_array().into_iter().flatten().enumerate() {
            rows.resize_with((start + offset + 1).max(rows.len()), || {
                vec![String::new(); width]
            });
            for (col, cell) in row["values"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .take(width)
            {
                let value = &cell["effectiveValue"];
                rows[start + offset][col] =
                    if let Some(formula) = cell["userEnteredValue"]["formulaValue"].as_str() {
                        formula.into()
                    } else if let Some(b) = value["boolValue"].as_bool() {
                        if b { "TRUE" } else { "FALSE" }.into()
                    } else if let Some(n) = value["numberValue"].as_i64() {
                        n.to_string()
                    } else {
                        cell["formattedValue"]
                            .as_str()
                            .or(cell["userEnteredValue"]["stringValue"].as_str())
                            .unwrap_or("")
                            .into()
                    };
            }
        }
    }
    while rows.last().is_some_and(|r| empty_row(kind, r)) {
        rows.pop();
    }
    if rows
        .first()
        .is_none_or(|r| r.iter().map(String::as_str).ne(kind.headers()))
    {
        return Err(format!(
            "{}の見出しが変更されています。列を元に戻してください。",
            kind.title()
        ));
    }
    Ok(Snapshot {
        rows,
        grid_rows: sheet["properties"]["gridProperties"]["rowCount"]
            .as_i64()
            .unwrap_or(1000),
    })
}
pub(crate) async fn read(id: &str, token: &str, kind: Kind) -> Result<Snapshot, String> {
    let meta=request_json(google::client()?.post(format!("https://sheets.googleapis.com/v4/spreadsheets/{id}:getByDataFilter")).bearer_auth(token)
        .json(&json!({"dataFilters":[{"gridRange":{"sheetId":kind.sid(),"startColumnIndex":0,"endColumnIndex":kind.headers().len()}}],"includeGridData":true})),true).await?;
    snapshot(kind, meta)
}
fn requests(kind: Kind, current: &Snapshot, patches: &[(usize, Cells)]) -> Vec<Value> {
    let mut requests = Vec::new();
    let required = patches.iter().map(|(i, _)| i + 1).max().unwrap_or(0) as i64;
    if required > current.grid_rows {
        requests.push(json!({"appendDimension":{"sheetId":kind.sid(),"dimension":"ROWS","length":required-current.grid_rows}}));
    }
    for (index, values) in patches {
        let cells: Vec<Value> = values
            .iter()
            .enumerate()
            .map(|(col, value)| {
                let entered = if kind == Kind::Check && col == 3 {
                    json!({"boolValue":value=="TRUE"})
                } else {
                    json!({"stringValue":value})
                };
                json!({"userEnteredValue":entered})
            })
            .collect();
        requests.push(json!({"updateCells":{"start":{"sheetId":kind.sid(),"rowIndex":index,"columnIndex":0},"rows":[{"values":cells}],"fields":"userEnteredValue"}}));
    }
    requests
}
async fn write(
    db: &SqlitePool,
    id: &str,
    token: &str,
    kind: Kind,
    before: &Snapshot,
    patches: &[(usize, Cells)],
) -> Result<(), String> {
    if patches.is_empty() {
        return Ok(());
    }
    if read(id, token, kind).await?.rows != before.rows {
        return Err("REMOTE_CHANGED|同期中にシートが編集されました。再同期します。".into());
    }
    let journal = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO sync_write_journal(id,spreadsheet_id,before_json,patches_json) VALUES(?,?,?,?)").bind(&journal).bind(id)
        .bind(json!({"sheetId":kind.sid(),"rows":before.rows}).to_string()).bind(json!(patches).to_string()).execute(db).await.map_err(|_|DB_ERROR)?;
    request_json(
        google::client()?
            .post(format!(
                "https://sheets.googleapis.com/v4/spreadsheets/{id}:batchUpdate"
            ))
            .bearer_auth(token)
            .json(&json!({"requests":requests(kind,before,patches)})),
        false,
    )
    .await?;
    let verified = read(id, token, kind).await?;
    if patches.iter().any(|(i, v)| {
        if empty_row(kind, v) {
            return verified.rows.get(*i).is_some_and(|r| !empty_row(kind, r));
        }
        verified
            .rows
            .get(*i)
            .is_none_or(|r| r.get(..v.len()) != Some(v.as_slice()))
    }) {
        return Err("REMOTE_CHANGED|送信後にシートが変更されました。再同期してください。".into());
    }
    sqlx::query("UPDATE sync_write_journal SET result='CONFIRMED' WHERE id=?")
        .bind(journal)
        .execute(db)
        .await
        .map_err(|_| DB_ERROR)?;
    Ok(())
}
async fn acknowledge(
    db: &SqlitePool,
    kind: Kind,
    id: &str,
    local: &[String],
    remote: &[String],
) -> Result<(), String> {
    sqlx::query("INSERT INTO related_sync_state(entity_type,entity_id,local_json,remote_json) VALUES(?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET local_json=excluded.local_json,remote_json=excluded.remote_json")
        .bind(kind.name()).bind(id).bind(encoded(local)).bind(encoded(remote)).execute(db).await.map_err(|_|DB_ERROR)?;
    sqlx::query("UPDATE sync_conflicts SET resolved_at=datetime('now') WHERE entity_type=? AND entity_id=? AND resolved_at IS NULL").bind(kind.name()).bind(id).execute(db).await.map_err(|_|DB_ERROR)?;
    Ok(())
}
async fn apply(
    db: &SqlitePool,
    kind: Kind,
    row: &Cells,
    expected: Option<&Cells>,
) -> Result<Cells, String> {
    valid(kind, row)?;
    let mut tx = db
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| DB_ERROR)?;
    // Read on the reserved connection, not the pool, so no local writer can interleave.
    let query = if kind == Kind::Category {
        "SELECT json_array(id,name,color,CAST(sort_order AS TEXT),updated_at,COALESCE(deleted_at,'')) FROM categories WHERE id=? AND workspace_id=?"
    } else {
        "SELECT json_array(c.id,c.task_id,t.title,CASE c.checked WHEN 1 THEN 'TRUE' ELSE 'FALSE' END,c.text,CAST(c.sort_order AS TEXT),c.updated_at,COALESCE(c.deleted_at,t.deleted_at,'')) FROM task_check_items c JOIN tasks t ON t.id=c.task_id WHERE c.id=? AND t.workspace_id=?"
    };
    let before: Option<String> = sqlx::query_scalar(query)
        .bind(&row[0])
        .bind(WORKSPACE)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| DB_ERROR)?;
    let before: Option<Cells> = before
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|_| DB_ERROR)?;
    if before.as_ref() != expected {
        return Err("LOCAL_CHANGED|同期中にアプリで編集されました。再同期します。".into());
    }
    if before.is_none() {
        let table = if kind == Kind::Category {
            "categories"
        } else {
            "task_check_items"
        };
        let exists: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE id=?"))
            .bind(&row[0])
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| DB_ERROR)?;
        if exists > 0 {
            return Err("別のワークスペースのIDと重複しています。".into());
        }
    }
    if expected.is_some_and(|r| r[1] != row[1]) && kind == Kind::Check {
        return Err("親タスクIDの変更はできません。".into());
    }
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    if kind == Kind::Category {
        let duplicate:i64=sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE workspace_id=? AND name=? AND id<>? AND deleted_at IS NULL").bind(WORKSPACE).bind(&row[1]).bind(&row[0]).fetch_one(&mut *tx).await.map_err(|_|DB_ERROR)?;
        if duplicate > 0 {
            return Err("同名の分類があります。分類名を整理してください。".into());
        }
        sqlx::query("INSERT INTO categories(id,workspace_id,name,color,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,sort_order=excluded.sort_order,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at")
            .bind(&row[0]).bind(WORKSPACE).bind(&row[1]).bind(&row[2]).bind(row[3].parse::<i64>().unwrap()).bind(&now).bind(&now).bind(optional(&row[5])).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
        sqlx::query("UPDATE tasks SET category_id=CASE WHEN ?='' THEN category_id ELSE NULL END,revision=revision+1,updated_at=? WHERE category_id=?")
            .bind(&row[5]).bind(&now).bind(&row[0]).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    } else {
        let parent: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL",
        )
        .bind(&row[1])
        .bind(WORKSPACE)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| DB_ERROR)?;
        if parent != 1 {
            return Err(
                "親タスクが見つからないか削除済みです。タスクを先に同期してください。".into(),
            );
        }
        sqlx::query("INSERT INTO task_check_items(id,task_id,text,checked,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,checked=excluded.checked,sort_order=excluded.sort_order,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at")
            .bind(&row[0]).bind(&row[1]).bind(&row[4]).bind(i64::from(row[3]=="TRUE")).bind(row[5].parse::<i64>().unwrap()).bind(&now).bind(&now).bind(optional(&row[7])).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
        sqlx::query("UPDATE tasks SET revision=revision+1,updated_at=? WHERE id=?")
            .bind(&now)
            .bind(&row[1])
            .execute(&mut *tx)
            .await
            .map_err(|_| DB_ERROR)?;
        let account =
            sqlx::query("SELECT google_sub,email FROM google_sync_settings WHERE workspace_id=?")
                .bind(WORKSPACE)
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| DB_ERROR)?;
        let actor = format!(
            "google:{}",
            account
                .get::<Option<String>, _>("google_sub")
                .unwrap_or_default()
        );
        let email = account
            .get::<Option<String>, _>("email")
            .unwrap_or_default();
        sqlx::query("INSERT INTO actors(id,display_name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name").bind(&actor).bind(format!("Google Sheets ({email})")).bind(&now).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
        sqlx::query("INSERT INTO task_history(id,task_id,actor_id,event_type,old_value,new_value,created_at) VALUES(?,? ,?,'CHECK_ITEM_SYNCED',?,?,?)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&row[1]).bind(actor).bind(json!(before).to_string()).bind(encoded(row)).bind(&now).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    }
    let mut after = row.clone();
    after[if kind == Kind::Category { 4 } else { 6 }] = now;
    sqlx::query("INSERT INTO related_sync_state(entity_type,entity_id,local_json,remote_json) VALUES(?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET local_json=excluded.local_json,remote_json=excluded.remote_json")
        .bind(kind.name()).bind(&row[0]).bind(encoded(&after)).bind(encoded(row)).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    sqlx::query("UPDATE sync_conflicts SET resolved_at=datetime('now') WHERE entity_type=? AND entity_id=? AND resolved_at IS NULL").bind(kind.name()).bind(&row[0]).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    tx.commit().await.map_err(|_| DB_ERROR)?;
    Ok(after)
}
#[derive(Serialize, Default)]
pub struct ResultSummary {
    warnings: Vec<String>,
    changed: bool,
}
#[derive(Debug, PartialEq)]
enum Decision {
    Equal,
    Push,
    Pull,
    Conflict,
}
fn decide(
    kind: Kind,
    local: &Cells,
    remote: &Cells,
    base: Option<&(Cells, Cells)>,
    choice: Option<&str>,
) -> Decision {
    if semantic(kind, local) == semantic(kind, remote) {
        return Decision::Equal;
    }
    let lc = base.is_none_or(|(l, _)| semantic(kind, l) != semantic(kind, local));
    let rc = base.is_none_or(|(_, r)| semantic(kind, r) != semantic(kind, remote));
    match choice {
        Some("LOCAL") => Decision::Push,
        Some("REMOTE") => Decision::Pull,
        _ => match (lc, rc) {
            (true, true) => Decision::Conflict,
            (true, false) => Decision::Push,
            (false, true) => Decision::Pull,
            _ => Decision::Equal,
        },
    }
}
// Repair only the specific old-export shape: >=999 unused checkbox rows followed
// exclusively by unique, unchanged rows already acknowledged by this PC.
fn repair_checkbox_padding(
    kind: Kind,
    remote: &Snapshot,
    local: &BTreeMap<String, Cells>,
    baselines: &HashMap<String, (Cells, Cells)>,
) -> Vec<(usize, Cells)> {
    if kind != Kind::Check {
        return vec![];
    }
    let Some(first) = remote
        .rows
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, r)| !empty_row(kind, r))
        .map(|(i, _)| i)
    else {
        return vec![];
    };
    if first < 1000 {
        return vec![];
    }
    let mut rows = Vec::new();
    let mut ids = HashSet::new();
    for (index, row) in remote.rows.iter().enumerate().skip(first) {
        if empty_row(kind, row) {
            continue;
        }
        if !ids.insert(row[0].clone())
            || !baselines.get(&row[0]).is_some_and(|(_, r)| r == row)
            || !local
                .get(&row[0])
                .is_some_and(|l| semantic(kind, l) == semantic(kind, row))
        {
            return vec![];
        }
        rows.push((index, row.clone()));
    }
    if rows.len() > 500 {
        return vec![];
    }
    let mut patches = Vec::new();
    for (target, (source, row)) in rows.into_iter().enumerate() {
        patches.push((target + 1, row));
        let mut empty = vec![String::new(); kind.headers().len()];
        empty[3] = "FALSE".into();
        patches.push((source, empty));
    }
    patches
}
async fn synchronize(
    db: &SqlitePool,
    id: &str,
    token: &str,
    kind: Kind,
) -> Result<ResultSummary, String> {
    let mut result = ResultSummary::default();
    let mut remote = read(id, token, kind).await?;
    let mut local = local_rows(db, kind).await?;
    let mut identities = Vec::new();
    for (index, row) in remote.rows.iter().enumerate().skip(1) {
        if empty_row(kind, row) || !row[0].is_empty() {
            continue;
        }
        let mut candidate = row.clone();
        candidate[0] = uuid::Uuid::new_v4().to_string();
        if kind == Kind::Check && candidate[1].is_empty() {
            let parents: Vec<String> = sqlx::query_scalar(
                "SELECT id FROM tasks WHERE workspace_id=? AND title=? AND deleted_at IS NULL",
            )
            .bind(WORKSPACE)
            .bind(&candidate[2])
            .fetch_all(db)
            .await
            .map_err(|_| DB_ERROR)?;
            if parents.len() == 1 {
                candidate[1] = parents[0].clone();
            }
        }
        if kind == Kind::Check && candidate[3].is_empty() {
            candidate[3] = "FALSE".into();
        }
        if kind == Kind::Category && candidate[2].is_empty() {
            candidate[2] = "slate".into();
        }
        let order = if kind == Kind::Category { 3 } else { 5 };
        if candidate[order].is_empty() {
            candidate[order] = (index - 1).to_string();
        }
        if let Err(e) = valid(kind, &candidate) {
            result
                .warnings
                .push(format!("{} 行{}: {e}", kind.title(), index + 1));
        } else {
            identities.push((index, candidate));
        }
    }
    identities.truncate(1000);
    if !identities.is_empty() {
        write(db, id, token, kind, &remote, &identities).await?;
        remote = read(id, token, kind).await?;
    }
    let mut baselines = HashMap::new();
    for row in sqlx::query(
        "SELECT entity_id,local_json,remote_json FROM related_sync_state WHERE entity_type=?",
    )
    .bind(kind.name())
    .fetch_all(db)
    .await
    .map_err(|_| DB_ERROR)?
    {
        let a: Cells = serde_json::from_str(row.get("local_json")).map_err(|_| DB_ERROR)?;
        let b: Cells = serde_json::from_str(row.get("remote_json")).map_err(|_| DB_ERROR)?;
        baselines.insert(row.get::<String, _>("entity_id"), (a, b));
    }
    let repair = repair_checkbox_padding(kind, &remote, &local, &baselines);
    if !repair.is_empty() {
        write(db, id, token, kind, &remote, &repair).await?;
        remote = read(id, token, kind).await?;
        result.changed = true;
    }
    let mut counts = HashMap::new();
    for row in remote.rows.iter().skip(1) {
        if !row[0].is_empty() {
            *counts.entry(row[0].clone()).or_insert(0) += 1;
        }
    }
    let mut seen = HashSet::new();
    let mut patches = Vec::new();
    let mut acks = Vec::new();
    for (index, row) in remote.rows.iter().enumerate().skip(1) {
        if row[0].is_empty() {
            continue;
        }
        seen.insert(row[0].clone());
        if counts[&row[0]] > 1 {
            result.warnings.push(format!(
                "{} 行{}: IDが重複しています。",
                kind.title(),
                index + 1
            ));
            continue;
        }
        if let Err(e) = valid(kind, row) {
            result
                .warnings
                .push(format!("{} 行{}: {e}", kind.title(), index + 1));
            continue;
        }
        let ours = local.get(&row[0]);
        let decision = if let Some(ours) = ours {
            let choice=sqlx::query("SELECT local_json,remote_json,resolution FROM sync_conflicts WHERE entity_type=? AND entity_id=? AND resolved_at IS NULL").bind(kind.name()).bind(&row[0]).fetch_optional(db).await.map_err(|_|DB_ERROR)?;
            let choice = choice
                .filter(|c| {
                    c.get::<String, _>("local_json") == encoded(ours)
                        && c.get::<String, _>("remote_json") == encoded(row)
                })
                .and_then(|c| c.get::<Option<String>, _>("resolution"));
            decide(kind, ours, row, baselines.get(&row[0]), choice.as_deref())
        } else {
            Decision::Pull
        };
        match decision {
            Decision::Equal => {
                if kind == Kind::Check && ours.unwrap()[2] != row[2] && patches.len() < 1000 {
                    patches.push((index, ours.unwrap().clone()));
                    acks.push(ours.unwrap().clone());
                    continue;
                }
                acknowledge(db, kind, &row[0], ours.unwrap(), row).await?;
            }
            Decision::Push => {
                if patches.len() < 1000 {
                    patches.push((index, ours.unwrap().clone()));
                    acks.push(ours.unwrap().clone());
                } else {
                    result
                        .warnings
                        .push("同期待ちの行が残っています。次回同期で続行します。".into());
                }
            }
            Decision::Pull => {
                if ours.is_none() && !row.last().unwrap().is_empty() {
                    continue;
                }
                // Deletion markers are application-owned; explicit conflict choices may restore.
                if !row.last().unwrap().is_empty()
                    && ours.is_some_and(|o| o.last().unwrap().is_empty())
                {
                    result.warnings.push(format!(
                        "{} 行{}: 削除はアプリで行ってください。",
                        kind.title(),
                        index + 1
                    ));
                    continue;
                }
                match apply(db, kind, row, ours).await {
                    Ok(after) => {
                        local.insert(row[0].clone(), after);
                        result.changed = true;
                    }
                    Err(e) => {
                        result
                            .warnings
                            .push(format!("{} 行{}: {e}", kind.title(), index + 1))
                    }
                }
            }
            Decision::Conflict => {
                sqlx::query("INSERT INTO sync_conflicts(id,entity_type,entity_id,local_json,remote_json,detected_at) VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT DO UPDATE SET local_json=excluded.local_json,remote_json=excluded.remote_json,resolution=NULL,detected_at=excluded.detected_at")
                    .bind(uuid::Uuid::new_v4().to_string()).bind(kind.name()).bind(&row[0]).bind(encoded(ours.unwrap())).bind(encoded(row)).execute(db).await.map_err(|_|DB_ERROR)?;
                result.warnings.push(format!(
                    "{} 行{}: 両方で変更されています。設定の競合欄で採用する内容を選んでください。",
                    kind.title(),
                    index + 1
                ));
            }
        }
    }
    let mut index = remote.rows.len();
    for (entity, row) in &local {
        if seen.contains(entity) {
            continue;
        }
        if baselines.contains_key(entity) {
            result.warnings.push(format!(
                "{}: ID {entity} の行がシートにありません。アプリの内容は保持しています。",
                kind.title()
            ));
            continue;
        }
        if !row.last().unwrap().is_empty() {
            continue;
        }
        if patches.len() >= 1000 {
            result
                .warnings
                .push("同期待ちの行が残っています。次回同期で続行します。".into());
            break;
        }
        patches.push((index, row.clone()));
        acks.push(row.clone());
        index += 1;
    }
    if !patches.is_empty() {
        write(db, id, token, kind, &remote, &patches).await?;
        for row in acks {
            acknowledge(db, kind, &row[0], &row, &row).await?;
        }
        result.changed = true;
    }
    Ok(result)
}
#[tauri::command]
pub async fn google_sync_related(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    entity_type: String,
) -> Result<ResultSummary, String> {
    let kind = match entity_type.as_str() {
        "CATEGORY" => Kind::Category,
        "CHECK_ITEM" => Kind::Check,
        _ => return Err("同期対象が不正です。".into()),
    };
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    crate::sync_onboarding::require_confirmation(&db).await?;
    let id = connected_id(&db).await?;
    let token = google::access_token(&db).await?;
    synchronize(&db, &id, &token, kind).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn checkbox_grid() -> Value {
        let header: Vec<Value> = Kind::Check
            .headers()
            .iter()
            .map(|s| json!({"formattedValue":s}))
            .collect();
        let mut rows = vec![json!({"values":header})];
        for _ in 1..1000 {
            rows.push(json!({"values":[{},{},{},{"effectiveValue":{"boolValue":false},"formattedValue":"FALSE"}]}));
        }
        json!({"sheets":[{"properties":{"sheetId":101,"gridProperties":{"rowCount":1000}},"data":[{"rowData":rows}]}]})
    }
    #[test]
    fn unused_checkbox_grid_is_not_a_thousand_new_items() {
        let grid = checkbox_grid();
        let parsed = snapshot(Kind::Check, grid.clone()).unwrap();
        assert_eq!(parsed.rows.len(), 1);
        let mut ticked = grid.clone();
        ticked["sheets"][0]["data"][0]["rowData"][1]["values"][3]["effectiveValue"]["boolValue"] =
            json!(true);
        assert_eq!(snapshot(Kind::Check, ticked).unwrap().rows.len(), 2);
        let mut formula = grid;
        formula["sheets"][0]["data"][0]["rowData"][1]["values"][3]["userEnteredValue"] =
            json!({"formulaValue":"=FALSE()"});
        assert_eq!(snapshot(Kind::Check, formula).unwrap().rows.len(), 2);
    }
    #[test]
    fn repairs_old_export_without_moving_changed_or_unknown_rows() {
        let row: Cells = vec![
            category()[0].clone(),
            category()[0].clone(),
            "Task".into(),
            "FALSE".into(),
            "check".into(),
            "0".into(),
            "now".into(),
            "".into(),
        ];
        let mut remote = snapshot(Kind::Check, checkbox_grid()).unwrap();
        let mut blank = vec![String::new(); 8];
        blank[3] = "FALSE".into();
        remote.rows.resize(1000, blank);
        remote.rows.push(row.clone());
        let local = BTreeMap::from([(row[0].clone(), row.clone())]);
        let bases = HashMap::from([(row[0].clone(), (row.clone(), row.clone()))]);
        let repair = repair_checkbox_padding(Kind::Check, &remote, &local, &bases);
        assert_eq!(repair.len(), 2);
        assert_eq!(repair[0], (1, row.clone()));
        assert_eq!(repair[1].0, 1000);
        assert!(empty_row(Kind::Check, &repair[1].1));
        for (i, r) in repair {
            remote.rows[i] = r;
        }
        assert!(repair_checkbox_padding(Kind::Check, &remote, &local, &bases).is_empty());
        remote.rows[1] = vec![String::new(); 8];
        remote.rows[1000] = row;
        remote.rows[1000][4] = "user edit".into();
        assert!(repair_checkbox_padding(Kind::Check, &remote, &local, &bases).is_empty());
    }
    async fn database() -> SqlitePool {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [
            include_str!("../migrations/0001_init.sql"),
            include_str!("../migrations/0002_query_indexes.sql"),
            include_str!("../migrations/0003_fts_search.sql"),
            include_str!("../migrations/0004_category_color.sql"),
            include_str!("../migrations/0005_check_items.sql"),
            include_str!("../migrations/0006_google_sync.sql"),
            include_str!("../migrations/0007_task_sync.sql"),
            include_str!("../migrations/0008_related_sync.sql"),
        ] {
            sqlx::raw_sql(sql).execute(&db).await.unwrap();
        }
        db
    }
    #[test]
    fn pull_category_and_checklist_are_transactional() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let db=database().await;
            let first=category();let saved=apply(&db,Kind::Category,&first,None).await.unwrap();
            assert_eq!(local_rows(&db,Kind::Category).await.unwrap()[&first[0]],saved);
            let mut updated=saved.clone();updated[2]="purple".into();updated[3]="4".into();
            let saved2=apply(&db,Kind::Category,&updated,Some(&saved)).await.unwrap();
            assert!(apply(&db,Kind::Category,&first,Some(&saved)).await.unwrap_err().contains("LOCAL_CHANGED"));
            assert_eq!(local_rows(&db,Kind::Category).await.unwrap()[&first[0]],saved2);
            let task="22222222-2222-4222-8222-222222222222";
            sqlx::query("INSERT INTO tasks(id,workspace_id,title,status,deadline_type,deadline_label,created_at,updated_at) VALUES(?,?,'Task','TODO','ASAP','ASAP','2026-09-15T00:00:00Z','2026-09-15T00:00:00Z')").bind(task).bind(WORKSPACE).execute(&db).await.unwrap();
            let check=vec!["33333333-3333-4333-8333-333333333333",task,"Task","TRUE","Check one","0","2026-09-15T00:00:00Z", ""].into_iter().map(str::to_owned).collect();
            let saved=apply(&db,Kind::Check,&check,None).await.unwrap();
            assert_eq!(local_rows(&db,Kind::Check).await.unwrap()[&check[0]],saved);
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM task_history WHERE event_type='CHECK_ITEM_SYNCED'").fetch_one(&db).await.unwrap(),1);
            sqlx::raw_sql("CREATE TRIGGER fail_related BEFORE INSERT ON related_sync_state BEGIN SELECT RAISE(ABORT,'disk full'); END;").execute(&db).await.unwrap();
            let mut edit=saved.clone();edit[3]="FALSE".into();
            assert!(apply(&db,Kind::Check,&edit,Some(&saved)).await.is_err());
            assert_eq!(local_rows(&db,Kind::Check).await.unwrap()[&check[0]],saved);
        });
    }
    #[test]
    fn checkbox_changes_and_reordering_sync_independently() {
        let base: Cells = vec![
            category()[0].clone(),
            category()[0].clone(),
            "Task".into(),
            "FALSE".into(),
            "one".into(),
            "0".into(),
            "now".into(),
            "".into(),
        ];
        for (col, value) in [
            (3, "TRUE"),
            (4, "edited"),
            (5, "2"),
            (7, "2026-09-15T00:00:00Z"),
        ] {
            let mut local = base.clone();
            local[col] = value.into();
            assert_eq!(
                decide(
                    Kind::Check,
                    &local,
                    &base,
                    Some(&(base.clone(), base.clone())),
                    None
                ),
                Decision::Push
            );
        }
    }
    fn category() -> Cells {
        vec![
            "11111111-1111-4111-8111-111111111111",
            "仕事",
            "blue",
            "0",
            "2026-09-15T00:00:00Z",
            "",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    }
    #[test]
    fn changes_conflicts_and_lost_response() {
        let original = category();
        let base = (original.clone(), original.clone());
        let mut local = original.clone();
        local[2] = "red".into();
        assert_eq!(
            decide(Kind::Category, &local, &original, Some(&base), None),
            Decision::Push
        );
        assert_eq!(
            decide(Kind::Category, &original, &local, Some(&base), None),
            Decision::Pull
        );
        assert_eq!(
            decide(Kind::Category, &local, &local, Some(&base), None),
            Decision::Equal
        );
        let mut remote = original.clone();
        remote[1] = "新しい分類".into();
        assert_eq!(
            decide(Kind::Category, &local, &remote, Some(&base), None),
            Decision::Conflict
        );
        assert_eq!(
            decide(Kind::Category, &local, &remote, Some(&base), Some("REMOTE")),
            Decision::Pull
        );
    }
    #[test]
    fn checkbox_write_is_boolean_and_text_is_literal() {
        let row = vec![
            category()[0].clone(),
            category()[0].clone(),
            "Task".into(),
            "TRUE".into(),
            "=1+1".into(),
            "0".into(),
            "".into(),
            "".into(),
        ];
        let req = requests(
            Kind::Check,
            &Snapshot {
                rows: vec![],
                grid_rows: 1,
            },
            &[(1, row)],
        );
        assert_eq!(
            req[1]["updateCells"]["rows"][0]["values"][3]["userEnteredValue"]["boolValue"],
            true
        );
        assert_eq!(
            req[1]["updateCells"]["rows"][0]["values"][4]["userEnteredValue"]["stringValue"],
            "=1+1"
        );
    }
}
