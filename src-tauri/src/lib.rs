mod commands;
mod db;
mod error;
mod models;
mod repo;
mod search;
mod services;
mod state;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;

            // A database that cannot be opened must not take the window with it:
            // Tauri aborts startup when `setup` returns an error, which reads as
            // a crash. `init_pool_or_recover` moves the file aside and rebuilds.
            let (pool, notice) = match tauri::async_runtime::block_on(
                db::init_pool_or_recover(&app_data_dir),
            ) {
                Ok(result) => result,
                Err(error) => {
                    // Nothing left to fall back on, so say why before giving up.
                    app.dialog()
                        .message(format!("青简无法打开工作区数据库：\n\n{error}"))
                        .title("青简")
                        .blocking_show();
                    return Err(error.into());
                }
            };

            // The asset protocol starts with an empty scope, so every workspace
            // opened in a previous session has to be granted again here.
            let roots = tauri::async_runtime::block_on(async {
                sqlx::query_scalar::<_, String>("SELECT root_path FROM workspace")
                    .fetch_all(&pool)
                    .await
            })
            .unwrap_or_default();
            let handle = app.handle().clone();
            for root in roots {
                commands::workspace::grant_asset_access(&handle, &root);
            }

            app.manage(AppState::new(pool, notice));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::load_settings,
            commands::settings::set_setting,
            commands::settings::delete_setting,
            commands::workspace::list_workspaces,
            commands::workspace::add_workspace,
            commands::workspace::remove_workspace,
            commands::workspace::sync_workspace,
            commands::note::list_notes,
            commands::note::read_note,
            commands::note::save_note,
            commands::note::note_hash,
            commands::note::create_note,
            commands::note::rename_note,
            commands::note::delete_note,
            commands::note::search_notes,
            commands::asset::save_image,
            commands::asset::fetch_image_source,
            commands::file::export_text,
            commands::export::render_export,
            commands::export::export_document,
            commands::upload::set_git_token,
            commands::upload::clear_git_token,
            commands::upload::git_token_configured,
            commands::upload::upload_image_to_git,
            commands::upload::test_git_connection,
            commands::fonts::list_system_fonts,
            commands::bootstrap::bootstrap_workspace,
            commands::update::check_for_updates,
            commands::update::download_update,
            commands::update::open_external,
            commands::update::reveal_downloaded,
            state::take_startup_notice,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
