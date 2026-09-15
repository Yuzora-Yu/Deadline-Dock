//! User-initiated updates from the project's HTTPS GitHub release only.
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};
use tauri::{Manager, State};
use tokio::sync::Mutex;

const REPO: &str = "https://github.com/Yuzora-Yu/Deadline-Dock";
const LATEST: &str = "https://api.github.com/repos/Yuzora-Yu/Deadline-Dock/releases/latest";
#[derive(Default)]
pub struct UpdateState(pub Mutex<Option<(PathBuf, String)>>);
#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    version: String,
    available: bool,
    notes: String,
    url: String,
    size: u64,
}
fn version(value: &str) -> Result<[u64; 3], String> {
    let parts: Vec<_> = value
        .strip_prefix('v')
        .unwrap_or(value)
        .split('.')
        .collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err("更新バージョンが不正です。".into());
    }
    Ok([
        parts[0].parse().map_err(|_| "バージョンが不正です。")?,
        parts[1].parse().map_err(|_| "バージョンが不正です。")?,
        parts[2].parse().map_err(|_| "バージョンが不正です。")?,
    ])
}
fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Deadline-Dock-update")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let host = url.host_str().unwrap_or("");
            if attempt.previous().len() > 5
                || url.scheme() != "https"
                || ![
                    "github.com",
                    "api.github.com",
                    "release-assets.githubusercontent.com",
                    "objects.githubusercontent.com",
                ]
                .contains(&host)
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "更新の通信を準備できませんでした。".into())
}
async fn bounded(client: &Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "更新サーバーに接続できませんでした。ネット接続を確認してください。")?;
    if !response.status().is_success() {
        return Err(format!(
            "更新の取得に失敗しました（{}）。時間をおいて再確認してください。",
            response.status().as_u16()
        ));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("更新ファイルが大きすぎます。".into());
    }
    let mut result = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "更新ファイルの受信が中断されました。")?
    {
        if result.len() + chunk.len() > limit {
            return Err("更新ファイルが大きすぎます。".into());
        }
        result.extend_from_slice(&chunk);
    }
    Ok(result)
}
fn parse_release(value: &Value, current: &str) -> Result<UpdateInfo, String> {
    if value["draft"] == true || value["prerelease"] == true {
        return Err("正式版の更新情報ではありません。".into());
    }
    let tag = value["tag_name"]
        .as_str()
        .ok_or("更新バージョンがありません。")?;
    let remote = version(tag)?;
    let name = format!(
        "Deadline-Dock_{}_x64-setup.exe",
        tag.trim_start_matches('v')
    );
    let asset = value["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|a| a["name"] == name))
        .ok_or("インストーラーが見つかりません。公開の完了後に再確認してください。")?;
    let size = asset["size"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= 100 * 1024 * 1024)
        .ok_or("更新サイズが不正です。")?;
    let expected = format!("{REPO}/releases/download/{tag}/{name}");
    if asset["browser_download_url"] != expected {
        return Err("更新ファイルの配布元が不正です。".into());
    }
    Ok(UpdateInfo {
        current: current.into(),
        version: tag.trim_start_matches('v').into(),
        available: remote > version(current)?,
        notes: value["body"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(12000)
            .collect(),
        url: format!("{REPO}/releases/tag/{tag}"),
        size,
    })
}
async fn latest(client: &Client, current: &str) -> Result<UpdateInfo, String> {
    let data = bounded(client, LATEST, 1024 * 1024).await?;
    let json: Value =
        serde_json::from_slice(&data).map_err(|_| "更新情報を読み取れませんでした。")?;
    parse_release(&json, current)
}
fn checksum(text: &str, name: &str) -> Result<String, String> {
    let candidates: Vec<_> = text
        .trim_start_matches('\u{feff}')
        .lines()
        .filter_map(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            (parts.len() == 2 && parts[1].trim_start_matches('*') == name).then(|| parts[0])
        })
        .collect();
    if candidates.len() != 1
        || candidates[0].len() != 64
        || !candidates[0].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("更新ファイルの検証情報が不正です。".into());
    }
    Ok(candidates[0].to_ascii_lowercase())
}
#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    latest(&client()?, &app.package_info().version.to_string()).await
}
#[tauri::command]
pub async fn download_app_update(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
    expected_version: String,
) -> Result<(), String> {
    let mut ready = state
        .0
        .try_lock()
        .map_err(|_| "更新をダウンロード中です。")?;
    *ready = None;
    let http = client()?;
    let info = latest(&http, &app.package_info().version.to_string()).await?;
    if !info.available || info.version != expected_version {
        return Err("更新情報が変わりました。もう一度確認してください。".into());
    }
    let name = format!("Deadline-Dock_{}_x64-setup.exe", info.version);
    let base = format!("{REPO}/releases/download/v{}", info.version);
    let sums = bounded(&http, &format!("{base}/SHA256SUMS.txt"), 65536).await?;
    let expected = checksum(
        std::str::from_utf8(&sums).map_err(|_| "検証情報を読み取れませんでした。")?,
        &name,
    )?;
    let payload = bounded(&http, &format!("{base}/{name}"), 100 * 1024 * 1024).await?;
    if payload.len() as u64 != info.size || format!("{:x}", Sha256::digest(&payload)) != expected {
        return Err(
            "更新ファイルの整合性を確認できませんでした。再ダウンロードしてください。".into(),
        );
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "更新保存先がありません。")?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|_| "更新保存先を作れませんでした。")?;
    let path = dir.join(name);
    std::fs::write(&path, &payload).map_err(|_| "更新ファイルを保存できませんでした。")?;
    *ready = Some((path, expected));
    Ok(())
}
#[tauri::command]
pub fn install_app_update(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
    google: State<'_, crate::google::GoogleState>,
) -> Result<(), String> {
    let _sync = google
        .operation
        .try_lock()
        .map_err(|_| "Google同期中です。完了してから更新してください。")?;
    let mut ready = state.0.try_lock().map_err(|_| "更新の処理中です。")?;
    let (path, expected) = ready
        .as_ref()
        .ok_or("先に更新をダウンロードしてください。")?;
    let bytes = std::fs::read(path).map_err(|_| "更新ファイルを読み込めませんでした。")?;
    if format!("{:x}", Sha256::digest(&bytes)) != *expected {
        return Err("更新ファイルが変わっています。再ダウンロードしてください。".into());
    }
    std::process::Command::new(path)
        .spawn()
        .map_err(|_| "更新インストーラーを起動できませんでした。")?;
    *ready = None;
    app.exit(0);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn orders_numeric_versions_and_rejects_paths() {
        assert!(version("v0.1.13").unwrap() > version("0.1.9").unwrap());
        for v in ["../bad", "1.2.3-beta", "1.2", "1.2.3/evil"] {
            assert!(version(v).is_err());
        }
    }
    #[test]
    fn rejects_wrong_asset_hosts_and_downgrades() {
        let mut v = json!({"tag_name":"v0.1.13","assets":[{"name":"Deadline-Dock_0.1.13_x64-setup.exe","size":123,"browser_download_url":format!("{REPO}/releases/download/v0.1.13/Deadline-Dock_0.1.13_x64-setup.exe")} ]});
        assert!(parse_release(&v, "0.1.12").unwrap().available);
        assert!(!parse_release(&v, "0.1.14").unwrap().available);
        v["assets"][0]["browser_download_url"] = json!("https://evil.example/setup.exe");
        assert!(parse_release(&v, "0.1.12").is_err());
    }
    #[test]
    fn requires_exact_unique_checksum() {
        let hash = "a".repeat(64);
        assert_eq!(
            checksum(&format!("\u{feff}{hash}  app.exe\n"), "app.exe").unwrap(),
            hash
        );
        assert!(checksum(&format!("{hash} app.exe\n{hash} app.exe"), "app.exe").is_err());
        assert!(checksum("bad app.exe", "app.exe").is_err());
        assert!(checksum(&format!("{hash} other.exe"), "app.exe").is_err());
    }
    #[test]
    #[ignore]
    fn live_release_check() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let info = latest(&client().unwrap(), "0.0.0").await.unwrap();
                assert!(info.available);
                assert!(info.size > 0);
                let http=client().unwrap();
                let name=format!("Deadline-Dock_{}_x64-setup.exe",info.version);
                let base=format!("{REPO}/releases/download/v{}",info.version);
                let sums=bounded(&http,&format!("{base}/SHA256SUMS.txt"),65536).await.unwrap();
                let expected=checksum(std::str::from_utf8(&sums).unwrap(),&name).unwrap();
                let bytes=bounded(&http,&format!("{base}/{name}"),100*1024*1024).await.unwrap();
                assert_eq!(bytes.len() as u64,info.size);
                assert_eq!(format!("{:x}",Sha256::digest(&bytes)),expected);
            });
    }
}
