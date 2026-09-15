//! Explicit opt-in integration test. Uses saved credentials read-only, creates
//! a separate synthetic spreadsheet, and trashes that file after testing.
use crate::{google, sheet_layout, task_lifecycle, task_sync::request_json};
use serde_json::{json, Value};
use sqlx::SqlitePool;

async fn exercise(token: &str, id: &str) -> Result<(), String> {
    let db = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .map_err(|e| e.to_string())?;
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
        include_str!("../migrations/0011_sheet_generations.sql"),
    ] {
        sqlx::raw_sql(migration)
            .execute(&db)
            .await
            .map_err(|e| e.to_string())?;
    }
    let bootstrap_ticket = crate::sheet_guard::observe(id, token).await?;
    sheet_layout::ensure(&db, token, id, false).await?;
    let endpoint = format!("https://sheets.googleapis.com/v4/spreadsheets/{id}");
    let http = google::client()?;
    let task = "11111111-1111-4111-8111-111111111111";
    let keep = "22222222-2222-4222-8222-222222222222";
    let now = "2026-09-15T00:00:00Z";
    let mut requests = vec![];
    for sid in [100, 101, 102, 103] {
        let rows = if sid == 100 {
            vec![vec![task, "Synthetic delete"], vec![keep, "Synthetic keep"]]
        } else {
            vec![
                vec!["child-delete", task, "Synthetic delete"],
                vec!["child-keep", keep, "Synthetic keep"],
            ]
        };
        requests.push(json!({"updateCells":{"start":{"sheetId":sid,"rowIndex":1,"columnIndex":0},"rows":rows.iter().map(|row|json!({"values":row.iter().map(|v|json!({"userEnteredValue":{"stringValue":v}})).collect::<Vec<_>>()})).collect::<Vec<_>>(),"fields":"userEnteredValue"}}));
    }
    request_json(
        http.post(format!("{endpoint}:batchUpdate"))
            .bearer_auth(token)
            .json(&json!({"requests":requests})),
        false,
    )
    .await?;
    let stale_write = vec![
        json!({"updateCells":{"start":{"sheetId":100,"rowIndex":1,"columnIndex":5},"rows":[{"values":[{"userEnteredValue":{"stringValue":"stale writer must not commit"}}]}],"fields":"userEnteredValue"}}),
    ];
    assert!(
        crate::sheet_guard::commit(id, token, &bootstrap_ticket, stale_write.clone())
            .await
            .is_err()
    );
    let first = crate::sheet_guard::observe(id, token).await?;
    let second = crate::sheet_guard::observe(id, token).await?;
    crate::sheet_guard::commit(id,token,&first,vec![json!({"updateCells":{"start":{"sheetId":100,"rowIndex":1,"columnIndex":5},"rows":[{"values":[{"userEnteredValue":{"stringValue":"first writer"}}]}],"fields":"userEnteredValue"}})]).await?;
    assert!(crate::sheet_guard::commit(id, token, &second, stale_write)
        .await
        .is_err());
    assert!(!values(&http, token, &endpoint)
        .await?
        .to_string()
        .contains("stale writer"));
    let before = values(&http, token, &endpoint).await?;
    sheet_layout::ensure(&db, token, id, true).await?;
    assert_eq!(
        values(&http, token, &endpoint).await?,
        before,
        "repair changed user values"
    );
    sheet_layout::ensure(&db, token, id, true).await?;
    assert_eq!(
        values(&http, token, &endpoint).await?,
        before,
        "repeat repair changed values"
    );
    sqlx::query("INSERT INTO tasks(id,workspace_id,title,status,deadline_type,deadline_label,created_at,updated_at) VALUES(?,?,'Synthetic','TODO','ASAP','ASAP',?,?)").bind(task).bind(google::WORKSPACE).bind(now).bind(now).execute(&db).await.map_err(|e|e.to_string())?;
    sqlx::query("UPDATE tasks SET deleted_at=?,updated_at=? WHERE id=?")
        .bind(now)
        .bind(now)
        .bind(task)
        .execute(&db)
        .await
        .map_err(|e| e.to_string())?;
    task_lifecycle::synchronize(&db, id, token).await?;
    let after = values(&http, token, &endpoint).await?;
    let text = after.to_string();
    assert!(!text.contains(task));
    assert!(text.contains(keep));
    task_lifecycle::synchronize(&db, id, token).await?;
    assert_eq!(
        values(&http, token, &endpoint).await?,
        after,
        "repeat deletion changed remaining rows"
    );
    request_json(
        http.post(format!("{endpoint}:batchUpdate"))
            .bearer_auth(token)
            .json(&json!({"requests":[{"deleteSheet":{"sheetId":101}}]})),
        false,
    )
    .await?;
    sheet_layout::ensure(&db, token, id, false).await?;
    let repaired = request_json(
        http.get(&endpoint)
            .bearer_auth(token)
            .query(&[("fields", "sheets(properties,developerMetadata)")]),
        true,
    )
    .await?;
    let sheets = repaired["sheets"].as_array().unwrap();
    assert_eq!(sheets.len(), 7);
    assert!(sheets.iter().any(|s| s["properties"]["sheetId"] == 101));
    assert!(!sheets.iter().any(|s| s["properties"]["sheetId"] == 0));
    assert_eq!(
        sheets
            .iter()
            .map(|s| s["developerMetadata"].as_array().unwrap().len())
            .sum::<usize>(),
        7,
        "metadata duplicated"
    );
    let guards = request_json(
        http.get(&endpoint)
            .bearer_auth(token)
            .query(&[("fields", "namedRanges")]),
        true,
    )
    .await?;
    assert_eq!(
        guards["namedRanges"].as_array().unwrap().len(),
        2,
        "write guard must not accumulate records"
    );
    println!("LIVE PASS: initial setup, value-preserving repair twice, task/three-child row deletion, repeat sync, missing-tab recreation, metadata idempotency");
    Ok(())
}
async fn values(http: &reqwest::Client, token: &str, endpoint: &str) -> Result<Value, String> {
    request_json(
        http.get(format!("{endpoint}/values:batchGet"))
            .bearer_auth(token)
            .query(&[
                ("ranges", "タスク一覧!A2:N10"),
                ("ranges", "チェック項目!A2:H10"),
                ("ranges", "予定!A2:H10"),
                ("ranges", "関連リンク!A2:I10"),
                ("valueRenderOption", "UNFORMATTED_VALUE"),
            ]),
        true,
    )
    .await
}
#[test]
#[ignore = "Creates a synthetic Google spreadsheet using explicitly selected saved credentials"]
fn live_google_maintenance() {
    let path = std::env::var("DEADLINE_DOCK_LIVE_AUTH_DB")
        .expect("Set DEADLINE_DOCK_LIVE_AUTH_DB explicitly");
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let options=sqlx::sqlite::SqliteConnectOptions::new().filename(path).read_only(true);
        let auth=SqlitePool::connect_with(options).await.unwrap();
        let token=google::access_token(&auth).await.unwrap();
        let http=google::client().unwrap();
        let file=request_json(http.post("https://www.googleapis.com/drive/v3/files").bearer_auth(&token).json(&json!({"name":"Deadline Dock integration test (synthetic)","mimeType":"application/vnd.google-apps.spreadsheet"})),false).await.unwrap();
        let id=file["id"].as_str().unwrap();
        println!("Synthetic test file: {id}");
        let test_token=token.clone();let test_id=id.to_string();
        let result=tokio::spawn(async move {exercise(&test_token,&test_id).await}).await;
        let cleanup=request_json(http.patch(format!("https://www.googleapis.com/drive/v3/files/{id}")).bearer_auth(&token).json(&json!({"trashed":true})),false).await;
        assert!(cleanup.is_ok(),"Synthetic test cleanup failed for {id}");
        result.unwrap().unwrap();
    });
}
