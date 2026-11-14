//! 壓縮檔檢視器的指令：只負責轉交參數，解析與行程控制都在 `core::archive`。

use crate::commands::fs::run_blocking;
use crate::core;
use crate::error::AppResult;
use std::path::Path;

/// 列出一份壓縮檔的內容（唯讀，不解壓縮）。
///
/// `seven_zip` 是設定頁裡 7-Zip 工具的路徑（可能是 `7zG.exe`，後端會找同目錄的
/// `7z.exe`）；`password` 只給檔頭加密的壓縮檔用，前端不會把它寫進任何紀錄。
#[tauri::command]
pub async fn list_archive(
    path: String,
    seven_zip: Option<String>,
    password: Option<String>,
) -> AppResult<core::archive::ArchiveListing> {
    run_blocking(move || {
        core::archive::list(
            Path::new(&path),
            seven_zip.as_deref(),
            password.as_deref(),
        )
    })
    .await
}
