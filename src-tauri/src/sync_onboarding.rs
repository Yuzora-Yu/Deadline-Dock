//! Read-only initial merge preview; every sync mutation is gated until acceptance.
use crate::{
    google::{self, GoogleState, DB_ERROR, WORKSPACE},
    related_sync::{self, Kind},
    task_sync,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use tauri::State;

pub(crate) async fn require_confirmation(db: &SqlitePool) -> Result<(), String> {
    if google::settings(db)
        .await?
        .get::<i64, _>("initial_sync_confirmed")
        == 0
    {
        return Err("MERGE_CONFIRMATION|設定で初回同期の内容を確認してください。".into());
    }
    Ok(())
}
#[derive(Serialize)]
pub struct Preview {
    spreadsheet_id: String,
    fingerprint: String,
    local_tasks: usize,
    remote_tasks: usize,
    shared_ids: usize,
    same_title_separate_ids: usize,
}
async fn local_snapshot(db: &SqlitePool) -> Result<Value, String> {
    let tasks:Vec<String>=sqlx::query_scalar("SELECT json_array(id,title,revision,description,category_id,deadline_type,deadline_label,deadline_exact,deadline_range_start,deadline_range_end,status,snooze_until,deleted_at) FROM tasks WHERE workspace_id=? ORDER BY id").bind(WORKSPACE).fetch_all(db).await.map_err(|_|DB_ERROR)?;
    Ok(
        json!({"tasks":tasks,"categories":related_sync::local_rows(db,Kind::Category).await?,"checks":related_sync::local_rows(db,Kind::Check).await?}),
    )
}
async fn preview(db: &SqlitePool) -> Result<(Preview, Vec<Vec<String>>, Value), String> {
    let id = task_sync::connected_id(db).await?;
    let token = google::access_token(db).await?;
    let local = local_snapshot(db).await?;
    let remote = task_sync::read_sheet(&id, &token).await?;
    let categories = related_sync::read(&id, &token, Kind::Category).await?.rows;
    let checks = related_sync::read(&id, &token, Kind::Check).await?.rows;
    let tasks: Vec<Value> = local["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| serde_json::from_str(s.as_str().unwrap()).map_err(|_| DB_ERROR))
        .collect::<Result<_, _>>()?;
    let live: Vec<&Value> = tasks.iter().filter(|r| r[12].is_null()).collect();
    let live_remote: Vec<&Vec<String>> = remote
        .rows
        .iter()
        .skip(1)
        .filter(|r| {
            r.get(1).is_some_and(|s| !s.trim().is_empty()) && r.get(12).is_none_or(String::is_empty)
        })
        .collect();
    let shared_ids = live_remote
        .iter()
        .filter(|r| live.iter().any(|l| l[0].as_str() == Some(r[0].as_str())))
        .count();
    let same_title_separate_ids = live_remote
        .iter()
        .filter(|r| {
            live.iter().any(|l| {
                l[1].as_str().map(str::trim) == Some(r[1].trim())
                    && l[0].as_str() != Some(r[0].as_str())
            })
        })
        .count();
    let fingerprint=format!("{:x}",Sha256::digest(json!({"id":id,"local":local,"remote":remote.rows,"categories":categories,"checks":checks}).to_string().as_bytes()));
    Ok((
        Preview {
            spreadsheet_id: id,
            fingerprint,
            local_tasks: live.len(),
            remote_tasks: live_remote.len(),
            shared_ids,
            same_title_separate_ids,
        },
        categories,
        local,
    ))
}
#[tauri::command]
pub async fn google_preview_merge(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> Result<Preview, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "Google連携の処理中です。")?;
    Ok(preview(&google::pool(&app).await?).await?.0)
}
#[tauri::command]
pub async fn google_confirm_merge(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    fingerprint: String,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "Google連携の処理中です。")?;
    let db = google::pool(&app).await?;
    let (current, categories, local) = preview(&db).await?;
    if current.fingerprint != fingerprint {
        return Err("内容が変更されました。もう一度プレビューを確認してください。".into());
    }
    let mut tx = db
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| DB_ERROR)?;
    align_categories(&mut tx, &categories, &local).await?;
    sqlx::query("UPDATE google_sync_settings SET initial_sync_confirmed=1 WHERE workspace_id=? AND spreadsheet_id=?").bind(WORKSPACE).bind(current.spreadsheet_id).execute(&mut *tx).await.map_err(|_|DB_ERROR)?;
    tx.commit().await.map_err(|_| DB_ERROR)?;
    Ok(())
}

async fn align_categories(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    categories: &[Vec<String>],
    local: &Value,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    // Names are the sheet's task/category link. Unify only unique exact names;
    // keep this PC's attributes so differences still appear as normal conflicts.
    let locals = local["categories"].as_object().ok_or(DB_ERROR)?;
    for remote in categories
        .iter()
        .skip(1)
        .filter(|r| r.len() == 6 && r[5].is_empty())
    {
        if locals.contains_key(&remote[0]) || uuid::Uuid::parse_str(&remote[0]).is_err() {
            continue;
        }
        let matches: Vec<_> = locals
            .values()
            .filter(|l| l[1].as_str() == Some(remote[1].as_str()) && l[5].as_str() == Some(""))
            .collect();
        if matches.len() != 1
            || categories
                .iter()
                .skip(1)
                .filter(|r| r.get(1) == Some(&remote[1]) && r.get(5).is_some_and(String::is_empty))
                .count()
                != 1
        {
            continue;
        }
        let old = matches[0];
        let old_id = old[0].as_str().ok_or(DB_ERROR)?;
        let before:Option<String>=sqlx::query_scalar("SELECT json_array(id,name,color,CAST(sort_order AS TEXT),updated_at,COALESCE(deleted_at,'')) FROM categories WHERE id=? AND workspace_id=?").bind(old_id).bind(WORKSPACE).fetch_optional(&mut **tx).await.map_err(|_|DB_ERROR)?;
        if before.as_deref() != Some(old.to_string().as_str()) {
            return Err("分類が変更されました。プレビューを再確認してください。".into());
        }
        sqlx::query("INSERT INTO categories(id,workspace_id,name,color,sort_order,created_at,updated_at) SELECT ?,workspace_id,name,color,sort_order,created_at,updated_at FROM categories WHERE id=?").bind(&remote[0]).bind(old_id).execute(&mut **tx).await.map_err(|_|DB_ERROR)?;
        sqlx::query("UPDATE tasks SET category_id=?,revision=revision+1,updated_at=? WHERE category_id=? AND workspace_id=?").bind(&remote[0]).bind(&now).bind(old_id).bind(WORKSPACE).execute(&mut **tx).await.map_err(|_|DB_ERROR)?;
        sqlx::query("UPDATE categories SET deleted_at=?,updated_at=? WHERE id=?")
            .bind(&now)
            .bind(&now)
            .bind(old_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| DB_ERROR)?;
    }
    Ok(())
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
    fn new_connections_block_but_existing_syncs_keep_working() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            for existing in [false, true] {
                let db = database().await;
                if existing {
                    sqlx::query(
                        "UPDATE google_sync_settings SET last_success_at='2026-09-15 00:00:00'",
                    )
                    .execute(&db)
                    .await
                    .unwrap();
                }
                sqlx::raw_sql(include_str!("../migrations/0009_sync_confirmation.sql"))
                    .execute(&db)
                    .await
                    .unwrap();
                assert_eq!(require_confirmation(&db).await.is_ok(), existing);
                sqlx::query("UPDATE google_sync_settings SET initial_sync_confirmed=1")
                    .execute(&db)
                    .await
                    .unwrap();
                assert!(require_confirmation(&db).await.is_ok());
            }
        });
    }
    #[test]
    fn category_merge_preserves_tasks_and_local_attributes() {
        tokio::runtime::Runtime::new().unwrap().block_on(async{
            let db=database().await;
            let old="11111111-1111-4111-8111-111111111111";let new="22222222-2222-4222-8222-222222222222";
            sqlx::query("INSERT INTO categories(id,workspace_id,name,color,sort_order,created_at,updated_at) VALUES(?,?,'仕事','blue',0,'now','now')").bind(old).bind(WORKSPACE).execute(&db).await.unwrap();
            sqlx::query("INSERT INTO tasks(id,workspace_id,title,category_id,status,deadline_type,deadline_label,created_at,updated_at) VALUES('33333333-3333-4333-8333-333333333333',?,'Keep task',?,'TODO','ASAP','ASAP','now','now')").bind(WORKSPACE).bind(old).execute(&db).await.unwrap();
            let local=local_snapshot(&db).await.unwrap();
            let remote:Vec<Vec<String>>=vec![vec!["category_id","分類名","色","並び順","updated_at","deleted_at"],vec![new,"仕事","red","1","then",""]].into_iter().map(|r|r.into_iter().map(str::to_owned).collect()).collect();
            let mut tx=db.begin().await.unwrap();align_categories(&mut tx,&remote,&local).await.unwrap();tx.commit().await.unwrap();
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT category_id FROM tasks").fetch_one(&db).await.unwrap(),new);
            assert_eq!(sqlx::query_scalar::<_,String>("SELECT color FROM categories WHERE id=?").bind(new).fetch_one(&db).await.unwrap(),"blue");
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL").fetch_one(&db).await.unwrap(),1);
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM tasks").fetch_one(&db).await.unwrap(),1);
        });
    }
}
