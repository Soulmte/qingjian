mod cli;
mod cleanup;
mod commands;
mod db;
mod error;
mod models;
mod repo;
mod search;
mod services;
mod state;

use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use state::AppState;

/// 第二个青简把「要打开的文件」交给第一个时用的事件名。
///
/// 前端 `App.tsx` 监听同名事件，收到后调 `take_open_file` 把路径取走。
const OPEN_FILE_EVENT: &str = "open-file-request";

/// 又一个青简被拉起来时，把它的目标文件转交给已经在跑的这一份。
///
/// 不做这件事的后果不只是「多开一个窗口」：两个进程各持一个数据库连接，同一
/// 篇笔记会被两边分别写回，后写的盖掉先写的。
fn hand_over_second_launch(app: &tauri::AppHandle, argv: Vec<String>) {
    // 和普通启动一样，argv[0] 是 exe 自己的路径，要跳过。
    let requested = cli::markdown_path_in_args(argv.into_iter().skip(1));
    let has_file = requested.is_some();

    if let Some(path) = requested {
        // 先存进状态再喊人：冷启动时第二个进程可能比第一个的前端跑得还快，
        // 那时事件没人接，路径至少还在状态里等它来取。
        if let Some(state) = app.try_state::<AppState>() {
            state.remember_open_request(Some(path));
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    if has_file {
        let _ = app.emit(OPEN_FILE_EVENT, ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 必须排在最前面：这个插件要在窗口建起来之前接管命令行，晚了就来不及
        // 阻止第二份进程往下走。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            hand_over_second_launch(app, argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 窗口的大小、位置、最大化状态：退出时写下，下次启动时还原。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 自动更新：端点与公钥在 tauri.conf.json 的 plugins.updater 里
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            // 上一次自动更新留下的安装包还在临时目录里，趁现在删掉（失败也无所谓）。
            cleanup::remove_stale_updater_dirs(&app.package_info().name);

            // 双击 .md 启动时，文件路径在命令行里。此刻前端还没跑起来，所以先
            // 存进状态，等它启动完自己来取。取不到就是普通启动，不影响任何事。
            let pending = cli::markdown_path_in_args(std::env::args().skip(1));
            if let Some(state) = app.try_state::<AppState>() {
                state.remember_open_request(pending);
            }

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
            commands::workspace::workspace_signature,
            commands::workspace::list_folders,
            commands::workspace::create_folder,
            commands::workspace::rename_folder,
            commands::workspace::delete_folder,
            commands::note::list_notes,
            commands::note::read_note,
            commands::note::save_note,
            commands::note::note_hash,
            commands::note::create_note,
            commands::note::rename_note,
            commands::note::delete_note,
            commands::note::search_notes,
            commands::note::list_note_revisions,
            commands::note::read_note_revision,
            commands::note::restore_note_revision,
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
            commands::shell::open_external,
            commands::shell::reveal_in_workspace,
            state::take_startup_notice,
            state::take_open_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
