use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use reqwest::{Client, Response};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
};

const WORKSPACE: &str = "00000000-0000-4000-8000-000000000001";
const SCOPE: &str = "openid email profile https://www.googleapis.com/auth/drive.file";
const DB_ERROR: &str = "連携設定を保存・読み込みできません。アプリを再起動してください。";
#[derive(Default)]
pub struct GoogleState {
    operation: Mutex<()>,
}
#[derive(Serialize)]
pub struct Connection {
    client_id: String,
    email: Option<String>,
    spreadsheet_url: Option<String>,
    enabled: bool,
    initialized: bool,
    credential_available: bool,
}
fn secure_entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("DeadlineDock", name)
        .map_err(|_| "Windows資格情報にアクセスできません。".into())
}
fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
async fn pool(app: &tauri::AppHandle) -> Result<SqlitePool, String> {
    let databases = app.state::<tauri_plugin_sql::DbInstances>();
    let instances = databases.0.read().await;
    match instances.get("sqlite:deadline-dock.db") {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err(DB_ERROR.into()),
    }
}
fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "通信を開始できません。".into())
}
fn http_error(status: u16) -> String {
    match status {
        400 | 401 => "Google認証が無効です。設定を確認して再接続してください。",
        403 => "Googleのアクセス権限とDrive / Sheets APIの有効化を確認してください。",
        404 => "連携用スプレッドシートが見つかりません。削除・アクセス権限を確認してください。",
        429 => "Googleの利用制限に達しました。しばらく待って再試行してください。",
        500..=599 => "Google側で一時的な障害が発生しています。後で再試行してください。",
        _ => "Googleとの通信に失敗しました。再試行してください。",
    }
    .into()
}
async fn decode(response: Result<Response, reqwest::Error>) -> Result<Value, String> {
    let response = response.map_err(|_| {
        "ネットワークに接続できません。ローカルのタスクは引き続き利用できます。".to_string()
    })?;
    if !response.status().is_success() {
        return Err(http_error(response.status().as_u16()));
    }
    response
        .json()
        .await
        .map_err(|_| "Googleの応答を読み取れません。".into())
}
fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    value[name]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Googleの応答に必要な情報がありません。".into())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() < 256
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn sheet_url(id: &str) -> Result<String, String> {
    if !valid_id(id) {
        return Err("スプレッドシートIDが不正です。".into());
    }
    Ok(format!("https://docs.google.com/spreadsheets/d/{id}/edit"))
}
async fn settings(db: &SqlitePool) -> Result<sqlx::sqlite::SqliteRow, String> {
    sqlx::query("SELECT * FROM google_sync_settings WHERE workspace_id=?")
        .bind(WORKSPACE)
        .fetch_one(db)
        .await
        .map_err(|_| DB_ERROR.into())
}
#[tauri::command]
pub async fn google_status(app: tauri::AppHandle) -> Result<Connection, String> {
    let row = settings(&pool(&app).await?).await?;
    let sub: Option<String> = row.get("google_sub");
    let available = sub.as_ref().is_some_and(|sub| {
        secure_entry(&format!("google:{sub}"))
            .and_then(|e| e.get_password().map_err(|_| String::new()))
            .is_ok()
    });
    Ok(Connection {
        client_id: row.get("client_id"),
        email: row.get("email"),
        spreadsheet_url: row.get("spreadsheet_url"),
        enabled: row.get::<i64, _>("enabled") != 0,
        initialized: row.get::<i64, _>("initialized") != 0,
        credential_available: available,
    })
}
#[tauri::command]
pub async fn google_configure(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "Google連携の処理中です。")?;
    let id = client_id.trim();
    if !id.ends_with(".apps.googleusercontent.com") || id.contains(char::is_whitespace) {
        return Err("Desktop app用のClient IDを入力してください。".into());
    }
    let db = pool(&app).await?;
    let row = settings(&db).await?;
    if row.get::<Option<String>, _>("google_sub").is_some() {
        return Err("設定変更前にGoogle連携を解除してください。".into());
    }
    if client_secret.trim().is_empty() {
        return Err("Google Cloudが発行したクライアントシークレットを入力してください。".into());
    }
    secure_entry(&format!("client:{id}"))?
        .set_password(client_secret.trim())
        .map_err(|_| "クライアント設定を安全に保存できません。")?;
    sqlx::query("UPDATE google_sync_settings SET client_id=?,updated_at=datetime('now') WHERE workspace_id=?").bind(id).bind(WORKSPACE).execute(&db).await.map_err(|_| DB_ERROR)?;
    Ok(())
}
fn callback_code(target: &str, state: &str) -> Result<String, String> {
    let url = url::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "認証応答が不正です。")?;
    if url.path() != "/oauth2callback" {
        return Err("認証応答のパスが不正です。".into());
    }
    let params: Vec<_> = url.query_pairs().collect();
    let values = |key: &str| {
        params
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.to_string())
            .collect::<Vec<_>>()
    };
    if values("state") != vec![state.to_string()] {
        return Err("認証応答を検証できません。もう一度接続してください。".into());
    }
    if !values("error").is_empty() {
        return Err("Google認証がキャンセルされました。".into());
    }
    let codes = values("code");
    if codes.len() != 1 || codes[0].is_empty() {
        return Err("認証コードがありません。".into());
    }
    Ok(codes[0].clone())
}
async fn authorize(app: &tauri::AppHandle, client_id: &str, secret: &str) -> Result<Value, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "認証の受信ポートを開始できません。")?;
    let redirect = format!(
        "http://127.0.0.1:{}/oauth2callback",
        listener
            .local_addr()
            .map_err(|_| "認証ポートが不明です。")?
            .port()
    );
    let verifier = random_secret();
    let state = random_secret();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("redirect_uri", &redirect),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("state", &state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]);
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "既定ブラウザを開けません。")?;
    let code = tokio::time::timeout(Duration::from_secs(180), async {
        loop {
            let (mut socket, _) = listener.accept().await.map_err(|_| "認証応答を受信できません。".to_string())?;
            let mut request = Vec::new();
            let read = tokio::time::timeout(Duration::from_secs(5), async {
                while request.len() < 8192 && !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let mut buffer = [0u8; 1024]; let n = socket.read(&mut buffer).await?;
                    if n == 0 { break; } request.extend_from_slice(&buffer[..n]);
                }
                Ok::<_,std::io::Error>(())
            }).await;
            if !matches!(read, Ok(Ok(()))) { continue; }
            let text = String::from_utf8_lossy(&request);
            let mut parts = text.lines().next().unwrap_or("").split_whitespace();
            if parts.next() != Some("GET") { continue; }
            let target = parts.next().unwrap_or("");
            if !target.starts_with("/oauth2callback?") { continue; }
            let result = callback_code(target, &state);
            let message = if result.is_ok() { "Authorization received. Return to Deadline Dock." } else { "Authorization failed. Return to Deadline Dock and retry." };
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", message.len(), message);
            let _ = tokio::time::timeout(Duration::from_secs(2), socket.write_all(response.as_bytes())).await;
            return result;
        }
    }).await.map_err(|_| "認証がタイムアウトしました。もう一度接続してください。")??;
    drop(listener);
    let tokens = decode(
        client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", client_id),
                ("client_secret", secret),
                ("code", &code),
                ("code_verifier", &verifier),
                ("redirect_uri", &redirect),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await,
    )
    .await?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(tokens)
}
#[tauri::command]
pub async fn google_connect(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> Result<Connection, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "Google連携の処理中です。")?;
    let db = pool(&app).await?;
    let row = settings(&db).await?;
    let id: String = row.get("client_id");
    let secret = secure_entry(&format!("client:{id}"))?
        .get_password()
        .map_err(|_| "まずOAuthクライアント設定を保存してください。")?;
    let tokens = authorize(&app, &id, &secret).await?;
    let user = decode(
        client()?
            .get("https://openidconnect.googleapis.com/v1/userinfo")
            .bearer_auth(field(&tokens, "access_token")?)
            .send()
            .await,
    )
    .await?;
    let sub = field(&user, "sub")?;
    let email = field(&user, "email")?;
    let previous: Option<String> = row.get("google_sub");
    if previous.as_deref().is_some_and(|old| old != sub) {
        return Err("別のGoogleアカウントです。先に連携解除してから接続してください。".into());
    }
    secure_entry(&format!("google:{sub}"))?
        .set_password(field(&tokens, "refresh_token")?)
        .map_err(|_| "認証情報を安全に保存できません。")?;
    sqlx::query("UPDATE google_sync_settings SET google_sub=?,email=?,enabled=1,updated_at=datetime('now') WHERE workspace_id=?").bind(sub).bind(email).bind(WORKSPACE).execute(&db).await.map_err(|_| DB_ERROR)?;
    // Persist account before creating the file so a failed network request is recoverable.
    prepare(&db).await?;
    google_status(app).await
}
async fn access_token(db: &SqlitePool) -> Result<String, String> {
    let row = settings(db).await?;
    let id: String = row.get("client_id");
    let sub: Option<String> = row.get("google_sub");
    let sub = sub.ok_or("Googleアカウントと接続してください。")?;
    let refresh = secure_entry(&format!("google:{sub}"))?
        .get_password()
        .map_err(|_| "Google認証が必要です。再接続してください。")?;
    let secret = secure_entry(&format!("client:{id}"))?
        .get_password()
        .map_err(|_| "OAuthクライアント設定を保存し直してください。")?;
    let tokens = decode(
        client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", id.as_str()),
                ("client_secret", secret.as_str()),
                ("refresh_token", refresh.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await,
    )
    .await?;
    if let Some(refresh) = tokens["refresh_token"].as_str() {
        secure_entry(&format!("google:{sub}"))?
            .set_password(refresh)
            .map_err(|_| "更新した認証情報を保存できません。")?;
    }
    Ok(field(&tokens, "access_token")?.to_string())
}
async fn prepare(db: &SqlitePool) -> Result<(), String> {
    let token = access_token(db).await?;
    let http = client()?;
    let row = settings(db).await?;
    let saved: Option<String> = row.get("spreadsheet_id");
    let id = if let Some(id) = saved {
        sheet_url(&id)?;
        let metadata = decode(
            http.get(format!("https://www.googleapis.com/drive/v3/files/{id}"))
                .query(&[("fields", "id,trashed")])
                .bearer_auth(&token)
                .send()
                .await,
        )
        .await?;
        if metadata["trashed"] == true {
            return Err(
                "連携用スプレッドシートはゴミ箱にあります。Google Driveで復元してください。".into(),
            );
        }
        id
    } else {
        // Rediscover before creation, including files left by an interrupted connect.
        let query = format!("trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has {{ key='deadlineDock' and value='true' }} and appProperties has {{ key='workspaceId' and value='{WORKSPACE}' }}");
        let found = decode(
            http.get("https://www.googleapis.com/drive/v3/files")
                .query(&[
                    ("q", query.as_str()),
                    ("fields", "files(id),nextPageToken"),
                    ("pageSize", "100"),
                ])
                .bearer_auth(&token)
                .send()
                .await,
        )
        .await?;
        let files = found["files"]
            .as_array()
            .ok_or("Google Driveの応答が不正です。")?;
        if files.len() > 1 || found["nextPageToken"].is_string() {
            return Err("連携候補が複数あります。Google Driveで利用する1つを残し、他の候補のappPropertiesを管理してから再試行してください。".into());
        }
        let file = if let Some(file) = files.first() {
            file.clone()
        } else {
            decode(http.post("https://www.googleapis.com/drive/v3/files").query(&[("fields","id,webViewLink")]).bearer_auth(&token).json(&json!({"name":"Deadline Dock タスク同期","mimeType":"application/vnd.google-apps.spreadsheet","appProperties":{"deadlineDock":"true","schemaVersion":"1","workspaceId":WORKSPACE}})).send().await).await?
        };
        let id = field(&file, "id")?.to_string();
        let url = sheet_url(&id)?;
        sqlx::query("UPDATE google_sync_settings SET spreadsheet_id=?,spreadsheet_url=?,initialized=0 WHERE workspace_id=?").bind(&id).bind(url).bind(WORKSPACE).execute(db).await.map_err(|_| DB_ERROR)?;
        id
    };
    initialize_sheet(&http, &token, &id).await?;
    sqlx::query("UPDATE google_sync_settings SET initialized=1,enabled=1,last_error=NULL,updated_at=datetime('now') WHERE workspace_id=?").bind(WORKSPACE).execute(db).await.map_err(|_| DB_ERROR)?;
    Ok(())
}
async fn initialize_sheet(http: &Client, token: &str, id: &str) -> Result<(), String> {
    let endpoint = format!("https://sheets.googleapis.com/v4/spreadsheets/{id}");
    let metadata = decode(http.get(&endpoint).bearer_auth(token).send().await).await?;
    let sheets = metadata["sheets"]
        .as_array()
        .ok_or("シート情報を読み取れません。")?;
    let definitions = [
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
    ];
    let mut requests = Vec::new();
    for (sid, title, headers) in definitions {
        // Fixed IDs survive renaming. Existing tabs are never rewritten during reconnect.
        if sheets.iter().any(|s| s["properties"]["sheetId"] == sid) {
            continue;
        }
        if sheets.iter().any(|s| s["properties"]["title"] == title) {
            return Err(format!(
                "「{title}」という既存タブがあります。内容を保護するため初期化を停止しました。"
            ));
        }
        requests.push(json!({"addSheet":{"properties":{"sheetId":sid,"title":title,"hidden":sid==105,"gridProperties":{"rowCount":1000,"columnCount":headers.len().max(14),"frozenRowCount":1}}}}));
        let mut rows = vec![
            json!({"values":headers.iter().map(|h| json!({"userEnteredValue":{"stringValue":h},"userEnteredFormat":{"textFormat":{"bold":true}}})).collect::<Vec<_>>()}),
        ];
        if sid == 105 {
            for (key, value) in [
                ("schema_version", "1"),
                ("workspace_id", WORKSPACE),
                ("created_by", "Deadline Dock"),
            ] {
                rows.push(json!({"values":[{"userEnteredValue":{"stringValue":key}},{"userEnteredValue":{"stringValue":value}}]}));
            }
        }
        requests.push(json!({"updateCells":{"start":{"sheetId":sid,"rowIndex":0,"columnIndex":0},"rows":rows,"fields":"userEnteredValue,userEnteredFormat"}}));
        if sid != 105 {
            requests.push(json!({"setBasicFilter":{"filter":{"range":{"sheetId":sid,"startRowIndex":0,"endColumnIndex":headers.len()}}}}));
            requests.push(json!({"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"COLUMNS","startIndex":0,"endIndex":headers.len()},"properties":{"pixelSize":170},"fields":"pixelSize"}}));
            let hidden = if sid == 100 {
                vec![(0, 1), (11, 13)]
            } else if sid == 104 {
                vec![(0, 1), (5, 6)]
            } else {
                vec![(0, 2), (headers.len() - 1, headers.len())]
            };
            for (start, end) in hidden {
                requests.push(json!({"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"COLUMNS","startIndex":start,"endIndex":end},"properties":{"hiddenByUser":true},"fields":"hiddenByUser"}}));
            }
        }
        if sid == 100 {
            requests.push(json!({"setDataValidation":{"range":{"sheetId":sid,"startRowIndex":1,"startColumnIndex":3,"endColumnIndex":4},"rule":{"condition":{"type":"ONE_OF_LIST","values":[{"userEnteredValue":"未着手"},{"userEnteredValue":"作業中"},{"userEnteredValue":"完了"}]},"strict":true,"showCustomUi":true}}}));
        }
        if sid == 101 {
            requests.push(json!({"setDataValidation":{"range":{"sheetId":sid,"startRowIndex":1,"startColumnIndex":3,"endColumnIndex":4},"rule":{"condition":{"type":"BOOLEAN"},"strict":true,"showCustomUi":true}}}));
        }
    }
    if !requests.is_empty() {
        decode(
            http.post(format!("{endpoint}:batchUpdate"))
                .bearer_auth(token)
                .json(&json!({"requests":requests}))
                .send()
                .await,
        )
        .await?;
    }
    Ok(())
}
#[tauri::command]
pub async fn google_prepare_sheet(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> Result<Connection, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "Google連携の処理中です。")?;
    prepare(&pool(&app).await?).await?;
    google_status(app).await
}
#[tauri::command]
pub async fn google_open_sheet(app: tauri::AppHandle) -> Result<(), String> {
    let row = settings(&pool(&app).await?).await?;
    let id: Option<String> = row.get("spreadsheet_id");
    app.opener()
        .open_url(sheet_url(&id.ok_or("同期先がありません。")?)?, None::<&str>)
        .map_err(|_| "ブラウザを開けません。".into())
}
#[tauri::command]
pub async fn google_disconnect(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> Result<(), String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "Google連携の処理中です。")?;
    let db = pool(&app).await?;
    let row = settings(&db).await?;
    if let Some(sub) = row.get::<Option<String>, _>("google_sub") {
        let entry = secure_entry(&format!("google:{sub}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Windows資格情報を削除できません。再試行してください。".into()),
        }
    }
    let mut tx = db.begin().await.map_err(|_| DB_ERROR)?;
    sqlx::query("UPDATE google_sync_settings SET google_sub=NULL,email=NULL,spreadsheet_id=NULL,spreadsheet_url=NULL,initialized=0,enabled=0,last_error=NULL,last_success_at=NULL WHERE workspace_id=?").bind(WORKSPACE).execute(&mut *tx).await.map_err(|_| DB_ERROR)?;
    sqlx::query("DELETE FROM sync_entity_state")
        .execute(&mut *tx)
        .await
        .map_err(|_| DB_ERROR)?;
    sqlx::query("DELETE FROM sync_conflicts")
        .execute(&mut *tx)
        .await
        .map_err(|_| DB_ERROR)?;
    tx.commit().await.map_err(|_| DB_ERROR)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_security() {
        assert_eq!(
            callback_code("/oauth2callback?state=s&code=c", "s").unwrap(),
            "c"
        );
        for target in [
            "/wrong?state=s&code=c",
            "/oauth2callback?state=x&code=c",
            "/oauth2callback?state=s&state=s&code=c",
            "/oauth2callback?state=s&error=access_denied",
            "/oauth2callback?state=s&code=c&code=d",
        ] {
            assert!(callback_code(target, "s").is_err());
        }
    }
    #[test]
    fn safe_urls() {
        assert!(sheet_url("abc_DEF-123").is_ok());
        for id in ["", "../evil", "https://evil.example", "abc?x=1"] {
            assert!(sheet_url(id).is_err());
        }
    }
    #[test]
    fn pkce_vector() {
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(
                b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
            )),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(random_secret().len(), 43);
    }
    #[test]
    fn mock_api_errors_and_success() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            for (status, body) in [
                (200, r#"{"id":"sheet123"}"#),
                (401, r#"{"error":"private-token-value"}"#),
                (403, "denied"),
                (404, "missing"),
                (429, "quota"),
                (503, "unavailable"),
            ] {
                let response = http::Response::builder()
                    .status(status)
                    .header("content-type", "application/json")
                    .body(body)
                    .unwrap();
                let result = decode(Ok(Response::from(response))).await;
                if status == 200 {
                    assert_eq!(result.unwrap()["id"], "sheet123");
                } else {
                    assert_eq!(result.unwrap_err(), http_error(status));
                }
            }
            let error = Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get("not a URL")
                .build()
                .unwrap_err();
            assert!(decode(Err(error)).await.unwrap_err().contains("ローカル"));
        });
    }
    #[test]
    fn windows_credential_roundtrip() {
        let entry = keyring::Entry::new("DeadlineDock.Tests", &random_secret()).unwrap();
        entry.set_password("synthetic-test-value").unwrap();
        assert_eq!(entry.get_password().unwrap(), "synthetic-test-value");
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
    #[test]
    fn errors_are_sanitized() {
        for code in [400, 401, 403, 404, 429, 500, 503] {
            assert!(!http_error(code).contains("token"));
        }
    }
}
