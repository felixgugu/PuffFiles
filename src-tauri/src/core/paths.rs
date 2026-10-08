//! 應用資料與操作紀錄的位置。
//!
//! PuffFile 是單機免安裝軟體，但 WebView2 的設定檔（`EBWebView`）本身就是一個
//! 完整的 Chromium profile，底下有上百個檔案，放在執行檔旁邊會變得非常雜亂。
//! 因此這裡的取捨是：
//!
//! - **設定與瀏覽紀錄**（WebView2 的 localStorage）留在使用者設定檔
//!   `%LOCALAPPDATA%\PuffFile`，不跟著執行檔走；
//! - **操作紀錄**只有單一檔案，跟著執行檔走（`<執行檔>\logs`），該處不可寫時
//!   才回退到 `%LOCALAPPDATA%\PuffFile\logs`。
//!
//! 這是所有落地檔案位置的唯一真實來源。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// WebView2 與 Tauri 應用資料的根目錄（使用者設定檔，不跟隨執行檔）。
///
/// 設定、瀏覽紀錄、快取等都放在這裡。
pub fn app_data_root() -> PathBuf {
    dirs::data_local_dir()
        .map(|base| base.join("PuffFile"))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 操作紀錄資料夾（已解析，行程內只算一次）。
///
/// 優先放執行檔同層的 `logs`；執行檔所在位置不可寫時回退到使用者設定檔。
pub fn log_dir() -> PathBuf {
    LOG_DIR.get_or_init(resolve_log_dir).clone()
}

fn resolve_log_dir() -> PathBuf {
    if let Some(directory) = exe_dir().filter(|directory| is_writable(directory)) {
        directory.join("logs")
    } else {
        app_data_root().join("logs")
    }
}

/// 執行檔所在的資料夾。
fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(PathBuf::from)
}

/// 實際寫一個探測檔再刪掉，確認目錄真的可寫（唯讀媒體 `create` 會直接失敗）。
fn is_writable(directory: &Path) -> bool {
    let probe = directory.join(format!(".pufffile-write-test-{}", std::process::id()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 探測檔應該寫得進去、也清得掉（正常可寫的 temp 目錄）。
    #[test]
    fn writable_directory_is_detected_and_cleaned_up() {
        let dir = std::env::temp_dir();
        assert!(is_writable(&dir));
        // 探測檔不該留下來。
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .expect("read temp")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".pufffile-write-test-")
            })
            .collect();
        assert!(leftovers.is_empty(), "探測檔沒有清掉");
    }

    /// 應用資料與日誌路徑都必須生得出值，不能是空的。
    #[test]
    fn roots_are_never_empty() {
        assert!(!app_data_root().as_os_str().is_empty());
        assert!(!log_dir().as_os_str().is_empty());
    }
}
