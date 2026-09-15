mod google;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_window_state::StateFlags;

#[tauri::command]
fn open_local_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path is empty".to_string());
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

fn show_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "query_indexes",
            sql: include_str!("../migrations/0002_query_indexes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "fts_search",
            sql: include_str!("../migrations/0003_fts_search.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "category_color",
            sql: include_str!("../migrations/0004_category_color.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "task_check_items",
            sql: include_str!("../migrations/0005_check_items.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "google_sync",
            sql: include_str!("../migrations/0006_google_sync.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(google::GoogleState::default())
        .invoke_handler(tauri::generate_handler![
            open_local_path,
            google::google_status,
            google::google_configure,
            google::google_connect,
            google::google_disconnect,
            google::google_prepare_sheet,
            google::google_open_sheet
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:deadline-dock.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .with_denylist(&["quick"])
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

                let add_i = MenuItem::with_id(app, "quick", "タスク追加", true, None::<&str>)?;
                let main_i = MenuItem::with_id(app, "main", "メイン画面", true, None::<&str>)?;
                let mini_i = MenuItem::with_id(app, "mini", "ミニウィンドウ", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&add_i, &main_i, &mini_i, &quit_i])?;

                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .tooltip("Deadline Dock")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quick" => {
                            show_window(app, "quick");
                            let _ = app.emit_to(
                                "quick",
                                "deadline-dock-compose-task",
                                serde_json::json!({ "requestId": "tray", "initial": null }),
                            );
                        }
                        "main" => show_window(app, "main"),
                        "mini" => show_window(app, "mini"),
                        "quit" => app.exit(0),
                        _ => {}
                    });
                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }
                tray_builder.build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Deadline Dock");
}
