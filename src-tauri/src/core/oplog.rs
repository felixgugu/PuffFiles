//! 檔案操作紀錄。
//!
//! 剪下／複製／貼上／刪除是會動到使用者資料的操作，出錯時必須有跡可循，
//! 所以每一次都寫一行到固定路徑的日誌檔（只寫本機，不上傳）。
//!
//! 寫日誌失敗一律吞掉：紀錄是為了事後追查，不該影響操作本身。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// 超過這個大小就輪替，避免日誌無限長大。
const MAX_BYTES: u64 = 512 * 1024;

fn log_dir() -> Option<PathBuf> {
    // 操作紀錄跟著執行檔走（見 `core::paths`；不可寫時那裡已處理回退）。
    let dir = crate::core::paths::log_dir();
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// 日誌檔完整路徑；給 UI 顯示與「開啟資料夾」使用。
pub fn path() -> Option<PathBuf> {
    Some(log_dir()?.join("file-ops.log"))
}

fn timestamp() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let time = unsafe { GetLocalTime() };
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
            time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond, time.wMilliseconds
        )
    }
    #[cfg(not(windows))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default();
        millis.to_string()
    }
}

fn rotate(path: &PathBuf) {
    let too_big = std::fs::metadata(path)
        .map(|meta| meta.len() > MAX_BYTES)
        .unwrap_or(false);
    if too_big {
        let _ = std::fs::rename(path, path.with_extension("1.log"));
    }
}

/// 寫一行紀錄。`op` 例如 `COPY`／`MOVE`／`DELETE`，`stage` 是 `start`／`ok`／`cancel`／`fail`。
pub fn write(op: &str, stage: &str, detail: &str) {
    let Some(path) = path() else {
        return;
    };
    rotate(&path);

    let line = format!("{}  {:<12} {:<7} {}\n", timestamp(), op, stage, detail);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}

/// 讀出最後 `limit` 行，供設定頁顯示。
pub fn tail(limit: usize) -> String {
    let Some(path) = path() else {
        return String::new();
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return String::new();
    };
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(limit);
    lines[start..].join("\n")
}
