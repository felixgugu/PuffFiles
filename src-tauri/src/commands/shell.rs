//! 剪貼簿與檔案操作指令。
//!
//! 這裡只做參數驗證與執行緒安排，實際工作交給 `core::shell`，
//! 這樣檔案操作的核心邏輯可以獨立測試。

use crate::core;
use crate::core::shell::{self, ClipboardFiles, FileOp};
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::time::Instant;

async fn run_blocking<T, F>(job: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| AppError::Io {
            message: format!("背景工作失敗：{error}"),
        })?
}

fn to_paths(values: Vec<String>) -> Vec<PathBuf> {
    values.into_iter().map(PathBuf::from).collect()
}

/**
 * 執行並記錄。紀錄檔在 `%LOCALAPPDATA%\PuffFile\logs\file-ops.log`，
 * 每次操作寫 start 與結果，失敗時連錯誤訊息一起寫進去。
 */
async fn run_logged<T, F, D>(op: &'static str, detail: String, job: F, describe: D) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
    D: Fn(&T) -> String,
{
    let started = Instant::now();
    crate::core::oplog::write(op, "start", &detail);

    let outcome = run_blocking(job).await;
    let seconds = started.elapsed().as_secs_f32();

    match outcome {
        Ok(value) => {
            crate::core::oplog::write(op, "ok", &format!("{seconds:.2}s {}", describe(&value)));
            Ok(value)
        }
        Err(error) => {
            crate::core::oplog::write(op, "fail", &format!("{seconds:.2}s err={error}"));
            Err(error)
        }
    }
}

fn describe_paths(sources: &[String], destination: Option<&str>) -> String {
    let list = sources
        .iter()
        .map(|path| format!("\"{path}\""))
        .collect::<Vec<_>>()
        .join(", ");
    match destination {
        Some(target) => format!("n={} dest=\"{target}\" items=[{list}]", sources.len()),
        None => format!("n={} items=[{list}]", sources.len()),
    }
}

fn describe_outcome(done: &bool) -> String {
    if *done {
        "使用者完成".to_string()
    } else {
        "使用者取消".to_string()
    }
}

/// 讀取系統剪貼簿裡的檔案清單（與檔案總管互通）。
#[tauri::command]
pub async fn clipboard_files() -> AppResult<ClipboardFiles> {
    run_logged("CLIPBOARD-READ", String::new(), shell::read_clipboard, |files| {
        format!("n={} cut={}", files.paths.len(), files.cut)
    })
    .await
}

/// 把檔案清單寫進系統剪貼簿；`cut` 為 true 時標記成「剪下」。
#[tauri::command]
pub async fn set_clipboard_files(paths: Vec<String>, cut: bool) -> AppResult<()> {
    let detail = format!("cut={cut} {}", describe_paths(&paths, None));
    run_logged(
        "CLIPBOARD-WRITE",
        detail,
        move || shell::write_clipboard(&to_paths(paths), cut),
        |_| String::new(),
    )
    .await
}

/// 清空系統剪貼簿。搬移貼上之後要清掉，否則再貼一次會指向已經不存在的來源。
#[tauri::command]
pub async fn clear_clipboard() -> AppResult<()> {
    run_logged("CLIPBOARD-CLEAR", String::new(), shell::clear_clipboard, |_| String::new()).await
}

/// 複製項目到目的資料夾。回傳 false 代表使用者中途取消。
#[tauri::command]
pub async fn copy_items(sources: Vec<String>, destination: String) -> AppResult<bool> {
    let detail = describe_paths(&sources, Some(&destination));
    run_logged(
        "COPY",
        detail,
        move || {
            let target = existing_directory(&destination)?;
            shell::run(&to_paths(sources), Some(&target), FileOp::Copy, false)
        },
        describe_outcome,
    )
    .await
}

/// 搬移項目到目的資料夾。回傳 false 代表使用者中途取消。
#[tauri::command]
pub async fn move_items(sources: Vec<String>, destination: String) -> AppResult<bool> {
    let detail = describe_paths(&sources, Some(&destination));
    run_logged(
        "MOVE",
        detail,
        move || {
            let target = existing_directory(&destination)?;
            shell::run(&to_paths(sources), Some(&target), FileOp::Move, false)
        },
        describe_outcome,
    )
    .await
}

/// 刪除項目（預設進資源回收筒，由 shell 決定）。
#[tauri::command]
pub async fn delete_items(paths: Vec<String>) -> AppResult<bool> {
    let detail = describe_paths(&paths, None);
    run_logged(
        "DELETE",
        detail,
        move || shell::run(&to_paths(paths), None, FileOp::Delete, false),
        describe_outcome,
    )
    .await
}

/// 讀出最後幾行檔案操作紀錄。
#[tauri::command]
pub async fn operation_log(lines: usize) -> AppResult<String> {
    run_blocking(move || Ok(crate::core::oplog::tail(lines.clamp(1, 2000)))).await
}

/// 紀錄檔的完整路徑（供 UI 顯示與開啟資料夾）。
#[tauri::command]
pub async fn operation_log_path() -> AppResult<String> {
    run_blocking(|| {
        crate::core::oplog::path()
            .map(|path| path.to_string_lossy().into_owned())
            .ok_or_else(|| AppError::Io {
                message: "找不到紀錄檔位置".to_string(),
            })
    })
    .await
}

fn existing_directory(path: &str) -> AppResult<PathBuf> {
    let resolved = core::normalize(Path::new(path))?;
    if !resolved.is_dir() {
        return Err(AppError::NotADirectory {
            path: resolved.to_string_lossy().into_owned(),
        });
    }
    Ok(resolved)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis();
        let root = std::env::temp_dir().join(format!("pufffile-cmdlog-{name}-{stamp}"));
        fs::create_dir_all(&root).expect("create scratch");
        root
    }

    /// 走完整條指令路徑：驗證成功與失敗都會留下紀錄。
    #[test]
    fn logs_success_and_failure() {
        let root = scratch("log");
        let source = root.join("logged.txt");
        fs::write(&source, "x").expect("write source");
        let destination = root.join("dst");
        fs::create_dir_all(&destination).expect("destination");

        let from = source.to_string_lossy().into_owned();
        let into = destination.to_string_lossy().into_owned();

        let copied = tauri::async_runtime::block_on(copy_items(vec![from.clone()], into.clone()));
        assert!(copied.expect("copy should succeed"));

        // 目的資料夾不存在 → 應該失敗，而且失敗也要留下紀錄。
        let missing = root.join("no-such-folder").to_string_lossy().into_owned();
        let failed = tauri::async_runtime::block_on(copy_items(vec![from], missing));
        assert!(failed.is_err(), "不存在的目的資料夾應該失敗");

        let log = crate::core::oplog::tail(40);
        assert!(log.contains("COPY"), "日誌應該有 COPY：{log}");
        assert!(log.contains("ok"), "日誌應該有成功紀錄：{log}");
        assert!(log.contains("fail"), "日誌應該有失敗紀錄：{log}");
        assert!(log.contains("logged.txt"), "日誌應該記下來源路徑：{log}");
    }
}
