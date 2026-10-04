mod commands;
mod core;
mod error;
mod model;

pub use error::{AppError, AppResult};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_dir_stream,
            commands::fs::list_subdirs,
            commands::fs::create_folder,
            commands::fs::create_file,
            commands::fs::open_path,
            commands::fs::run_external,
            commands::fs::reveal_path,
            commands::viewer::read_viewer_file,
            commands::shell::clipboard_files,
            commands::shell::set_clipboard_files,
            commands::shell::clear_clipboard,
            commands::shell::copy_items,
            commands::shell::move_items,
            commands::shell::delete_items,
            commands::shell::operation_log,
            commands::shell::operation_log_path,
            commands::watch::watch_dir,
            commands::watch::unwatch_dir,
            commands::system::list_drives,
            commands::system::quick_locations,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
