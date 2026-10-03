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
            commands::fs::open_path,
            commands::fs::open_with,
            commands::fs::reveal_path,
            commands::system::list_drives,
            commands::system::quick_locations,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
