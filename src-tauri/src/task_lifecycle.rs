//! Deletion/undo is synchronized before ordinary task and checklist content.
//! A hidden ID-only ledger prevents an offline PC from resurrecting removed rows.
use crate::{
    google::{self, GoogleState, DB_ERROR, WORKSPACE},
    task_sync::request_json,
};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, BTreeSet};
use tauri::State;

const HEADERS: [&str; 5] = [
    "task_id",
    "state",
    "operation_id",
    "changed_at",
    "base_operation_id",
];
#[derive(Clone, Debug, PartialEq)]
struct Life {
    id: String,
    state: String,
    op: String,
    at: String,
    base: String,
    dirty: bool,
}
impl Life {
    fn cells(&self) -> Vec<String> {
        vec![
            self.id.clone(),
            self.state.clone(),
            self.op.clone(),
            self.at.clone(),
            self.base.clone(),
        ]
    }
    fn parse(row: &[String]) -> Result<Self, String> {
        if row.len() != 5
            || uuid::Uuid::parse_str(&row[0]).is_err()
            || !["DELETED", "ACTIVE"].contains(&row[1].as_str())
            || row[2].is_empty()
            || row[2].len() > 200
            || chrono::DateTime::parse_from_rfc3339(&row[3]).is_err()
        {
            return Err("削除の同期記録が不正です。同期用タブを編集しないでください。".into());
        }
        Ok(Self {
            id: row[0].clone(),
            state: row[1].clone(),
            op: row[2].clone(),
            at: row[3].clone(),
            base: row[4].clone(),
            dirty: false,
        })
    }
}
// Deletion wins over stale content. Undo only supersedes the deletion the user
// actually observed; an unrelated newer deletion cannot be undone accidentally.
fn choose(local: Option<&Life>, remote: Option<&Life>) -> Life {
    match (local, remote) {
        (Some(l), Some(r)) if l.op == r.op => r.clone(),
        (Some(l), Some(r))
            if l.dirty
                && ((l.state == "DELETED" && r.state != "DELETED")
                    || (l.state == "ACTIVE" && l.base == r.op)) =>
        {
            l.clone()
        }
        (_, Some(r)) => r.clone(),
        (Some(l), None) => l.clone(),
        _ => unreachable!(),
    }
}
#[derive(Clone, Debug, PartialEq)]
struct Tab {
    rows: Vec<Vec<String>>,
    capacity: usize,
}
type Snapshot = BTreeMap<i64, Tab>;
async fn read(id: &str, token: &str) -> Result<Snapshot, String> {
    let value=request_json(google::client()?.post(format!("https://sheets.googleapis.com/v4/spreadsheets/{id}:getByDataFilter"))
        .bearer_auth(token).json(&json!({"dataFilters":([100,101,102,103,106].iter().map(|sid|json!({"gridRange":{"sheetId":sid}})).collect::<Vec<_>>()),"includeGridData":true})),true).await?;
    let mut result = BTreeMap::new();
    for sheet in value["sheets"].as_array().ok_or("シート情報が不正です。")? {
        let sid = sheet["properties"]["sheetId"]
            .as_i64()
            .ok_or("シートIDが不正です。")?;
        let width = match sid {
            100 => 14,
            101 | 102 => 8,
            103 => 9,
            106 => 5,
            _ => continue,
        };
        let mut rows: Vec<Vec<String>> = Vec::new();
        for grid in sheet["data"].as_array().into_iter().flatten() {
            let start = grid["startRow"].as_u64().unwrap_or(0) as usize;
            for (offset, row) in grid["rowData"].as_array().into_iter().flatten().enumerate() {
                while rows.len() <= start + offset {
                    rows.push(vec![String::new(); width]);
                }
                for (col, cell) in row["values"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .enumerate()
                    .take(width)
                {
                    rows[start + offset][col] = cell["formattedValue"]
                        .as_str()
                        .or(cell["userEnteredValue"]["stringValue"].as_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
        while rows.last().is_some_and(|r| r.iter().all(String::is_empty)) {
            rows.pop();
        }
        result.insert(
            sid,
            Tab {
                rows,
                capacity: sheet["properties"]["gridProperties"]["rowCount"]
                    .as_u64()
                    .unwrap_or(1000) as usize,
            },
        );
    }
    for sid in [100, 101, 102, 103, 106] {
        let tab = result
            .get(&sid)
            .ok_or("削除同期に必要なタブがありません。再接続してください。")?;
        let header = tab.rows.first().ok_or("シートの見出しがありません。")?;
        if sid == 106 {
            if header.iter().map(String::as_str).collect::<Vec<_>>() != HEADERS {
                return Err("削除の同期記録の見出しが変更されています。".into());
            }
        } else if (sid == 100 && header[0] != "task_id") || (sid != 100 && header[1] != "task_id") {
            return Err("タスクID列の位置が変更されています。削除を中止しました。".into());
        }
    }
    Ok(result)
}
async fn local(db: &SqlitePool) -> Result<BTreeMap<String, Life>, String> {
    // Imports/older app versions can contain soft-deleted tasks without an outbox.
    sqlx::query("INSERT OR IGNORE INTO sync_task_lifecycle(task_id,state,operation_id,changed_at) SELECT id,'DELETED','legacy:'||id||':'||deleted_at,deleted_at FROM tasks WHERE workspace_id=? AND deleted_at IS NOT NULL")
        .bind(WORKSPACE).execute(db).await.map_err(|_|DB_ERROR)?;
    let rows = sqlx::query("SELECT * FROM sync_task_lifecycle")
        .fetch_all(db)
        .await
        .map_err(|_| DB_ERROR)?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let l = Life {
                id: r.get("task_id"),
                state: r.get("state"),
                op: r.get("operation_id"),
                at: r.get("changed_at"),
                base: r.get("base_operation_id"),
                dirty: r.get::<i64, _>("dirty") != 0,
            };
            (l.id.clone(), l)
        })
        .collect())
}
fn ledger(snapshot: &Snapshot) -> Result<BTreeMap<String, (usize, Life)>, String> {
    let mut entries = BTreeMap::new();
    for (index, row) in snapshot[&106].rows.iter().enumerate().skip(1) {
        if row.iter().all(String::is_empty) {
            continue;
        }
        let item = Life::parse(row)?;
        if entries.insert(item.id.clone(), (index, item)).is_some() {
            return Err("削除の同期記録でIDが重複しています。".into());
        }
    }
    Ok(entries)
}
fn deletion_requests(snapshot: &Snapshot, deleted: &BTreeSet<String>) -> Vec<Value> {
    let mut requests = vec![];
    for sid in [100, 101, 102, 103] {
        let col = if sid == 100 { 0 } else { 1 };
        let indices: Vec<usize> = snapshot[&sid]
            .rows
            .iter()
            .enumerate()
            .skip(1)
            .filter(|(_, r)| deleted.contains(&r[col]))
            .map(|(i, _)| i)
            .collect();
        // Descending ranges preserve the observed physical row identity.
        let mut ranges: Vec<(usize, usize)> = vec![];
        for i in indices {
            if let Some(last) = ranges.last_mut() {
                if last.1 == i {
                    last.1 = i + 1;
                    continue;
                }
            }
            ranges.push((i, i + 1));
        }
        for (start, end) in ranges.into_iter().rev() {
            requests.push(json!({"deleteDimension":{"range":{"sheetId":sid,"dimension":"ROWS","startIndex":start,"endIndex":end}}}));
        }
    }
    requests
}
async fn apply(
    db: &SqlitePool,
    chosen: &BTreeMap<String, Life>,
    observed: &BTreeMap<String, Life>,
) -> Result<bool, String> {
    let mut tx = db.begin().await.map_err(|_| DB_ERROR)?;
    let mut changed = false;
    for (id, item) in chosen {
        let current: Option<String> =
            sqlx::query_scalar("SELECT operation_id FROM sync_task_lifecycle WHERE task_id=?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|_| DB_ERROR)?;
        if current.as_deref() != observed.get(id).map(|l| l.op.as_str()) {
            return Err("RETRY|同期中に削除状態が変わりました。再同期します。".into());
        }
        let previous: Option<Option<String>> =
            sqlx::query_scalar("SELECT deleted_at FROM tasks WHERE id=? AND workspace_id=?")
                .bind(id)
                .bind(WORKSPACE)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|_| DB_ERROR)?;
        if let Some(deleted_at) = previous {
            let target = if item.state == "DELETED" {
                Some(item.at.as_str())
            } else {
                None
            };
            if deleted_at.as_deref() != target {
                // First restore an existing deletion timestamp's children only
                // when undoing. Repeated remote deletion must preserve that tag.
                if !(deleted_at.is_some() && target.is_some()) {
                    sqlx::query("UPDATE tasks SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND workspace_id=?")
                        .bind(target).bind(&item.at).bind(id).bind(WORKSPACE).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
                    changed = true;
                }
            }
            if item.state == "DELETED" {
                for table in ["task_check_items", "schedule_events", "resources"] {
                    let q=format!("UPDATE {table} SET deleted_at=?,updated_at=? WHERE task_id=? AND deleted_at IS NULL");
                    // Use the parent's actual tag so undo does not revive items
                    // individually deleted before the parent.
                    let tag = deleted_at.as_deref().unwrap_or(&item.at);
                    changed |= sqlx::query(&q)
                        .bind(tag)
                        .bind(&item.at)
                        .bind(id)
                        .execute(&mut *tx)
                        .await
                        .map_err(|_| DB_ERROR)?
                        .rows_affected()
                        > 0;
                }
            }
        }
        // Removed rows must not be treated as unexplained missing rows on undo.
        if observed.get(id).is_none_or(|l| l.op != item.op || l.dirty)
            || item.state == "DELETED"
            || item.dirty
        {
            sqlx::query("DELETE FROM sync_entity_state WHERE entity_type='TASK' AND entity_id=?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|_| DB_ERROR)?;
            sqlx::query("DELETE FROM related_sync_state WHERE entity_type='CHECK_ITEM' AND entity_id IN (SELECT id FROM task_check_items WHERE task_id=?)").bind(id).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
            sqlx::query("DELETE FROM sync_conflicts WHERE (entity_type='TASK' AND entity_id=?) OR (entity_type='CHECK_ITEM' AND entity_id IN (SELECT id FROM task_check_items WHERE task_id=?))").bind(id).bind(id).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
        }
        sqlx::query("INSERT INTO sync_task_lifecycle(task_id,state,operation_id,changed_at,base_operation_id,dirty) VALUES(?,?,?,?,?,0) ON CONFLICT(task_id) DO UPDATE SET state=excluded.state,operation_id=excluded.operation_id,changed_at=excluded.changed_at,base_operation_id=excluded.base_operation_id,dirty=0")
            .bind(id).bind(&item.state).bind(&item.op).bind(&item.at).bind(&item.base).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    }
    tx.commit().await.map_err(|_| DB_ERROR)?;
    Ok(changed)
}
#[derive(Serialize)]
pub struct Summary {
    changed: bool,
}
#[tauri::command]
pub async fn google_sync_task_lifecycle(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> Result<Summary, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "BUSY|Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    crate::sync_onboarding::require_confirmation(&db).await?;
    let id = crate::task_sync::connected_id(&db).await?;
    let token = google::access_token(&db).await?;
    synchronize(&db, &id, &token).await
}

pub(crate) async fn synchronize(db: &SqlitePool, id: &str, token: &str) -> Result<Summary, String> {
    let snapshot = read(id, token).await?;
    let observed = local(&db).await?;
    let mut remote = ledger(&snapshot)?;
    let persisted = remote.clone();
    // Migrate old visible tombstones before removing their rows.
    for row in snapshot[&100]
        .rows
        .iter()
        .skip(1)
        .filter(|r| !r[12].is_empty())
    {
        if uuid::Uuid::parse_str(&row[0]).is_err()
            || chrono::DateTime::parse_from_rfc3339(&row[12]).is_err()
        {
            return Err("削除行のID・削除日時が不正です。削除を中止しました。".into());
        }
        remote.entry(row[0].clone()).or_insert_with(|| {
            (
                usize::MAX,
                Life {
                    id: row[0].clone(),
                    state: "DELETED".into(),
                    op: format!("legacy:{}:{}", row[0], row[12]),
                    at: row[12].clone(),
                    base: String::new(),
                    dirty: false,
                },
            )
        });
    }
    let ids: BTreeSet<String> = observed.keys().chain(remote.keys()).cloned().collect();
    let chosen: BTreeMap<String, Life> = ids
        .into_iter()
        .map(|id| {
            let item = choose(observed.get(&id), remote.get(&id).map(|(_, l)| l));
            (id, item)
        })
        .collect();
    let deleted = chosen
        .iter()
        .filter(|(_, l)| l.state == "DELETED")
        .map(|(id, _)| id.clone())
        .collect();
    let mut requests = vec![];
    let mut next = snapshot[&106].rows.len().max(1);
    for (id, item) in &chosen {
        if persisted
            .get(id)
            .is_some_and(|(_, r)| r.cells() == item.cells())
        {
            continue;
        }
        let index = persisted
            .get(id)
            .map(|(index, _)| *index)
            .unwrap_or_else(|| {
                let index = next;
                next += 1;
                index
            });
        requests.push(json!({"updateCells":{"start":{"sheetId":106,"rowIndex":index,"columnIndex":0},"rows":[{"values":item.cells().iter().map(|s|json!({"userEnteredValue":{"stringValue":s}})).collect::<Vec<_>>()}],"fields":"userEnteredValue"}}));
    }
    if next > snapshot[&106].capacity {
        requests.insert(0,json!({"appendDimension":{"sheetId":106,"dimension":"ROWS","length":next-snapshot[&106].capacity}}));
    }
    requests.extend(deletion_requests(&snapshot, &deleted));
    if requests.len() > 1000 {
        return Err("削除対象が多すぎます。同期を中止しました。".into());
    }
    if !requests.is_empty() {
        if read(&id, &token).await? != snapshot {
            return Err("RETRY|同期中にシートが変更されました。再同期します。".into());
        }
        // One atomic Sheets batch: persist deletion identities AND remove rows.
        // Never retry a positional delete blindly after an uncertain response.
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
        let after = read(&id, &token).await?;
        let recorded = ledger(&after)?;
        if chosen
            .iter()
            .any(|(id, l)| recorded.get(id).is_none_or(|(_, r)| r.cells() != l.cells()))
            || !deletion_requests(&after, &deleted).is_empty()
        {
            return Err("RETRY|削除結果の確認中に変更がありました。再同期します。".into());
        }
    }
    let local_changed = apply(&db, &chosen, &observed).await?;
    Ok(Summary {
        changed: local_changed || !requests.is_empty(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn database() -> SqlitePool {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
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
            include_str!("../migrations/0008_related_sync.sql"),
            include_str!("../migrations/0009_sync_confirmation.sql"),
            include_str!("../migrations/0010_task_lifecycle.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&db).await.unwrap();
        }
        let id = life("DELETED", "d1", "", false).id;
        sqlx::query("INSERT INTO tasks(id,workspace_id,title,status,deadline_type,deadline_label,created_at,updated_at) VALUES(?,?,'Task','TODO','ASAP','ASAP','2026-09-14T00:00:00Z','2026-09-14T00:00:00Z')").bind(&id).bind(WORKSPACE).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO task_check_items(id,task_id,text,created_at,updated_at) VALUES('check',?,'Check','2026-09-14T00:00:00Z','2026-09-14T00:00:00Z')").bind(&id).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO schedule_events(id,task_id,title,starts_at,created_at,updated_at) VALUES('event',?,'Event','2026-09-16T00:00:00Z','2026-09-14T00:00:00Z','2026-09-14T00:00:00Z')").bind(&id).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO resources(id,task_id,type,label,value,created_at,updated_at,deleted_at) VALUES('resource',?,'URL','Link','https://example.com','2026-09-14T00:00:00Z','2026-09-14T00:00:00Z','2026-09-14T01:00:00Z')").bind(&id).execute(&db).await.unwrap();
        db
    }
    #[test]
    fn remote_delete_cascades_and_undo_preserves_individual_deletions() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let db = database().await;
            let deleted = life("DELETED", "d1", "", false);
            let chosen = BTreeMap::from([(deleted.id.clone(), deleted.clone())]);
            assert!(apply(&db, &chosen, &BTreeMap::new()).await.unwrap());
            for table in ["tasks", "task_check_items", "schedule_events", "resources"] {
                let n: i64 = sqlx::query_scalar(&format!(
                    "SELECT COUNT(*) FROM {table} WHERE deleted_at IS NULL"
                ))
                .fetch_one(&db)
                .await
                .unwrap();
                assert_eq!(n, 0);
            }
            let observed = local(&db).await.unwrap();
            assert!(!apply(&db, &chosen, &observed).await.unwrap());
            sqlx::query(
                "UPDATE tasks SET deleted_at=NULL,updated_at='2026-09-15T01:00:00Z' WHERE id=?",
            )
            .bind(&deleted.id)
            .execute(&db)
            .await
            .unwrap();
            let restored = local(&db).await.unwrap();
            assert_eq!(restored[&deleted.id].base, "d1");
            assert!(restored[&deleted.id].dirty);
            for table in ["tasks", "task_check_items", "schedule_events"] {
                let n: i64 = sqlx::query_scalar(&format!(
                    "SELECT COUNT(*) FROM {table} WHERE deleted_at IS NULL"
                ))
                .fetch_one(&db)
                .await
                .unwrap();
                assert_eq!(n, 1);
            }
            let n: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM resources WHERE deleted_at IS NULL")
                    .fetch_one(&db)
                    .await
                    .unwrap();
            assert_eq!(n, 0);
            assert!(apply(&db, &chosen, &observed)
                .await
                .unwrap_err()
                .starts_with("RETRY|"));
        });
    }
    fn life(state: &str, op: &str, base: &str, dirty: bool) -> Life {
        Life {
            id: "11111111-1111-4111-8111-111111111111".into(),
            state: state.into(),
            op: op.into(),
            at: "2026-09-15T00:00:00Z".into(),
            base: base.into(),
            dirty,
        }
    }
    #[test]
    fn stale_pc_cannot_resurrect_deleted_task() {
        let r = life("DELETED", "d1", "", false);
        assert_eq!(choose(None, Some(&r)), r);
        let undo = life("ACTIVE", "a1", "old", true);
        assert_eq!(choose(Some(&undo), Some(&r)), r);
    }
    #[test]
    fn undo_requires_reviewed_deletion_and_redelete_wins() {
        let r = life("DELETED", "d1", "", false);
        let undo = life("ACTIVE", "a1", "d1", true);
        assert_eq!(choose(Some(&undo), Some(&r)), undo);
        let again = life("DELETED", "d2", "d1", true);
        assert_eq!(choose(Some(&again), Some(&undo)), again);
    }
    #[test]
    fn repeated_deletion_converges() {
        let l = life("DELETED", "d1", "", true);
        let r = life("DELETED", "d2", "", false);
        assert_eq!(choose(Some(&l), Some(&r)), r);
    }
    #[test]
    fn cleanup_only_removes_matching_parent_rows_descending() {
        let id = "target".to_string();
        let mut snapshot = BTreeMap::new();
        snapshot.insert(
            100,
            Tab {
                capacity: 10,
                rows: vec![
                    vec!["task_id".into()],
                    vec![id.clone()],
                    vec!["keep".into()],
                    vec![id.clone()],
                ],
            },
        );
        for sid in [101, 102, 103] {
            snapshot.insert(
                sid,
                Tab {
                    capacity: 10,
                    rows: vec![
                        vec!["id".into(), "task_id".into()],
                        vec!["child".into(), id.clone()],
                        vec!["other".into(), "keep".into()],
                    ],
                },
            );
        }
        let r = deletion_requests(&snapshot, &BTreeSet::from([id]));
        assert_eq!(r.len(), 5);
        assert_eq!(r[0]["deleteDimension"]["range"]["startIndex"], 3);
        assert_eq!(r[1]["deleteDimension"]["range"]["startIndex"], 1);
        assert_eq!(r[4]["deleteDimension"]["range"]["sheetId"], 103);
    }
}
