mod commands;
mod core;
mod error;
mod model;

pub use error::{AppError, AppResult};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // WebView2 的設定檔（EBWebView）檔案很多，放在執行檔旁邊太亂，所以應用資料
    // 統一收在使用者設定檔 %LOCALAPPDATA%\PuffFile（見 `core::paths`）。
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(core::paths::app_data_root()),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // PDF 檢視器的來源：`stream://` 直接串流檔案位元組（支援 Range），
        // 不走 base64／Blob，前端只要把 URL 交給 iframe。
        .manage(commands::stream::StreamRegistry::default())
        .register_asynchronous_uri_scheme_protocol(
            commands::stream::SCHEME,
            commands::stream::handle,
        )
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_dir_stream,
            commands::fs::list_subdirs,
            commands::fs::create_folder,
            commands::fs::create_file,
            commands::fs::save_binary_file,
            commands::fs::open_path,
            commands::fs::run_external,
            commands::fs::reveal_path,
            commands::viewer::read_viewer_file,
            commands::stream::open_file_stream,
            commands::stream::close_file_stream,
            commands::shell::clipboard_files,
            commands::shell::set_clipboard_files,
            commands::shell::clear_clipboard,
            commands::shell::copy_items,
            commands::shell::move_items,
            commands::shell::delete_items,
            commands::shell::rename_item,
            commands::shell::operation_log,
            commands::shell::operation_log_path,
            commands::watch::watch_dir,
            commands::watch::unwatch_dir,
            commands::system::list_drives,
            commands::system::quick_locations,
            commands::system::detect_7zip,
        ])
        .run(context)
        .expect("error while running tauri application");
}
