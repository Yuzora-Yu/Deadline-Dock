//! Bounded compare-and-swap for app writers: deleting a missing named range
//! rejects the whole Sheets batch. Each successful batch rotates its guard ID.
//! A permanent bootstrap ID also rejects competing first-time initializations.
use crate::{google, task_sync::request_json};
use serde_json::{json, Value};
const BOOTSTRAP: &str = "deadline_dock_sync_initialized_v1";
const GUARD: &str = "DeadlineDockSyncGuard";
pub(crate) struct Ticket {
    previous: Option<String>,
}
pub(crate) async fn observe(id: &str, token: &str) -> Result<Ticket, String> {
    let data = request_json(
        google::client()?
            .get(format!(
                "https://sheets.googleapis.com/v4/spreadsheets/{id}"
            ))
            .bearer_auth(token)
            .query(&[("fields", "namedRanges")]),
        true,
    )
    .await?;
    let all: Vec<_> = data["namedRanges"]
        .as_array()
        .into_iter()
        .flatten()
        .collect();
    let guards: Vec<_> = all.iter().filter(|r| r["name"] == GUARD).collect();
    if guards.len() > 1 {
        return Err("同期保護用の名前付き範囲が重複しています。".into());
    }
    let previous = guards
        .first()
        .and_then(|r| r["namedRangeId"].as_str())
        .map(str::to_owned);
    if previous.is_none() && all.iter().any(|r| r["namedRangeId"] == BOOTSTRAP) {
        return Err(
            "同期保護用の名前付き範囲が削除されています。新しい同期シートを作成してください。"
                .into(),
        );
    }
    Ok(Ticket { previous })
}
fn protected_batch(ticket: &Ticket, mut requests: Vec<Value>) -> Vec<Value> {
    let range = json!({"sheetId":105,"startRowIndex":0,"endRowIndex":1,"startColumnIndex":0,"endColumnIndex":1});
    if let Some(previous) = &ticket.previous {
        requests.insert(0, json!({"deleteNamedRange":{"namedRangeId":previous}}));
    } else {
        // Place additions after sheet creation requests on first setup.
        requests.push(json!({"addNamedRange":{"namedRange":{"namedRangeId":BOOTSTRAP,"name":"DeadlineDockSyncInitialized","range":range}}}));
    }
    requests.push(json!({"addNamedRange":{"namedRange":{"namedRangeId":format!("dd_sync_{}",uuid::Uuid::new_v4().simple()),"name":GUARD,"range":range}}}));
    requests
}
pub(crate) async fn commit(
    id: &str,
    token: &str,
    ticket: &Ticket,
    requests: Vec<Value>,
) -> Result<(), String> {
    if requests.is_empty() {
        return Ok(());
    }
    let result = request_json(
        google::client()?
            .post(format!(
                "https://sheets.googleapis.com/v4/spreadsheets/{id}:batchUpdate"
            ))
            .bearer_auth(token)
            .json(&json!({"requests":protected_batch(ticket,requests)})),
        false,
    )
    .await;
    if let Err(error) = result {
        if let Ok(current) = observe(id, token).await {
            if current.previous != ticket.previous {
                return Err(
                    "RETRY|別のPCの同期を検出しました。最新の行を読み直して再同期します。".into(),
                );
            }
        }
        return Err(error);
    }
    Ok(())
}
