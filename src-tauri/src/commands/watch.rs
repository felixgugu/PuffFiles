//! 目錄變更監控指令。

use crate::core::watch::{self, WatchEvent};
use crate::error::{AppError, AppResult};
use tauri::ipc::Channel;

/// 開始監控某個資料夾。同一個 `id` 會先停掉舊的監控。
#[tauri::command]
pub async fn watch_dir(id: String, path: String, on_event: Channel<WatchEvent>) -> AppResult<()> {
    let resolved = crate::core::normalize(std::path::Path::new(&path))?;
    if !resolved.is_dir() {
        return Err(AppError::NotADirectory {
            path: resolved.to_string_lossy().into_owned(),
        });
    }
    watch::start(id, resolved, Box::new(move |event| {
        let _ = on_event.send(event);
    }))
}

/// 停止監控。
#[tauri::command]
pub async fn unwatch_dir(id: String) -> AppResult<()> {
    watch::stop(&id);
    Ok(())
}
