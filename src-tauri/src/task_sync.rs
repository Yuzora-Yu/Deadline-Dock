//! Task sync boundary: tokens and HTTP stay in Rust; local mutations are transactional.
use crate::google::{self, GoogleState, DB_ERROR, WORKSPACE};
use chrono::{DateTime, Utc};
use reqwest::{RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use tauri::State;

const TASK_COLUMNS: &str = "id,workspace_id,title,description,category_id,status,deadline_type,deadline_label,deadline_exact,deadline_range_start,deadline_range_end,snooze_until,created_at,updated_at,started_at,completed_at,revision,duplicated_from_task_id,deleted_at,postponement_count";
async fn rows_json(
    db: &SqlitePool,
    table: &str,
    columns: &str,
    filter: &str,
) -> Result<Vec<Value>, String> {
    // These identifiers are static caller-owned constants, never IPC input.
    let fields = columns
        .split(',')
        .map(|c| format!("'{c}',{c}"))
        .collect::<Vec<_>>()
        .join(",");
    let query = format!("SELECT json_object({fields}) AS value FROM {table} {filter}");
    let rows = sqlx::query(&query)
        .fetch_all(db)
        .await
        .map_err(|_| DB_ERROR)?;
    rows.iter()
        .map(|r| serde_json::from_str(r.get::<&str, _>("value")).map_err(|_| DB_ERROR.into()))
        .collect()
}
#[tauri::command]
pub async fn google_local_sync_data(app: tauri::AppHandle) -> Result<Value, String> {
    let db = google::pool(&app).await?;
    let tasks = rows_json(
        &db,
        "tasks",
        TASK_COLUMNS,
        "WHERE workspace_id='00000000-0000-4000-8000-000000000001'",
    )
    .await?;
    let categories = rows_json(
        &db,
        "categories",
        "id,workspace_id,name,color,sort_order,created_at,updated_at,deleted_at",
        "",
    )
    .await?;
    let states = rows_json(
        &db,
        "sync_entity_state",
        "entity_id,last_synced_local_revision,last_synced_remote_hash",
        "WHERE entity_type='TASK'",
    )
    .await?;
    let conflicts = rows_json(
        &db,
        "sync_conflicts",
        "id,entity_type,entity_id,local_json,remote_json,resolution",
        "WHERE resolved_at IS NULL",
    )
    .await?;
    Ok(json!({"tasks":tasks,"categories":categories,"states":states,"conflicts":conflicts}))
}
fn api_error(code: u16) -> String {
    match code {
        401 => "AUTH_REQUIRED|Google認証が必要です。再接続してください。",
        403 => "PERMISSION|Googleのアクセス権限とAPIの有効化を確認してください。",
        404 => "MISSING_SHEET|同期先が見つかりません。Google Driveで削除・アクセス権限を確認してください。",
        429 => "RETRY|Googleの利用制限に達しました。時間を置いて再試行します。",
        500..=599 => "RETRY|Google側で一時的な障害が発生しています。再試行します。",
        _ => "API_ERROR|Googleとの通信に失敗しました。シート構成を確認してください。",
    }.into()
}
pub(crate) async fn request_json(request: RequestBuilder, retry: bool) -> Result<Value, String> {
    for attempt in 0..3 {
        let response = request
            .try_clone()
            .ok_or("通信を複製できません。")?
            .send()
            .await;
        match response {
            Ok(response) => {
                let code = response.status();
                if code.is_success() {
                    return response
                        .json()
                        .await
                        .map_err(|_| "Googleの応答を読み取れません。".into());
                }
                if retry
                    && attempt < 2
                    && (code == StatusCode::TOO_MANY_REQUESTS || code.is_server_error())
                {
                    tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                    continue;
                }
                return Err(api_error(code.as_u16()));
            }
            Err(_) => {
                return Err(
                    "OFFLINE|通信できません。ローカル操作は保存され、後で再同期します。".into(),
                )
            }
        }
    }
    Err("RETRY|しばらく待って再試行してください。".into())
}
pub(crate) async fn connected_id(db: &SqlitePool) -> Result<String, String> {
    let settings = google::settings(db).await?;
    if settings.get::<i64, _>("enabled") == 0 || settings.get::<i64, _>("initialized") == 0 {
        return Err("NOT_CONNECTED|Google連携を完了してください。".into());
    }
    let id = settings
        .get::<Option<String>, _>("spreadsheet_id")
        .ok_or("同期先がありません。")?;
    google::sheet_url(&id)?;
    Ok(id)
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteSheet {
    pub(crate) spreadsheet_id: String,
    pub(crate) version: String,
    pub(crate) rows: Vec<Vec<String>>,
    grid_rows: i64,
}
fn snapshot_from_json(id: &str, metadata: Value) -> Result<RemoteSheet, String> {
    let sheets = metadata["sheets"]
        .as_array()
        .ok_or("シートの応答が不正です。")?;
    let sheet = sheets
        .iter()
        .find(|s| s["properties"]["sheetId"] == 100)
        .ok_or("MISSING_TAB|タスク一覧のタブが削除されています。元のタブを復元してください。")?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    for grid in sheet["data"].as_array().into_iter().flatten() {
        let start = grid["startRow"].as_u64().unwrap_or(0) as usize;
        for (offset, row) in grid["rowData"].as_array().into_iter().flatten().enumerate() {
            while rows.len() <= start + offset {
                rows.push(vec![String::new(); 14]);
            }
            for (col, cell) in row["values"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .take(14)
            {
                rows[start + offset][col] = cell["formattedValue"]
                    .as_str()
                    .or(cell["userEnteredValue"]["stringValue"].as_str())
                    .unwrap_or("")
                    .to_string();
            }
        }
    }
    while rows.last().is_some_and(|r| r.iter().all(|v| v.is_empty())) {
        rows.pop();
    }
    let version = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&rows).map_err(|_| "シートを検証できません。")?)
    );
    Ok(RemoteSheet {
        spreadsheet_id: id.into(),
        version,
        rows,
        grid_rows: sheet["properties"]["gridProperties"]["rowCount"]
            .as_i64()
            .unwrap_or(1000),
    })
}
pub(crate) async fn read_sheet(id: &str, token: &str) -> Result<RemoteSheet, String> {
    let meta=request_json(google::client()?.post(format!("https://sheets.googleapis.com/v4/spreadsheets/{id}:getByDataFilter"))
        .bearer_auth(token).json(&json!({"dataFilters":[{"gridRange":{"sheetId":100,"startColumnIndex":0,"endColumnIndex":14}}],"includeGridData":true})),true).await?;
    snapshot_from_json(id, meta)
}
#[tauri::command]
pub async fn google_read_tasks(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> Result<RemoteSheet, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    let id = connected_id(&db).await?;
    let token = google::access_token(&db).await?;
    let file = request_json(
        google::client()?
            .get(format!("https://www.googleapis.com/drive/v3/files/{id}"))
            .query(&[("fields", "id,trashed")])
            .bearer_auth(&token),
        true,
    )
    .await?;
    if file["trashed"] == true {
        return Err(
            "MISSING_SHEET|同期先がゴミ箱にあります。復元するか新しい同期先を作成してください。"
                .into(),
        );
    }
    read_sheet(&id, &token).await
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Patch {
    row_index: usize,
    values: Vec<String>,
}
fn patch_requests(current: &RemoteSheet, patches: &[Patch]) -> Result<Vec<Value>, String> {
    if patches.len() > 1000 {
        return Err("1回の同期は1000行までです。残りは次回同期します。".into());
    }
    let mut seen = std::collections::HashSet::new();
    for patch in patches {
        if patch.row_index == 0
            || patch.row_index > 100000
            || !seen.insert(patch.row_index)
            || ![1, 14].contains(&patch.values.len())
            || patch.values.iter().any(|v| v.len() > 50000)
        {
            return Err("同期する行の形式が不正です。".into());
        }
        uuid::Uuid::parse_str(&patch.values[0]).map_err(|_| "task_id が不正です。")?;
    }
    let mut requests = Vec::new();
    let required = patches.iter().map(|p| p.row_index + 1).max().unwrap_or(0) as i64;
    if required > current.grid_rows {
        requests.push(json!({"appendDimension":{"sheetId":100,"dimension":"ROWS","length":required-current.grid_rows}}));
    }
    for patch in patches {
        // Explicit stringValue prevents formula execution for titles/descriptions beginning '='.
        let cells: Vec<_> = patch
            .values
            .iter()
            .map(|v| json!({"userEnteredValue":{"stringValue":v}}))
            .collect();
        requests.push(json!({"updateCells":{"start":{"sheetId":100,"rowIndex":patch.row_index,"columnIndex":0},"rows":[{"values":cells}],"fields":"userEnteredValue"}}));
    }
    Ok(requests)
}
#[tauri::command]
pub async fn google_write_tasks(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    spreadsheet_id: String,
    expected_version: String,
    patches: Vec<Patch>,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    crate::sync_onboarding::require_confirmation(&db).await?;
    let id = connected_id(&db).await?;
    if id != spreadsheet_id {
        return Err("同期先が変更されました。再試行してください。".into());
    }
    let token = google::access_token(&db).await?;
    let current = read_sheet(&id, &token).await?;
    if current.version != expected_version {
        return Err("REMOTE_CHANGED|シートが同期中に編集されました。再読込して同期します。".into());
    }
    let requests = patch_requests(&current, &patches)?;
    if requests.is_empty() {
        return Ok(());
    }
    let journal = uuid::Uuid::new_v4().to_string();
    let before: Vec<_> = patches
        .iter()
        .map(|p| json!({"row":p.row_index,"values":current.rows.get(p.row_index)}))
        .collect();
    sqlx::query("INSERT INTO sync_write_journal(id,spreadsheet_id,before_json,patches_json) VALUES(?,?,?,?)")
        .bind(&journal).bind(&id).bind(json!(before).to_string()).bind(json!(patches).to_string()).execute(&db).await.map_err(|_| DB_ERROR)?;
    // Writes are not blindly retried: an HTTP timeout may follow a successful commit.
    request_json(
        google::client()?
            .post(format!(
                "https://sheets.googleapis.com/v4/spreadsheets/{id}:batchUpdate"
            ))
            .bearer_auth(&token)
            .json(&json!({"requests":requests})),
        false,
    )
    .await?;
    let verified = read_sheet(&id, &token).await?;
    if patches.iter().any(|p| {
        verified
            .rows
            .get(p.row_index)
            .is_none_or(|r| r.get(..p.values.len()) != Some(p.values.as_slice()))
    }) {
        return Err("REMOTE_CHANGED|送信後のシートが変更されています。変更前の内容を保管しました。再同期してください。".into());
    }
    sqlx::query("UPDATE sync_write_journal SET result='CONFIRMED' WHERE id=?")
        .bind(&journal)
        .execute(&db)
        .await
        .map_err(|_| DB_ERROR)?;
    sqlx::query("DELETE FROM sync_write_journal WHERE result='CONFIRMED' AND id NOT IN (SELECT id FROM sync_write_journal ORDER BY created_at DESC LIMIT 20)").execute(&db).await.map_err(|_| DB_ERROR)?;
    Ok(())
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Deadline {
    #[serde(rename = "type")]
    kind: String,
    label: String,
    exact: Option<String>,
    range_start: Option<String>,
    range_end: Option<String>,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct IncomingTask {
    id: String,
    expected_revision: Option<i64>,
    title: String,
    description: String,
    category: String,
    status: String,
    deadline: Deadline,
    snooze_until: Option<String>,
    remote_hash: String,
    restore: bool,
}
fn iso(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value).is_ok()
}
fn valid_input(t: &IncomingTask) -> bool {
    uuid::Uuid::parse_str(&t.id).is_ok()
        && !t.title.trim().is_empty()
        && t.title.len() <= 2000
        && t.description.len() <= 200000
        && t.category.len() <= 800
        && ["TODO", "IN_PROGRESS", "COMPLETED"].contains(&t.status.as_str())
        && t.snooze_until.as_deref().is_none_or(iso)
        && t.remote_hash.len() == 64
        && t.remote_hash.bytes().all(|c| c.is_ascii_hexdigit())
        && match t.deadline.kind.as_str() {
            "ASAP" => true,
            "EXACT" => t.deadline.exact.as_deref().is_some_and(iso),
            "FUZZY_RANGE" => {
                (t.deadline.label == "急ぎではない"
                    && t.deadline.exact.is_none()
                    && t.deadline.range_start.is_none()
                    && t.deadline.range_end.is_none())
                    || (t.deadline.range_start.as_deref().is_some_and(iso)
                        && t.deadline.range_end.as_deref().is_some_and(iso)
                        && match (&t.deadline.range_start, &t.deadline.range_end) {
                            (Some(a), Some(b)) => {
                                DateTime::parse_from_rfc3339(a).ok()
                                    <= DateTime::parse_from_rfc3339(b).ok()
                            }
                            _ => false,
                        })
            }
            _ => false,
        }
}
async fn apply_one(
    db: &SqlitePool,
    input: &IncomingTask,
    sub: &str,
    email: &str,
) -> Result<i64, String> {
    if !valid_input(input) {
        return Err("シートのタスク入力が不正です。".into());
    }
    // Reserve writer at transaction start, then compare revision before touching any data.
    let mut tx = db
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| DB_ERROR)?;
    let before = sqlx::query("SELECT * FROM tasks WHERE id=?")
        .bind(&input.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| DB_ERROR)?;
    if before.as_ref().map(|r| r.get::<i64, _>("revision")) != input.expected_revision {
        return Err(
            "LOCAL_CHANGED|同期中にローカルタスクが変更されました。再同期してください。".into(),
        );
    }
    if before
        .as_ref()
        .is_some_and(|r| r.get::<String, _>("workspace_id") != WORKSPACE)
    {
        return Err("別のワークスペースのタスクです。".into());
    }
    if before
        .as_ref()
        .is_some_and(|r| r.get::<Option<String>, _>("deleted_at").is_some())
        && !input.restore
    {
        return Err("削除済みタスクは競合画面で確認してください。".into());
    }
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let actor = format!("google:{sub}");
    sqlx::query("INSERT INTO actors(id,display_name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name").bind(&actor).bind(format!("Google Sheets ({email})")).bind(&now).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    let category: Option<String> = if input.category.trim().is_empty() {
        None
    } else {
        let matches = sqlx::query(
            "SELECT id FROM categories WHERE workspace_id=? AND name=? AND deleted_at IS NULL",
        )
        .bind(WORKSPACE)
        .bind(input.category.trim())
        .fetch_all(&mut *tx)
        .await
        .map_err(|_| DB_ERROR)?;
        if matches.len() > 1 {
            return Err("同名の分類が複数あります。分類名を整理してください。".into());
        }
        if let Some(row) = matches.first() {
            Some(row.get("id"))
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO categories(id,workspace_id,name,color,sort_order,created_at,updated_at) VALUES(?,?,?,'slate',(SELECT COALESCE(MAX(sort_order),-1)+1 FROM categories),?,?)").bind(&id).bind(WORKSPACE).bind(input.category.trim()).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
            Some(id)
        }
    };
    let new_revision = input.expected_revision.unwrap_or(0) + 1;
    let mut postponed = false;
    let mut old_deadline = Value::Null;
    let mut deadline_changed = false;
    if let Some(row) = &before {
        old_deadline = json!({"type":row.get::<String,_>("deadline_type"),"label":row.get::<String,_>("deadline_label"),"exact":row.get::<Option<String>,_>("deadline_exact"),"rangeStart":row.get::<Option<String>,_>("deadline_range_start"),"rangeEnd":row.get::<Option<String>,_>("deadline_range_end")});
        deadline_changed = old_deadline != json!(input.deadline);
        let old_end = row
            .get::<Option<String>, _>("deadline_exact")
            .or(row.get::<Option<String>, _>("deadline_range_end"));
        let new_end = input
            .deadline
            .exact
            .as_ref()
            .or(input.deadline.range_end.as_ref());
        if let (Some(old), Some(new)) = (old_end, new_end) {
            if let (Ok(a), Ok(b)) = (
                DateTime::parse_from_rfc3339(&old),
                DateTime::parse_from_rfc3339(new),
            ) {
                postponed = b > a;
            }
        }
        let old_status: String = row.get("status");
        let completed = if input.status == "COMPLETED" {
            row.get::<Option<String>, _>("completed_at")
                .or(Some(now.clone()))
        } else {
            None
        };
        let started = if input.status == "IN_PROGRESS" {
            row.get::<Option<String>, _>("started_at")
                .or(Some(now.clone()))
        } else {
            row.get("started_at")
        };
        sqlx::query("UPDATE tasks SET title=?,description=?,category_id=?,status=?,deadline_type=?,deadline_label=?,deadline_exact=?,deadline_range_start=?,deadline_range_end=?,snooze_until=?,updated_at=?,started_at=?,completed_at=?,revision=?,postponement_count=postponement_count+?,deleted_at=NULL WHERE id=?")
            .bind(input.title.trim()).bind(&input.description).bind(&category).bind(&input.status).bind(&input.deadline.kind).bind(&input.deadline.label).bind(&input.deadline.exact).bind(&input.deadline.range_start).bind(&input.deadline.range_end).bind(&input.snooze_until).bind(&now).bind(started).bind(completed).bind(new_revision).bind(i64::from(postponed)).bind(&input.id).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
        for (event, old, new) in [
            (
                "TITLE_CHANGED",
                json!(row.get::<String, _>("title")),
                json!(input.title.trim()),
            ),
            (
                "DESCRIPTION_CHANGED",
                json!(row.get::<String, _>("description")),
                json!(input.description),
            ),
            (
                "CATEGORY_CHANGED",
                json!(row.get::<Option<String>, _>("category_id")),
                json!(category),
            ),
            ("STATUS_CHANGED", json!(old_status), json!(input.status)),
            (
                "SNOOZE_CHANGED",
                json!(row.get::<Option<String>, _>("snooze_until")),
                json!(input.snooze_until),
            ),
        ] {
            if old != new {
                history(&mut tx, &input.id, &actor, event, old, new, &now).await?;
            }
        }
        if input.restore {
            history(
                &mut tx,
                &input.id,
                &actor,
                "TASK_RESTORED",
                json!(row.get::<Option<String>, _>("deleted_at")),
                Value::Null,
                &now,
            )
            .await?;
        }
    } else {
        sqlx::query("INSERT INTO tasks(id,workspace_id,title,description,category_id,status,deadline_type,deadline_label,deadline_exact,deadline_range_start,deadline_range_end,snooze_until,created_at,updated_at,started_at,completed_at,revision,postponement_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)")
            .bind(&input.id).bind(WORKSPACE).bind(input.title.trim()).bind(&input.description).bind(&category).bind(&input.status).bind(&input.deadline.kind).bind(&input.deadline.label).bind(&input.deadline.exact).bind(&input.deadline.range_start).bind(&input.deadline.range_end).bind(&input.snooze_until).bind(&now).bind(&now).bind(if input.status=="IN_PROGRESS" {Some(&now)} else {None}).bind(if input.status=="COMPLETED" {Some(&now)} else {None}).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
        history(
            &mut tx,
            &input.id,
            &actor,
            "TASK_CREATED",
            Value::Null,
            json!({"title":input.title,"deadline":input.deadline}),
            &now,
        )
        .await?;
    }
    if deadline_changed {
        let mut new = json!(input.deadline);
        new["direction"] = json!(if postponed { "POSTPONED" } else { "CHANGED" });
        history(
            &mut tx,
            &input.id,
            &actor,
            "DEADLINE_CHANGED",
            old_deadline,
            new,
            &now,
        )
        .await?;
    }
    acknowledge_tx(
        &mut tx,
        &Acknowledgement {
            entity_id: input.id.clone(),
            local_revision: new_revision,
            remote_hash: input.remote_hash.clone(),
        },
    )
    .await?;
    tx.commit().await.map_err(|_| DB_ERROR)?;
    Ok(new_revision)
}
async fn history(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    actor: &str,
    event: &str,
    old: Value,
    new: Value,
    now: &str,
) -> Result<(), String> {
    sqlx::query("INSERT INTO task_history(id,task_id,actor_id,event_type,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)").bind(uuid::Uuid::new_v4().to_string()).bind(id).bind(actor).bind(event).bind(old.to_string()).bind(new.to_string()).bind(now).execute(&mut **tx).await.map_err(|_|DB_ERROR)?;
    Ok(())
}
#[tauri::command]
pub async fn google_apply_tasks(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    spreadsheet_id: String,
    changes: Vec<IncomingTask>,
) -> Result<Vec<String>, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    crate::sync_onboarding::require_confirmation(&db).await?;
    if connected_id(&db).await? != spreadsheet_id {
        return Err("同期先が変更されました。".into());
    }
    let row = google::settings(&db).await?;
    let sub: String = row.get("google_sub");
    let email: String = row.get("email");
    let mut errors = Vec::new();
    for change in changes {
        if let Err(e) = apply_one(&db, &change, &sub, &email).await {
            errors.push(format!("{}: {e}", change.id));
        }
    }
    Ok(errors)
}
#[derive(Serialize, Deserialize)]
pub struct Acknowledgement {
    entity_id: String,
    local_revision: i64,
    remote_hash: String,
}
async fn acknowledge_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ack: &Acknowledgement,
) -> Result<(), String> {
    sqlx::query("INSERT INTO sync_entity_state(entity_type,entity_id,last_synced_local_revision,last_synced_remote_hash,last_synced_at) VALUES('TASK',?,?,?,datetime('now')) ON CONFLICT(entity_type,entity_id) DO UPDATE SET last_synced_local_revision=excluded.last_synced_local_revision,last_synced_remote_hash=excluded.last_synced_remote_hash,last_synced_at=excluded.last_synced_at").bind(&ack.entity_id).bind(ack.local_revision).bind(&ack.remote_hash).execute(&mut **tx).await.map_err(|_|DB_ERROR)?;
    sqlx::query("UPDATE sync_conflicts SET resolved_at=datetime('now') WHERE entity_type='TASK' AND entity_id=? AND resolved_at IS NULL").bind(&ack.entity_id).execute(&mut **tx).await.map_err(|_|DB_ERROR)?;
    Ok(())
}
#[tauri::command]
pub async fn google_acknowledge(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    spreadsheet_id: String,
    items: Vec<Acknowledgement>,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    crate::sync_onboarding::require_confirmation(&db).await?;
    if connected_id(&db).await? != spreadsheet_id {
        return Err("同期先が変更されました。".into());
    }
    let mut tx = db.begin().await.map_err(|_| DB_ERROR)?;
    for ack in items {
        acknowledge_tx(&mut tx, &ack).await?;
    }
    tx.commit().await.map_err(|_| DB_ERROR)?;
    Ok(())
}
#[derive(Deserialize)]
pub struct ConflictInput {
    entity_id: String,
    local_json: String,
    remote_json: String,
}
#[tauri::command]
pub async fn google_conflicts(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    spreadsheet_id: String,
    items: Vec<ConflictInput>,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    crate::sync_onboarding::require_confirmation(&db).await?;
    if connected_id(&db).await? != spreadsheet_id {
        return Err("同期先が変更されました。".into());
    }
    for c in items {
        sqlx::query("INSERT INTO sync_conflicts(id,entity_type,entity_id,local_json,remote_json,detected_at) VALUES(?,'TASK',?,?,?,datetime('now')) ON CONFLICT DO UPDATE SET local_json=excluded.local_json,remote_json=excluded.remote_json,resolution=NULL,detected_at=excluded.detected_at").bind(uuid::Uuid::new_v4().to_string()).bind(c.entity_id).bind(c.local_json).bind(c.remote_json).execute(&db).await.map_err(|_|DB_ERROR)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn google_resolve_conflict(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    id: String,
    resolution: String,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    if !["LOCAL", "REMOTE"].contains(&resolution.as_str()) {
        return Err("競合の選択が不正です。".into());
    }
    sqlx::query("UPDATE sync_conflicts SET resolution=? WHERE id=? AND resolved_at IS NULL")
        .bind(resolution)
        .bind(id)
        .execute(&google::pool(&app).await?)
        .await
        .map_err(|_| DB_ERROR)?;
    Ok(())
}
#[tauri::command]
pub async fn google_sync_preferences(
    app: tauri::AppHandle,
    auto_sync: bool,
    poll_seconds: i64,
) -> Result<(), String> {
    if ![60, 120, 300].contains(&poll_seconds) {
        return Err("同期間隔が不正です。".into());
    }
    sqlx::query("UPDATE google_sync_settings SET auto_sync=?,poll_seconds=? WHERE workspace_id=?")
        .bind(i64::from(auto_sync))
        .bind(poll_seconds)
        .bind(WORKSPACE)
        .execute(&google::pool(&app).await?)
        .await
        .map_err(|_| DB_ERROR)?;
    Ok(())
}
#[tauri::command]
pub async fn google_sync_report(
    app: tauri::AppHandle,
    error: Option<String>,
) -> Result<(), String> {
    let db = google::pool(&app).await?;
    sqlx::query("UPDATE google_sync_settings SET last_success_at=CASE WHEN ? IS NULL THEN datetime('now') ELSE last_success_at END,last_error=? WHERE workspace_id=?").bind(&error).bind(&error).bind(WORKSPACE).execute(&db).await.map_err(|_|DB_ERROR)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn non_urgent_has_no_artificial_due_date() {
        let mut t = incoming();
        t.deadline.kind = "FUZZY_RANGE".into();
        t.deadline.label = "急ぎではない".into();
        t.deadline.exact = None;
        assert!(valid_input(&t));
        t.deadline.label = "broken".into();
        assert!(!valid_input(&t));
    }
    fn incoming() -> IncomingTask {
        IncomingTask {
            id: "11111111-1111-4111-8111-111111111111".into(),
            expected_revision: None,
            title: "Report".into(),
            description: "Details".into(),
            category: "Finance".into(),
            status: "TODO".into(),
            deadline: Deadline {
                kind: "EXACT".into(),
                label: "2026/09/18".into(),
                exact: Some("2026-09-18T14:59:59.999Z".into()),
                range_start: None,
                range_end: None,
            },
            snooze_until: None,
            remote_hash: "a".repeat(64),
            restore: false,
        }
    }
    async fn database() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_init.sql"),
            include_str!("../migrations/0002_query_indexes.sql"),
            include_str!("../migrations/0003_fts_search.sql"),
            include_str!("../migrations/0004_category_color.sql"),
            include_str!("../migrations/0005_check_items.sql"),
            include_str!("../migrations/0006_google_sync.sql"),
            include_str!("../migrations/0007_task_sync.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        pool
    }
    #[test]
    fn remote_task_transaction_history_and_revision_guard() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let db=database().await;let mut input=incoming();
            assert_eq!(apply_one(&db,&input,"test-sub","test@example.invalid").await.unwrap(),1);
            let row=sqlx::query("SELECT t.*,c.color FROM tasks t JOIN categories c ON c.id=t.category_id").fetch_one(&db).await.unwrap();
            assert_eq!(row.get::<String,_>("color"),"slate");
            input.expected_revision=Some(1);input.title="Changed".into();input.status="COMPLETED".into();input.deadline.exact=Some("2026-09-20T14:59:59.999Z".into());
            assert_eq!(apply_one(&db,&input,"test-sub","test@example.invalid").await.unwrap(),2);
            let row=sqlx::query("SELECT * FROM tasks").fetch_one(&db).await.unwrap();
            assert_eq!(row.get::<i64,_>("postponement_count"),1);assert!(row.get::<Option<String>,_>("completed_at").is_some());
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM task_history WHERE actor_id='google:test-sub' AND event_type='DEADLINE_CHANGED'").fetch_one(&db).await.unwrap(),1);
            input.category="Should not be created".into();
            assert!(apply_one(&db,&input,"test-sub","test@example.invalid").await.unwrap_err().contains("LOCAL_CHANGED"));
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM categories").fetch_one(&db).await.unwrap(),1);
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT last_synced_local_revision FROM sync_entity_state").fetch_one(&db).await.unwrap(),2);
        });
    }
    #[test]
    fn history_failure_rolls_back_task_category_and_sync_state() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let db=database().await;let input=incoming();
            sqlx::raw_sql("CREATE TRIGGER fail_history BEFORE INSERT ON task_history BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;").execute(&db).await.unwrap();
            assert!(apply_one(&db,&input,"test-sub","test@example.invalid").await.is_err());
            for table in ["tasks","categories","sync_entity_state"] { assert_eq!(sqlx::query_scalar::<_,i64>(&format!("SELECT COUNT(*) FROM {table}")).fetch_one(&db).await.unwrap(),0); }
        });
    }
    #[test]
    fn snapshot_uses_sheet_id_and_keeps_physical_rows() {
        let meta = json!({"sheets":[{"properties":{"sheetId":100,"title":"Renamed","gridProperties":{"rowCount":2}},"data":[{"startRow":0,"rowData":[{"values":[{"formattedValue":"task_id"}]},{},{"values":[{"formattedValue":"id"},{"formattedValue":"task"}]}]}]}]});
        let snapshot = snapshot_from_json("sheet", meta).unwrap();
        assert_eq!(snapshot.rows.len(), 3);
        assert_eq!(snapshot.rows[2][1], "task");
        assert!(
            snapshot_from_json("sheet", json!({"sheets":[{"properties":{"sheetId":200}}]}))
                .unwrap_err()
                .contains("MISSING_TAB")
        );
    }
    #[test]
    fn writes_grow_grid_and_do_not_execute_formulas() {
        let current = RemoteSheet {
            spreadsheet_id: "sheet".into(),
            version: "hash".into(),
            rows: vec![],
            grid_rows: 2,
        };
        let mut values = vec![String::new(); 14];
        values[0] = incoming().id;
        values[1] = "=IMPORTDATA(\"https://example.invalid\")".into();
        let request = patch_requests(
            &current,
            &[Patch {
                row_index: 5,
                values,
            }],
        )
        .unwrap();
        assert_eq!(request[0]["appendDimension"]["length"], 4);
        assert!(
            request[1]["updateCells"]["rows"][0]["values"][1]["userEnteredValue"]["formulaValue"]
                .is_null()
        );
        assert!(patch_requests(
            &current,
            &[Patch {
                row_index: 0,
                values: vec![incoming().id]
            }]
        )
        .is_err());
    }
}
